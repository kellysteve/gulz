export type ProviderOperationKind = "inspect" | "list_directory" | "create_directory" | "delete_file" | "read_file" | "write_file" | "run_command";

export interface ProviderPlanOperation {
  kind: ProviderOperationKind;
  description: string;
  target?: string;
  content?: string;
  command?: string;
  args?: string[];
}

export interface ProviderPlanTask {
  title: string;
  description: string;
  operations: ProviderPlanOperation[];
}

export interface GeneratedGoalPlan {
  summary: string;
  tasks: ProviderPlanTask[];
}

export interface OpenAICompatibleProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, max = 4000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new ProviderError("The AI plan contains an invalid " + field + ".");
  }
  return value.trim();
}

function providerEndpoint(baseUrl: string): { url: URL; builtin: boolean } {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ProviderError("Provider base URL must be a valid HTTPS URL.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new ProviderError("Provider connections must use HTTPS. HTTP is allowed only for localhost.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ProviderError("Provider URL must not contain credentials, query parameters or fragments.");
  }
  const builtin = parsed.hostname === "apis.nabeestech.com" && parsed.pathname.replace(/\/$/, "") === "/api/v1/ai/gpt5-luna";
  const clean = parsed.toString().replace(/\/$/, "");
  return { url: new URL(builtin ? clean : clean.endsWith("/chat/completions") ? clean : clean + "/chat/completions"), builtin };
}

function parsePlanContent(content: unknown): GeneratedGoalPlan {
  if (typeof content !== "string" || !content.trim()) {
    throw new ProviderError("The AI provider returned an empty plan.");
  }
  const normalized = content.trim().replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "");
  let value: unknown;
  try {
    value = JSON.parse(normalized);
  } catch {
    throw new ProviderError("The AI provider did not return valid JSON. No goal data was changed.");
  }
  if (!isRecord(value) || !Array.isArray(value.tasks)) {
    throw new ProviderError("The AI response does not match the required goal-plan structure.");
  }
  const summary = requiredString(value.summary, "plan summary", 2000);
  if (value.tasks.length < 1 || value.tasks.length > 30) {
    throw new ProviderError("An AI plan must contain between 1 and 30 tasks.");
  }
  let operationCount = 0;
  const tasks = value.tasks.map((rawTask, taskIndex): ProviderPlanTask => {
    if (!isRecord(rawTask) || !Array.isArray(rawTask.operations)) {
      throw new ProviderError("AI task " + (taskIndex + 1) + " has an invalid structure.");
    }
    if (rawTask.operations.length < 1 || rawTask.operations.length > 10) {
      throw new ProviderError("Each AI task must contain between 1 and 10 proposed operations.");
    }
    operationCount += rawTask.operations.length;
    if (operationCount > 100) throw new ProviderError("The AI plan exceeds the 100-operation safety limit.");
    const operations = rawTask.operations.map((rawOperation, operationIndex): ProviderPlanOperation => {
      if (!isRecord(rawOperation)) throw new ProviderError("An AI operation has an invalid structure.");
      const kind = rawOperation.kind;
      if (!["inspect", "list_directory", "create_directory", "delete_file", "read_file", "write_file", "run_command"].includes(String(kind))) {
        throw new ProviderError("AI proposed an unsupported operation. Only inspect, list_directory, create_directory, delete_file, read_file, write_file and allowlisted run_command are supported.");
      }
      const operation: ProviderPlanOperation = {
        kind: kind as ProviderOperationKind,
        description: requiredString(rawOperation.description, "operation description", 1000),
      };
      if (rawOperation.target !== undefined) operation.target = requiredString(rawOperation.target, "operation target", 1000);
      if (rawOperation.content !== undefined) {
        if (typeof rawOperation.content !== "string" || rawOperation.content.length > 262144) {
          throw new ProviderError("AI-generated file content exceeds the 256 KiB limit.");
        }
        operation.content = rawOperation.content;
      }
      if (rawOperation.command !== undefined) operation.command = requiredString(rawOperation.command, "command", 100);
      if (rawOperation.args !== undefined) {
        if (!Array.isArray(rawOperation.args) || rawOperation.args.length > 20 || !rawOperation.args.every((arg) => typeof arg === "string" && arg.length <= 1000)) {
          throw new ProviderError("AI-generated command arguments are invalid.");
        }
        operation.args = rawOperation.args as string[];
      }
      if (operation.kind !== "write_file" && operation.content !== undefined) throw new ProviderError("Only write_file operations may contain proposed file content.");
      if (operation.kind !== "run_command" && (operation.command !== undefined || operation.args !== undefined)) throw new ProviderError("Only run_command operations may contain command fields.");
      if ((operation.kind === "inspect" || operation.kind === "list_directory" || operation.kind === "create_directory" || operation.kind === "delete_file" || operation.kind === "read_file") && !operation.target) {
        throw new ProviderError("AI file inspection and read operations require a relative target.");
      }
      if (operation.kind === "write_file" && (!operation.target || operation.content === undefined)) {
        throw new ProviderError("AI write operations require both a relative target and file content.");
      }
      if (operation.kind === "run_command" && (!operation.command || !operation.args)) {
        throw new ProviderError("AI command operations require an executable and an argument array.");
      }
      return operation;
    });
    return {
      title: requiredString(rawTask.title, "task title", 200),
      description: requiredString(rawTask.description, "task description", 2000),
      operations,
    };
  });
  return { summary, tasks };
}


