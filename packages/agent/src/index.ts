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
export interface AgentApprovalRequest { toolName: string; description: string; arguments: Record<string, unknown>; }
export interface AgentRunOptions {
  provider: OpenAICompatibleProviderConfig;
  messages: ProviderAgentMessage[];
  tools: AgentTool[];
  approve?: (request: AgentApprovalRequest) => Promise<boolean>;
  signal?: AbortSignal;
  maxRounds?: number;
  onToolResult?: (toolName: string, result: unknown) => void | Promise<void>;
}
export interface AgentRunResult { messages: ProviderAgentMessage[]; reply: string; toolCallsExecuted: number; stoppedForApproval: boolean; }
export class AgentError extends Error { constructor(message: string) { super(message); this.name = "AgentError"; } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

/** Bounded provider/tool loop. Models propose calls; tool policy and user approval authorize execution. */
export async function runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  if (!options || !Array.isArray(options.messages) || !Array.isArray(options.tools) || options.tools.length === 0) throw new AgentError("A conversation and at least one registered tool are required.");
  const maxRounds = Math.max(1, Math.min(options.maxRounds ?? 8, 12));
  const registry = new Map(options.tools.map((tool) => [tool.definition.name, tool]));
  if (registry.size !== options.tools.length) throw new AgentError("Agent tool names must be unique.");
  const messages = options.messages.slice(-30);
  let executed = 0;
  for (let round = 0; round < maxRounds; round += 1) {
    if (options.signal?.aborted) throw new AgentError("Agent run cancelled.");
    const turn = await generateAgentTurn(options.provider, messages.slice(-30), options.tools.map((tool) => tool.definition));
    if (turn.toolCalls.length === 0) {
      messages.push({ role: "assistant", content: turn.content });
      return { messages: messages.slice(-30), reply: turn.content, toolCallsExecuted: executed, stoppedForApproval: false };
    }
    messages.push({ role: "assistant", content: turn.content, toolCalls: turn.toolCalls });
    let denied = false;
    for (const call of turn.toolCalls) {
      const tool = registry.get(call.name);
      if (!tool || !isRecord(call.arguments)) throw new AgentError("The model requested an invalid or unregistered tool.");
      let result: unknown;
      let approved = false;
      if (tool.requiresApproval(call.arguments)) {
        approved = options.approve ? await options.approve({ toolName: call.name, description: tool.definition.description, arguments: call.arguments }) : false;
        if (!approved) {
          result = { ok: false, status: "approval_denied", message: "The user did not approve this operation. Do not retry or attempt an equivalent action." };
          denied = true;
        }
      }
      if (result === undefined) {
        try {
          result = { ok: true, output: await tool.execute(call.arguments, { approved, ...(options.signal ? { signal: options.signal } : {}) }) };
          executed += 1;
        } catch (error) { result = { ok: false, error: error instanceof Error ? error.message : "Tool execution failed." }; }
      }
      await options.onToolResult?.(call.name, result);
      messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(result).slice(0, 32000) });
    }
    if (denied) messages.push({ role: "user", content: "One or more operations were not approved. Continue only with safe, non-equivalent alternatives or explain what remains." });
  }
  throw new AgentError("GULZ reached the maximum agent round limit. Completed operations were verified individually; ask it to continue if more work remains.");
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
    return executeApprovedCommand(command, input.args as string[], { cwd: rootDirectory, approved, ...(signal ? { signal } : {}) });
  }
  if (kind === "write_file") {
    const content = input.content;
    if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > 262144) throw new AgentError("File content must be text no larger than 256 KiB.");
    return executeLocalOperation(createPlannedOperation({ id: randomUUID(), kind, description, risk: "moderate", target: requiredText(input, "path"), content }), { rootDirectory, approved, ...(signal ? { signal } : {}) });
  }
  return executeLocalOperation(createPlannedOperation({
    id: randomUUID(), kind, description, risk: kind === "create_directory" ? "moderate" : "low",
    target: kind === "create_directory" ? requiredText(input, "path") : (typeof input.path === "string" ? input.path : "."),
  }), { rootDirectory, approved, ...(signal ? { signal } : {}) });
}

/** Initial local catalogue. Every command is approved and executed without a shell. */
export function createLocalAgentTools(rootDirectory: string): AgentTool[] {
  const pathSchema = { type: "object", properties: { path: { type: "string", description: "Relative path inside the current authorized workspace." } }, required: ["path"], additionalProperties: false };
  return [
    { definition: { name: "inspect_environment", description: "Detect the current operating system, Termux status, available package managers and developer tools without running commands or exposing secrets.", parameters: { type: "object", properties: {}, additionalProperties: false } }, requiresApproval: () => false, execute: async () => detectEnvironment() },
    { definition: { name: "inspect_path", description: "Inspect metadata for a file or directory inside the current workspace.", parameters: pathSchema }, requiresApproval: () => false, execute: (input, context) => localOperation("inspect", "Inspect a local workspace path", input, rootDirectory, context.approved === true, context.signal) },
    { definition: { name: "list_directory", description: "List entries in a directory inside the current workspace.", parameters: pathSchema }, requiresApproval: () => false, execute: (input, context) => localOperation("list_directory", "List a local workspace directory", input, rootDirectory, context.approved === true, context.signal) },
    { definition: { name: "read_file", description: "Read a bounded UTF-8 text file inside the current workspace.", parameters: pathSchema }, requiresApproval: () => false, execute: (input, context) => localOperation("read_file", "Read a local workspace file", input, rootDirectory, context.approved === true, context.signal) },
    { definition: { name: "create_directory", description: "Create a directory inside the current workspace. Requires user approval.", parameters: pathSchema }, requiresApproval: () => true, execute: (input, context) => localOperation("create_directory", "Create a local workspace directory", input, rootDirectory, context.approved === true, context.signal) },
    { definition: { name: "write_file", description: "Create or replace a UTF-8 file inside the current workspace. Requires user approval; replaced files are backed up.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false } }, requiresApproval: () => true, execute: (input, context) => localOperation("write_file", "Write a local workspace file", input, rootDirectory, context.approved === true, context.signal) },
    { definition: { name: "run_command", description: "Run a program directly without a shell inside the current workspace. Can install packages or configure software, but every command requires approval. Shell interpreters and inline code execution are blocked.", parameters: { type: "object", properties: { command: { type: "string" }, args: { type: "array", maxItems: 50, items: { type: "string", maxLength: 4000 } } }, required: ["command", "args"], additionalProperties: false } }, requiresApproval: () => true, execute: (input, context) => localOperation("run_command", "Run an explicitly approved local program", input, rootDirectory, context.approved === true, context.signal) },
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
