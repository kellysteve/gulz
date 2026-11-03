import { createHash, randomUUID } from "node:crypto";
import { chmod, copyFile, lstat, realpath, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { createPlannedOperation, type PlannedOperation } from "@gulz/core";

export interface LocalExecutionOptions {
  /** Absolute directory that bounds every filesystem operation. */
  rootDirectory: string;
  /** Required for moderate, high and critical operations. */
  approved?: boolean;
  /** Maximum time allowed for a single operation. Defaults to 5 seconds. */
  timeoutMs?: number;
  /** Maximum bytes returned by read_file. Defaults to 256 KiB. */
  maxReadBytes?: number;
  signal?: AbortSignal;
}

export interface ExecutionAuditEvent {
  id: string;
  timestamp: string;
  operationId: string;
  kind: "inspect" | "read_file" | "write_file" | "run_command";
  risk: "low" | "moderate" | "high" | "critical";
  outcome: "succeeded" | "denied" | "failed";
  target: string;
  detail: string;
}

export interface LocalExecutionResult {
  operationId: string;
  verified: boolean;
  output: {
    kind: "file_metadata" | "file_content" | "file_written" | "command_result";
    path: string;
    sizeBytes: number;
    sha256?: string;
    content?: string;
    isDirectory?: boolean;
    backupPath?: string;
    command?: string;
    exitCode?: number | null;
    stdout?: string;
    stderr?: string;
  };
  audit: ExecutionAuditEvent;
}

export class ExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionError";
  }
}

function audit(operation: PlannedOperation, outcome: ExecutionAuditEvent["outcome"], target: string, detail: string): ExecutionAuditEvent {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    operationId: operation.id,
    kind: operation.kind as ExecutionAuditEvent["kind"],
    risk: operation.risk,
    outcome,
    target,
    detail,
  };
}

function resolveInsideRoot(root: string, target: string): string {
  if (typeof target !== "string" || !target.trim() || isAbsolute(target)) {
    throw new ExecutionError("Operation target must be a non-empty relative path inside the authorized root.");
  }
  const resolved = resolve(root, target);
  const rel = relative(root, resolved);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new ExecutionError("Operation target escapes the authorized root directory.");
  }
  return resolved;
}

async function rejectSymlinkComponents(root: string, target: string): Promise<void> {
  const rel = relative(root, target);
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new ExecutionError("Symbolic links are not allowed in execution targets.");
  }
}


const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;

function isAllowedCommand(command: unknown, args: unknown): args is string[] {
  if (typeof command !== "string" || !Array.isArray(args) || !args.every((arg) => typeof arg === "string")) return false;
  if (command === "node") return args.length === 1 && ["--version", "-v"].includes(args[0]!);
  if (command === "git") {
    const allowed = [
      ["status", "--short"],
      ["status", "--short", "--branch"],
      ["branch", "--show-current"],
      ["log", "-1", "--oneline"],
      ["diff", "--stat"],
      ["rev-parse", "--show-toplevel"],
    ];
    return allowed.some((entry) => JSON.stringify(entry) === JSON.stringify(args));
  }
  return false;
}

async function runAllowlistedCommand(command: string, args: string[], cwd: string, signal: AbortSignal): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  if (!isAllowedCommand(command, args)) {
    throw new ExecutionError("Command is not allowlisted. Supported commands: node --version and selected read-only git status/branch/log/diff commands.");
  }
  if (signal.aborted) throw new ExecutionError("Execution was cancelled or timed out.");
  return await new Promise((resolveResult, rejectResult) => {
    const executable = command === "node" ? process.execPath : command;
    const processArgs = command === "git" ? ["-c", "core.fsmonitor=false", "-c", "core.pager=cat", "-c", "diff.external=", ...args] : args;
    const child = spawn(executable, processArgs, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_PAGER: "cat",
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      child.kill();
      rejectResult(error);
    };
    const collect = (bucket: Buffer[]) => (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_COMMAND_OUTPUT_BYTES) {
        finishError(new ExecutionError(`Command output exceeded the ${MAX_COMMAND_OUTPUT_BYTES}-byte limit.`));
        return;
      }
      bucket.push(bytes);
    };
    const onAbort = () => finishError(new ExecutionError("Command execution was cancelled or timed out."));
    signal.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", (error) => finishError(new ExecutionError(`Unable to start command: ${error.message}`)));
    child.once("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      resolveResult({
        exitCode: code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    if (signal.aborted) onAbort();
  });
}

