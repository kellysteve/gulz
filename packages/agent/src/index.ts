import { randomUUID } from "node:crypto";
import { createPlannedOperation } from "@gulz/core";
import { executeApprovedCommand, executeLocalOperation } from "@gulz/execution";
import { detectEnvironment } from "@gulz/environments";
import { generateAgentTurn, type OpenAICompatibleProviderConfig, type ProviderAgentMessage, type ProviderAgentToolDefinition } from "@gulz/providers";

export interface AgentToolContext { signal?: AbortSignal; approved?: boolean; }
export interface AgentTool {
  definition: ProviderAgentToolDefinition;
  requiresApproval(input: Record<string, unknown>): boolean;
  execute(input: Record<string, unknown>, context: AgentToolContext): Promise<unknown>;
}
export interface AgentApprovalRequest { toolName: string; description: string; arguments: Record<string, unknown>; risk: "moderate" | "high" | "critical"; }
export interface AgentRunOptions {
  provider: OpenAICompatibleProviderConfig;
  messages: ProviderAgentMessage[];
  tools: AgentTool[];
  approve?: (request: AgentApprovalRequest) => Promise<boolean>;
  signal?: AbortSignal;
  maxRounds?: number;
  maxToolCalls?: number;
  onToolResult?: (toolName: string, result: unknown) => void | Promise<void>;
}
export interface AgentRunResult { messages: ProviderAgentMessage[]; reply: string; toolCallsExecuted: number; stoppedForApproval: boolean; }
export class AgentError extends Error { constructor(message: string) { super(message); this.name = "AgentError"; } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function approvalRisk(toolName: string, input: Record<string, unknown>): "moderate" | "high" | "critical" {
  const baseName = toolName.endsWith("_run_command") ? "run_command" : toolName;
  if (baseName !== "run_command") return "moderate";
  const command = typeof input.command === "string" ? input.command.toLowerCase() : "";
  const args = Array.isArray(input.args) ? input.args.filter((value): value is string => typeof value === "string").map((value) => value.toLowerCase()) : [];
  const effectiveCommand = command === "sudo" && args[0] === "-n" ? ((args[1] ?? "").split(/[\\/]/).pop() ?? "") : command;
  const effectiveArgs = command === "sudo" && args[0] === "-n" ? args.slice(2) : args;
  const recursiveFlag = effectiveArgs.some((value) => value === "--recursive" || (value.startsWith("-") && value.includes("r")));
  const forceFlag = effectiveArgs.some((value) => value === "--force" || (value.startsWith("-") && value.includes("f")));
  const recursiveForce = recursiveFlag && forceFlag;
  if ((effectiveCommand === "rm" && recursiveForce && effectiveArgs.some((value) => value === "/" || value === "/*")) ||
      (effectiveCommand === "dd" && effectiveArgs.some((value) => value.startsWith("of=/dev/")) || effectiveCommand.startsWith("mkfs"))) return "critical";
  if (["sudo", "su", "systemctl", "service", "reboot", "shutdown", "poweroff", "ufw", "iptables", "nft", "firewall-cmd", "chmod", "chown", "useradd", "userdel", "groupadd", "groupdel", "mount", "umount"].includes(command) ||
      ["sudo", "su", "systemctl", "service", "reboot", "shutdown", "poweroff", "ufw", "iptables", "nft", "firewall-cmd", "chmod", "chown", "useradd", "userdel", "groupadd", "groupdel", "mount", "umount"].includes(effectiveCommand) ||
      effectiveArgs.some((value) => ["--force", "--delete", "--purge", "--recursive"].includes(value)) || recursiveForce) return "high";
  return "moderate";
}

function boundedToolResult(value: unknown): string {
  let serialized = JSON.stringify(value) ?? "null";
  if (serialized.length <= 30000) return serialized;
  if (isRecord(value) && isRecord(value.output)) {
    const output: Record<string, unknown> = { ...value.output };
    let truncated = false;
    for (const key of ["content", "stdout", "stderr"]) {
      if (typeof output[key] === "string" && (output[key] as string).length > 8000) {
        output[key] = (output[key] as string).slice(0, 8000);
        truncated = true;
      }
    }
    serialized = JSON.stringify({ ...value, output: { ...output, ...(truncated ? { outputTruncated: true } : {}) } }) ?? "null";
    if (serialized.length <= 30000) return serialized;
  }
  return JSON.stringify({ ok: false, outputTruncated: true, message: "The tool returned too much data to include in AI context. Ask for a smaller or more specific result." });
}


/** Bounded provider/tool loop. Models propose calls; tool policy and user approval authorize execution. */
export async function runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  if (!options || !Array.isArray(options.messages) || !Array.isArray(options.tools) || options.tools.length === 0) throw new AgentError("A conversation and at least one registered tool are required.");
  const maxRounds = Math.max(1, Math.min(options.maxRounds ?? 12, 12));
  const maxToolCalls = Math.max(1, Math.min(options.maxToolCalls ?? 8, 8));
  const historyBudget = Math.max(1, 30 - (maxToolCalls * 2 + 2));
  const registry = new Map<string, AgentTool>(options.tools.map((tool): [string, AgentTool] => [tool.definition.name, tool]));
  if (registry.size !== options.tools.length) throw new AgentError("Agent tool names must be unique.");
  const messages = options.messages.slice(-historyBudget);
  let executed = 0;
  let handled = 0;
  let anyDenied = false;
  for (let round = 0; round < maxRounds; round += 1) {
    if (options.signal?.aborted) throw new AgentError("Agent run cancelled.");
    const turn = await generateAgentTurn({ ...options.provider, ...(options.signal ? { signal: options.signal } : {}) }, messages, options.tools.map((tool) => tool.definition));
    if (turn.toolCalls.length === 0) {
      messages.push({ role: "assistant", content: turn.content });
      return { messages, reply: turn.content, toolCallsExecuted: executed, stoppedForApproval: anyDenied };
    }
    const remaining = maxToolCalls - handled;
    if (remaining <= 0) {
      const reply = "I reached the safe action limit for this turn. The completed tool operations are recorded. Ask me to continue and I'll carry on from the latest results.";
      messages.push({ role: "assistant", content: reply });
      return { messages, reply, toolCallsExecuted: executed, stoppedForApproval: anyDenied };
    }
    messages.push({ role: "assistant", content: turn.content, toolCalls: turn.toolCalls });
    const callsToRun = turn.toolCalls.slice(0, remaining);
    for (const call of callsToRun) {
      handled += 1;
      const tool = registry.get(call.name);
      if (!tool || !isRecord(call.arguments)) throw new AgentError("The model requested an invalid or unregistered tool.");
      let result: unknown;
      let approved = false;
      if (tool.requiresApproval(call.arguments)) {
        const risk = approvalRisk(call.name, call.arguments);
        if (risk === "critical") throw new AgentError("GULZ blocks this critical disk or root-filesystem command. Use a dedicated recovery procedure instead.");
        approved = options.approve ? await options.approve({ toolName: call.name, description: tool.definition.description, arguments: call.arguments, risk }) : false;
        if (!approved) {
          result = { ok: false, status: "approval_denied", message: "The user did not approve this operation. Do not retry or attempt an equivalent action." };
          anyDenied = true;
        }
      }
      if (options.signal?.aborted) throw new AgentError("Agent run cancelled.");
      if (result === undefined) {
        try {
          result = { ok: true, output: await tool.execute(call.arguments, { approved, ...(options.signal ? { signal: options.signal } : {}) }) };
          executed += 1;
        } catch (error) { result = { ok: false, error: error instanceof Error ? error.message : "Tool execution failed." }; }
      }
      await options.onToolResult?.(call.name, result);
      messages.push({ role: "tool", toolCallId: call.id, content: boundedToolResult(result) });
    }
    if (turn.toolCalls.length > remaining) {
      const reply = "I completed the approved actions available in this turn, but reached the safe action limit. Ask me to continue and I'll carry on from the latest results.";
      messages.push({ role: "assistant", content: reply });
      return { messages, reply, toolCallsExecuted: executed, stoppedForApproval: anyDenied };
    }
    if (handled >= maxToolCalls) messages.push({ role: "user", content: "The action budget for this turn is used. Summarize the completed work and explain what remains; do not request more tools." });
  }
  throw new AgentError("GULZ reached the maximum agent round limit. Any completed operations are recorded; ask it to continue if more work remains.");
}

