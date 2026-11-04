export type ProviderOperationKind = "inspect" | "read_file" | "write_file" | "run_command";

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

function providerEndpoint(baseUrl: string): string {
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
  const clean = parsed.toString().replace(/\/$/, "");
  return clean.endsWith("/chat/completions") ? clean : clean + "/chat/completions";
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
      if (!["inspect", "read_file", "write_file", "run_command"].includes(String(kind))) {
        throw new ProviderError("AI proposed an unsupported operation. Only inspect, read_file, write_file and allowlisted run_command are supported.");
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
      if ((operation.kind === "inspect" || operation.kind === "read_file") && !operation.target) {
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
    const response = await fetch(endpoint, {
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
          {
            role: "system",
            content: [
              "You are the GULZ task planner. Return only a JSON object with summary and tasks.",
              "Every task must contain at least one operation. Allowed operation kinds: inspect, read_file, write_file, run_command.",
              "Never propose delete, install, network, permission changes, remote operations, shell scripts, arbitrary shell commands, or commands outside the exact allowlist.",
              "For run_command, only propose node --version, node -v, git status --short, git status --short --branch, git branch --show-current, git log -1 --oneline, git diff --stat, or git rev-parse --show-toplevel.",
              "All file targets must be relative paths inside the user's current authorized workspace.",
              "Do not claim an operation has already run. The user must review and approve the plan before execution.",
              "Schema: {summary:string,tasks:[{title:string,description:string,operations:[{kind:string,description:string,target?:string,content?:string,command?:string,args?:string[]}]}]}.",
              "Keep plans practical, ordered, small and verifiable.",
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify({ goal: { title, description } }),
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ProviderError("AI provider request failed with HTTP " + response.status + ". Check the endpoint, model and API key.");
    }
    const responseText = await response.text();
    if (responseText.length > 1_000_000) throw new ProviderError("AI provider response exceeded the 1 MB safety limit.");
    let payload: unknown;
    try { payload = JSON.parse(responseText); } catch { throw new ProviderError("AI provider returned invalid response JSON."); }
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