function verifyOperation(input: PlannedOperation): PlannedOperation {
  if (!input || typeof input !== "object") throw new ExecutionError("A valid planned operation is required.");
  try {
    const validated = createPlannedOperation({
      id: input.id,
      kind: input.kind,
      description: input.description,
      risk: input.risk,
      ...(input.target === undefined ? {} : { target: input.target }),
      ...(input.content === undefined ? {} : { content: input.content }),
      ...(input.command === undefined ? {} : { command: input.command }),
      ...(input.args === undefined ? {} : { args: input.args }),
      ...(input.commandPreview === undefined ? {} : { commandPreview: input.commandPreview }),
    });
    if (input.requiresApproval !== validated.requiresApproval) {
      throw new ExecutionError("Operation approval metadata is inconsistent with its risk level.");
    }
    if (validated.kind !== "inspect" && validated.kind !== "read_file" && validated.kind !== "write_file" && validated.kind !== "run_command") {
      throw new ExecutionError("This execution engine supports inspect, read_file, write_file and allowlisted run_command operations.");
    }
    if ((validated.kind === "write_file" || validated.kind === "run_command") && validated.risk !== "moderate") {
      throw new ExecutionError("write_file and run_command operations must be moderate-risk and explicitly approved.");
    }
    if (validated.kind !== "write_file" && validated.kind !== "run_command" && validated.risk !== "low") {
      throw new ExecutionError("Filesystem inspection and reading are currently restricted to low-risk operations.");
    }
    return validated;
  } catch (error) {
    if (error instanceof ExecutionError) throw error;
    throw new ExecutionError(error instanceof Error ? error.message : "Operation validation failed.");
  }
}

/**
 * Executes bounded local filesystem operations and a tiny fixed command allowlist.
 * Writes and commands require explicit caller approval. No shell, network, install,
 * delete or permission-changing operation is exposed.
 */