function assertSafeReadablePath(path: string): void {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  const parts = normalized.split("/").filter(Boolean);
  const basename = parts[parts.length - 1] ?? "";
  const blockedDirectories = new Set([".ssh", ".aws", ".azure", ".gnupg", ".kube", ".docker", ".git"]);
  const blockedFiles = new Set([".npmrc", ".pypirc", ".netrc", ".git-credentials", "credentials", "credentials.json", "service-account.json", "id_rsa", "id_ed25519", "id_ecdsa"]);
  const safeEnvExamples = new Set([".env.example", ".env.sample", ".env.template", ".env.dist"]);
  if (parts.some((part) => blockedDirectories.has(part)) || parts.some((part, index) => part === ".config" && ["gcloud", "gh"].includes(parts[index + 1] ?? ""))) {
    throw new AgentError("GULZ will not send files from known credential directories to the AI provider. Copy a redacted example into the workspace if you need help.");
  }
  if (blockedFiles.has(basename) || (basename.startsWith(".env") && !safeEnvExamples.has(basename)) ||
      /\.(pem|key|p12|pfx|keystore|jks)$/.test(basename) || /(secret|credential|password|token)/.test(basename)) {
    throw new AgentError("GULZ will not send a likely secret or credential file to the AI provider. Create a redacted copy if you need help.");
  }
}