export interface ProviderChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Sends a bounded conversational turn to the selected provider.
 * Conversation history is supplied by the caller and is never used to authorize operations.
 */
export async function generateChatReply(
  config: OpenAICompatibleProviderConfig,
  messages: ProviderChatMessage[],
): Promise<string> {
  if (!config || typeof config !== "object") throw new ProviderError("Provider configuration is required.");
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 40) {
    throw new ProviderError("A conversation must contain between 1 and 40 recent messages.");
  }
  const bounded = messages.map((message) => {
    if (!message || (message.role !== "user" && message.role !== "assistant") ||
        typeof message.content !== "string" || !message.content.trim() || message.content.length > 8000) {
      throw new ProviderError("A conversation message is invalid or exceeds the 8,000-character limit.");
    }
    return { role: message.role, content: message.content.trim() };
  });
  const endpoint = providerEndpoint(requiredString(config.baseUrl, "provider URL", 2000));
  const apiKey = requiredString(config.apiKey, "API key", 4096);
  const model = requiredString(config.model, "model name", 300);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Math.min(config.timeoutMs ?? 60000, 120000)));
  const abortFromCaller = () => controller.abort();
  config.signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const system = "You are GULZ, a capable, honest and practical AI assistant. Help the user think, learn and get work done. Keep conversation context. Never claim to have inspected files, run commands, changed a machine or completed an action unless a separate authorized execution tool has actually done so. AI responses are not permission to perform operations. If a request requires machine changes, explain that the user can ask GULZ to prepare an execution plan; never invent tool results.";
    let response: Response;
    if (endpoint.builtin) {
      const url = new URL(endpoint.url);
      url.searchParams.set("q", system + "\n\nConversation:\n" + bounded.map((item) => item.role.toUpperCase() + ": " + item.content).join("\n"));
      url.searchParams.set("apikey", apiKey);
      response = await fetch(url, { method: "GET", headers: { "Accept": "application/json" }, signal: controller.signal });
    } else {
      response = await fetch(endpoint.url, {
        method: "POST",
        headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ model, temperature: 0.4, messages: [{ role: "system", content: system }, ...bounded] }),
        signal: controller.signal,
      });
    }
    if (!response.ok) throw new ProviderError("AI provider request failed with HTTP " + response.status + ". Check the endpoint, model and API key.");
    const responseText = await response.text();
    if (responseText.length > 1_000_000) throw new ProviderError("AI provider response exceeded the 1 MB safety limit.");
    let payload: unknown;
    try { payload = JSON.parse(responseText); } catch { throw new ProviderError("AI provider returned invalid response JSON."); }
    let answer: unknown;
    if (endpoint.builtin) {
      if (!isRecord(payload) || payload.success === false) throw new ProviderError("Built-in GULZ AI returned an invalid response.");
      answer = payload.response;
    } else {
      if (!isRecord(payload) || !Array.isArray(payload.choices)) throw new ProviderError("AI provider returned an invalid chat-completions response.");
      const choice = payload.choices[0];
      if (!isRecord(choice) || !isRecord(choice.message)) throw new ProviderError("AI provider returned no assistant message.");
      answer = choice.message.content;
    }
    if (typeof answer !== "string" || !answer.trim()) throw new ProviderError("AI provider returned an empty assistant response.");
    if (answer.length > 32000) throw new ProviderError("AI response exceeded the 32,000-character limit.");
    return answer.trim();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted) throw new ProviderError("AI conversation was cancelled or timed out.");
    throw new ProviderError(error instanceof Error ? error.message : "AI conversation request failed.");
  } finally {
    clearTimeout(timeout);
    config.signal?.removeEventListener("abort", abortFromCaller);
  }
}