export async function executeLocalOperation(
  untrustedOperation: PlannedOperation,
  options: LocalExecutionOptions,
): Promise<LocalExecutionResult> {
  const operation = verifyOperation(untrustedOperation);
  if (operation.requiresApproval && options.approved !== true) {
    throw new ExecutionError("This operation requires explicit user approval.");
  }
  if (!options.rootDirectory || !isAbsolute(options.rootDirectory)) {
    throw new ExecutionError("An absolute authorized root directory is required.");
  }
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxReadBytes = options.maxReadBytes ?? 256 * 1024;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new ExecutionError("timeoutMs must be an integer between 1 and 30000.");
  }
  if (!Number.isInteger(maxReadBytes) || maxReadBytes < 1 || maxReadBytes > 1024 * 1024) {
    throw new ExecutionError("maxReadBytes must be an integer between 1 and 1048576.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Execution timed out.")), timeoutMs);
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();

  const requestedTarget = operation.target ?? ".";
  try {
    if (controller.signal.aborted) throw new ExecutionError("Execution was cancelled or timed out.");
    const root = await realpath(options.rootDirectory);
    const target = resolveInsideRoot(root, requestedTarget);
    const parentPath = target === root ? root : dirname(target);
    await rejectSymlinkComponents(root, parentPath);
    const parent = await realpath(parentPath);
    if (parent !== root && !parent.startsWith(root + sep)) throw new ExecutionError("Target parent escapes the authorized root directory.");
    let targetInfo;
    try { targetInfo = await lstat(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (targetInfo?.isSymbolicLink()) throw new ExecutionError("Symbolic links are not allowed in execution targets.");
    if (targetInfo && !targetInfo.isFile() && operation.kind !== "inspect" && operation.kind !== "run_command") throw new ExecutionError("Target must be a regular file.");
    const realTarget = targetInfo ? await realpath(target) : target;
    if (realTarget !== root && !realTarget.startsWith(root + sep)) {
      throw new ExecutionError("Resolved target escapes the authorized root directory.");
    }
    if (controller.signal.aborted) throw new ExecutionError("Execution was cancelled or timed out.");

    const info = targetInfo ?? (operation.kind === "write_file" ? undefined : await lstat(realTarget));
    if (operation.kind === "inspect") {
      if (!info) throw new ExecutionError("Inspection target was not found.");
      const output = {
        kind: "file_metadata" as const,
        path: relative(root, realTarget) || ".",
        sizeBytes: info.size,
        isDirectory: info.isDirectory(),
      };
      return {
        operationId: operation.id,
        verified: true,
        output,
        audit: audit(operation, "succeeded", output.path, "Metadata inspected; resolved path remained inside authorized root."),
      };
    }

    if (operation.kind === "run_command") {
      if (!isAllowedCommand(operation.command, operation.args ?? [])) {
        throw new ExecutionError("Command is not allowlisted. Supported commands: node --version and selected read-only git status/branch/log/diff commands.");
      }
      if (!info?.isDirectory()) throw new ExecutionError("Command working directory must be an existing directory.");
      const command = operation.command!;
      const args = operation.args ?? [];
      const commandResult = await runAllowlistedCommand(command, args, realTarget, controller.signal);
      const preview = [command, ...args].join(" ");
      const output = {
        kind: "command_result" as const,
        path: relative(root, realTarget) || ".",
        sizeBytes: Buffer.byteLength(commandResult.stdout, "utf8") + Buffer.byteLength(commandResult.stderr, "utf8"),
        command: preview,
        exitCode: commandResult.exitCode,
        stdout: commandResult.stdout,
        stderr: commandResult.stderr,
      };
      return {
        operationId: operation.id,
        verified: commandResult.exitCode !== null,
        output,
        audit: audit(operation, commandResult.exitCode === 0 ? "succeeded" : "failed", output.path, `Allowlisted command completed with exit code ${commandResult.exitCode}.`),
      };
    }

    if (operation.kind === "write_file") {
      const content = operation.content;
      if (typeof content !== "string") throw new ExecutionError("write_file requires UTF-8 text content.");
      const bytes = Buffer.from(content, "utf8");
      if (bytes.byteLength > maxReadBytes) throw new ExecutionError(`Content exceeds the configured write limit of ${maxReadBytes} bytes.`);
      if (controller.signal.aborted) throw new ExecutionError("Execution was cancelled or timed out.");
      const backupPath = info ? resolve(parent, `.${target.split(sep).pop()}.gulz-backup-${randomUUID()}`) : undefined;
      const temporary = resolve(parent, `.gulz-write-${randomUUID()}.tmp`);
      try {
        if (info && backupPath) {
          await copyFile(realTarget, backupPath, constants.COPYFILE_EXCL);
          await chmod(backupPath, 0o600);
        }
        await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
        if (controller.signal.aborted) throw new ExecutionError("Execution was cancelled or timed out.");
        await rename(temporary, target);
        const writtenBytes = await readFile(target);
        if (!writtenBytes.equals(bytes)) throw new ExecutionError("Write verification failed; the saved file does not match the approved content.");
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
      const output = { kind: "file_written" as const, path: relative(root, target), sizeBytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), ...(backupPath ? { backupPath: relative(root, backupPath) } : {}) };
      return { operationId: operation.id, verified: true, output, audit: audit(operation, "succeeded", output.path, backupPath ? "Atomic write completed; original file preserved as a backup." : "Atomic write completed for a new file.") };
    }

    if (!info || !info.isFile()) throw new ExecutionError("read_file can only read regular files.");
    if (info.size > maxReadBytes) throw new ExecutionError(`File exceeds the configured read limit of ${maxReadBytes} bytes.`);
    const bytes = await readFile(realTarget, { signal: controller.signal });
    if (bytes.byteLength > maxReadBytes) throw new ExecutionError("File grew beyond the configured read limit during execution.");
    if (controller.signal.aborted) throw new ExecutionError("Execution was cancelled or timed out.");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const verifyDigest = createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");
    if (digest !== verifyDigest) throw new ExecutionError("Read verification failed.");
    const output = {
      kind: "file_content" as const,
      path: relative(root, realTarget),
      sizeBytes: bytes.byteLength,
      sha256: digest,
      content,
    };
    return {
      operationId: operation.id,
      verified: true,
      output,
      audit: audit(operation, "succeeded", output.path, "Read completed and SHA-256 content verification passed."),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw error instanceof ExecutionError ? error : new ExecutionError(message);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