function requiredText(input: Record<string, unknown>, key: string, max = 1000): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new AgentError("Tool input requires a valid " + key + ".");
  return value.trim();
}
function localOperation(kind: "inspect" | "list_directory" | "read_file" | "write_file" | "create_directory" | "run_command", description: string, input: Record<string, unknown>, rootDirectory: string, approved: boolean, signal?: AbortSignal) {
  if (kind === "run_command") {
    const command = requiredText(input, "command", 100);
    if (!Array.isArray(input.args) || input.args.length > 50 || !input.args.every((arg) => typeof arg === "string" && arg.length <= 4000)) throw new AgentError("Command arguments must be a bounded string array.");
    return executeApprovedCommand(command, input.args as string[], { cwd: rootDirectory, approved, timeoutMs: 600000, ...(signal ? { signal } : {}) });
  }
  if (kind === "write_file") {
    const content = input.content;
    if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > 262144) throw new AgentError("File content must be text no larger than 256 KiB.");
    return executeLocalOperation(createPlannedOperation({ id: randomUUID(), kind: "write_file", description, risk: "moderate", target: requiredText(input, "path"), content }), { rootDirectory, approved, ...(signal ? { signal } : {}) });
  }
  if (kind === "create_directory") {
    return executeLocalOperation(createPlannedOperation({ id: randomUUID(), kind: "create_directory", description, risk: "moderate", target: requiredText(input, "path") }), { rootDirectory, approved, ...(signal ? { signal } : {}) });
  }
  if (kind === "inspect") {
    return executeLocalOperation(createPlannedOperation({ id: randomUUID(), kind: "inspect", description, risk: "low", target: typeof input.path === "string" ? input.path : "." }), { rootDirectory, approved, ...(signal ? { signal } : {}) });
  }
  if (kind === "list_directory") {
    return executeLocalOperation(createPlannedOperation({ id: randomUUID(), kind: "list_directory", description, risk: "low", target: typeof input.path === "string" ? input.path : "." }), { rootDirectory, approved, ...(signal ? { signal } : {}) });
  }
  if (kind === "read_file") {
    return executeLocalOperation(createPlannedOperation({ id: randomUUID(), kind: "read_file", description, risk: "low", target: requiredText(input, "path") }), { rootDirectory, approved, ...(signal ? { signal } : {}) });
  }
  throw new AgentError("Unsupported local agent operation.");
}