/**
 * Requests a structured plan from any OpenAI-compatible chat-completions API.
 * The provider is untrusted: this function validates shape and size only.
 * The caller must apply local risk policy and execution allowlists before use.
 */
export async function generateGoalPlan(
  config: OpenAICompatibleProviderConfig,
  goal: { title: string; description: string },
): Promise<GeneratedGoalPlan> {
  if (!config || typeof config !== "object") throw new ProviderError("Provider configuration is required.");
  const endpoint = providerEndpoint(requiredString(config.baseUrl, "provider URL", 2000));
  const apiKey = requiredString(config.apiKey, "API key", 4096);
  const model = requiredString(config.model, "model name", 300);
  const title = requiredString(goal.title, "goal title", 300);
  const description = typeof goal.description === "string" ? goal.description.slice(0, 8000) : "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Math.min(config.timeoutMs ?? 45000, 120000)));
  const abortFromCaller = () => controller.abort();
  config.signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const systemPrompt = [
      "You are the GULZ task planner. Return only a JSON object with summary and tasks.",
      "Every task must contain at least one operation. Allowed operation kinds: inspect, list_directory, create_directory, delete_file, read_file, write_file, run_command.",
      "Never propose directory deletion, package installation, network access, permission changes, remote operations, shell scripts, arbitrary shell commands, or commands outside the exact allowlist. A delete_file operation may be proposed only when the user explicitly asks to remove a specific file; it is reversible, moves the file into a private backup and requires high-risk approval.",
      "For run_command, only propose node --version, node -v, the fixed read-only git status/branch/log/diff/rev-parse diagnostics, npm --version, npm run build:cli, or npm run test:cli.",
      "All file targets must be relative paths inside the user's current authorized workspace.",
      "Do not claim an operation has already run. The user must review and approve the plan before execution.",
      "Schema: {summary:string,tasks:[{title:string,description:string,operations:[{kind:string,description:string,target?:string,content?:string,command?:string,args?:string[]}]}]}.",
      "Keep plans practical, ordered, small and verifiable.",
    ].join(" ");
    const userPrompt = JSON.stringify({ goal: { title, description } });
    let response: Response;
    if (endpoint.builtin) {
      const url = new URL(endpoint.url);
      url.searchParams.set("q", systemPrompt + "\n\nUser request: " + userPrompt);
      url.searchParams.set("apikey", apiKey);
      response = await fetch(url, {
        method: "GET",
        headers: { "Accept": "application/json" },
        signal: controller.signal,
      });
    } else {
      response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + apiKey,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });
    }
    if (!response.ok) {
      throw new ProviderError("AI provider request failed with HTTP " + response.status + ". Check the endpoint, model and API key.");
    }
    const responseText = await response.text();
    if (responseText.length > 1_000_000) throw new ProviderError("AI provider response exceeded the 1 MB safety limit.");
    let payload: unknown;
    try { payload = JSON.parse(responseText); } catch { throw new ProviderError("AI provider returned invalid response JSON."); }
    if (endpoint.builtin) {
      if (!isRecord(payload) || payload.success === false || typeof payload.response !== "string") {
        throw new ProviderError("Built-in GULZ AI returned an invalid response.");
      }
      return parsePlanContent(payload.response);
    }
    if (!isRecord(payload) || !Array.isArray(payload.choices)) throw new ProviderError("AI provider returned an invalid chat-completions response.");
    const choice = payload.choices[0];
    if (!isRecord(choice) || !isRecord(choice.message)) throw new ProviderError("AI provider returned no assistant message.");
    return parsePlanContent(choice.message.content);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted) throw new ProviderError("AI planning was cancelled or timed out.");
    throw new ProviderError(error instanceof Error ? error.message : "AI provider request failed.");
  } finally {
    clearTimeout(timeout);
    config.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export type ProviderAgentRole = "user" | "assistant" | "tool";
export interface ProviderAgentToolCall { id: string; name: string; arguments: Record<string, unknown>; }
export interface ProviderAgentMessage { role: ProviderAgentRole; content: string; toolCallId?: string; toolCalls?: ProviderAgentToolCall[]; }
export interface ProviderAgentToolDefinition { name: string; description: string; parameters: Record<string, unknown>; }
export interface ProviderAgentTurn { content: string; toolCalls: ProviderAgentToolCall[]; }

/** Requests one tool-capable turn. Model tool calls are untrusted proposals, never authorization. */
export async function generateAgentTurn(config: OpenAICompatibleProviderConfig, messages: ProviderAgentMessage[], tools: ProviderAgentToolDefinition[]): Promise<ProviderAgentTurn> {
  if (!config || typeof config !== "object") throw new ProviderError("Provider configuration is required.");
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 30) throw new ProviderError("An agent turn requires between 1 and 30 messages.");
  if (!Array.isArray(tools) || tools.length > 40) throw new ProviderError("The agent tool catalogue is invalid.");
  const safeMessages = messages.map((message) => {
    if (!message || !["user", "assistant", "tool"].includes(message.role) || typeof message.content !== "string" || message.content.length > 32000 ||
      (message.role === "tool" && !requiredString(message.toolCallId, "tool call ID", 200))) throw new ProviderError("An agent message is invalid or exceeds its size limit.");
    return {
      role: message.role, content: message.content,
      ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
      ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map((call) => ({
        id: requiredString(call.id, "tool call ID", 200), type: "function",
        function: { name: requiredString(call.name, "tool name", 100), arguments: JSON.stringify(call.arguments) },
      })) } : {}),
    };
  });
  const safeTools = tools.map((tool) => {
    const name = requiredString(tool.name, "tool name", 100);
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(name)) throw new ProviderError("An agent tool name is invalid.");
    return { type: "function", function: { name, description: requiredString(tool.description, "tool description", 1000), parameters: tool.parameters } };
  });
  const endpoint = providerEndpoint(requiredString(config.baseUrl, "provider URL", 2000));
  const apiKey = requiredString(config.apiKey, "API key", 4096);
  const model = requiredString(config.model, "model name", 300);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Math.min(config.timeoutMs ?? 90000, 180000)));
  const abortFromCaller = () => controller.abort();
  config.signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const system = [
      "You are GULZ, an AI agent that helps users operate their own devices, projects and authorized servers.",
      "Use tools when real inspection or changes are needed. Never invent tool results or claim work is complete before verified tool results say so.",
      "Tool calls are untrusted proposals. Never bypass approval, scope or tool restrictions. Ask a concise clarification when required information is missing.",
      "Use only supplied tools. Do not claim unsupported operations have been performed. Keep the user informed in natural language and do not expose internal task IDs.",
    ].join(" ");
    let response: Response;
    if (endpoint.builtin) {
      const url = new URL(endpoint.url);
      url.searchParams.set("q", system + "\n\nAvailable tools (JSON schemas):\n" + JSON.stringify(tools) +
        "\n\nConversation:\n" + safeMessages.map((item) => item.role.toUpperCase() + ": " + item.content).join("\n") +
        "\n\nIf a tool is needed, return ONLY JSON: {\"tool_calls\":[{\"id\":\"call_1\",\"name\":\"tool_name\",\"arguments\":{}}]}. Otherwise return a natural-language answer.");
      url.searchParams.set("apikey", apiKey);
      response = await fetch(url, { method: "GET", headers: { "Accept": "application/json" }, signal: controller.signal });
    } else {
      response = await fetch(endpoint.url, {
        method: "POST", headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ model, temperature: 0.2, tools: safeTools, tool_choice: "auto", messages: [{ role: "system", content: system }, ...safeMessages] }),
        signal: controller.signal,
      });
    }
    if (!response.ok) throw new ProviderError("AI agent request failed with HTTP " + response.status + ". Check whether this model supports tool calling.");
    const responseText = await response.text();
    if (responseText.length > 1_000_000) throw new ProviderError("AI provider response exceeded the 1 MB safety limit.");
    let payload: unknown;
    try { payload = JSON.parse(responseText); } catch { throw new ProviderError("AI provider returned invalid agent response JSON."); }
    let rawMessage: unknown;
    if (endpoint.builtin) {
      if (!isRecord(payload) || payload.success === false || typeof payload.response !== "string") throw new ProviderError("Built-in GULZ AI returned an invalid agent response.");
      const raw = payload.response.trim().replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "");
      try {
        const parsed: unknown = JSON.parse(raw);
        rawMessage = isRecord(parsed) && Array.isArray(parsed.tool_calls) ? { content: "", tool_calls: parsed.tool_calls } : { content: payload.response };
      } catch { rawMessage = { content: payload.response }; }
    } else {
      if (!isRecord(payload) || !Array.isArray(payload.choices)) throw new ProviderError("AI provider returned an invalid chat-completions response.");
      const choice = payload.choices[0];
      if (!isRecord(choice) || !isRecord(choice.message)) throw new ProviderError("AI provider returned no assistant message.");
      rawMessage = choice.message;
    }
    if (!isRecord(rawMessage)) throw new ProviderError("AI provider returned an invalid assistant turn.");
    const content = typeof rawMessage.content === "string" ? rawMessage.content.trim() : "";
    const rawCalls = Array.isArray(rawMessage.tool_calls) ? rawMessage.tool_calls : [];
    if (rawCalls.length > 8) throw new ProviderError("The AI requested more than 8 tools in one turn.");
    const allowedNames = new Set(tools.map((tool) => tool.name));
    const toolCalls = rawCalls.map((rawCall): ProviderAgentToolCall => {
      if (!isRecord(rawCall)) throw new ProviderError("The AI returned an invalid tool call.");
      const fn = isRecord(rawCall.function) ? rawCall.function : rawCall;
      const name = requiredString(fn.name, "tool name", 100);
      if (!allowedNames.has(name)) throw new ProviderError("The AI requested an unavailable tool: " + name + ".");
      let args: unknown = fn.arguments;
      if (typeof args === "string") { try { args = JSON.parse(args); } catch { throw new ProviderError("The AI returned malformed tool arguments."); } }
      if (!isRecord(args) || JSON.stringify(args).length > 16000) throw new ProviderError("The AI returned invalid or oversized tool arguments.");
      return { id: requiredString(rawCall.id ?? "builtin_" + randomToolId(), "tool call ID", 200), name, arguments: args };
    });
    if (!content && toolCalls.length === 0) throw new ProviderError("AI provider returned an empty agent response.");
    if (content.length > 32000) throw new ProviderError("AI response exceeded the 32,000-character limit.");
    return { content, toolCalls };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted) throw new ProviderError("AI agent request was cancelled or timed out.");
    throw new ProviderError(error instanceof Error ? error.message : "AI agent request failed.");
  } finally {
    clearTimeout(timeout);
    config.signal?.removeEventListener("abort", abortFromCaller);
  }
}
function randomToolId(): string { return "gulz_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10); }