/** Initial local catalogue. Every command is approved and executed without a shell. */
export function createLocalAgentTools(rootDirectory: string): AgentTool[] {
  const pathSchema = { type: "object", properties: { path: { type: "string", description: "Relative path inside the current authorized workspace." } }, required: ["path"], additionalProperties: false };
  return [
    { definition: { name: "inspect_environment", description: "Detect the current operating system, Termux status, available package managers and developer tools without running commands or exposing secrets.", parameters: { type: "object", properties: {}, additionalProperties: false } }, requiresApproval: () => false, execute: async () => ({ ...(await detectEnvironment()), workingDirectory: rootDirectory }) },
    { definition: { name: "inspect_path", description: "Inspect metadata for a file or directory inside the current workspace.", parameters: pathSchema }, requiresApproval: () => false, execute: (input, context) => localOperation("inspect", "Inspect a local workspace path", input, rootDirectory, context.approved === true, context.signal) },
    { definition: { name: "list_directory", description: "List entries in a directory inside the current workspace.", parameters: pathSchema }, requiresApproval: () => false, execute: (input, context) => localOperation("list_directory", "List a local workspace directory", input, rootDirectory, context.approved === true, context.signal) },
    { definition: { name: "read_file", description: "Read a bounded UTF-8 text file inside the current workspace. Known credential files and secret directories are blocked from being sent to the AI provider.", parameters: pathSchema }, requiresApproval: () => false, execute: (input, context) => { const path = requiredText(input, "path"); assertSafeReadablePath(path); return localOperation("read_file", "Read a local workspace file", { ...input, path }, rootDirectory, context.approved === true, context.signal); } },
    { definition: { name: "create_directory", description: "Create a directory inside the current workspace. Requires user approval.", parameters: pathSchema }, requiresApproval: () => true, execute: (input, context) => localOperation("create_directory", "Create a local workspace directory", input, rootDirectory, context.approved === true, context.signal) },
    { definition: { name: "write_file", description: "Create or replace a UTF-8 file inside the current workspace. Requires user approval; replaced files are backed up.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string", maxLength: 262144 } }, required: ["path", "content"], additionalProperties: false } }, requiresApproval: () => true, execute: (input, context) => localOperation("write_file", "Write a local workspace file", input, rootDirectory, context.approved === true, context.signal) },
    { definition: { name: "run_command", description: "Run a program directly without a shell inside the current workspace. Can install packages or configure software, but every command requires approval. Use non-interactive package-manager flags (for example pkg install -y); sudo must be sudo -n. Shell interpreters and inline code execution are blocked.", parameters: { type: "object", properties: { command: { type: "string" }, args: { type: "array", maxItems: 50, items: { type: "string", maxLength: 4000 } } }, required: ["command", "args"], additionalProperties: false } }, requiresApproval: () => true, execute: (input, context) => localOperation("run_command", "Run an explicitly approved local program", input, rootDirectory, context.approved === true, context.signal) },
  ];
}

/** Remote execution is injected by a trusted platform adapter; this interface alone does not ship SSH support. */
export interface RemoteAgentTransport {
  invoke(input: { environmentId: string; toolName: string; arguments: Record<string, unknown>; approved: boolean; signal?: AbortSignal }): Promise<unknown>;
}

/** Mirrors the bounded local tool catalogue onto one SSH-paired remote environment. */
export function createRemoteAgentTools(transport: RemoteAgentTransport, environmentId: string): AgentTool[] {
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(environmentId)) throw new AgentError("Remote environment name is invalid.");
  const prefix = environmentId.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return createLocalAgentTools(".").map((localTool) => ({
    definition: {
      ...localTool.definition,
      name: "remote_" + prefix + "_" + localTool.definition.name,
      description: "On remote environment " + environmentId + ": " + localTool.definition.description,
    },
    requiresApproval: (input) => localTool.requiresApproval(input),
    execute: (input, context) => transport.invoke({
      environmentId,
      toolName: localTool.definition.name,
      arguments: input,
      approved: context.approved === true,
      ...(context.signal ? { signal: context.signal } : {}),
    }),
  }));
}
