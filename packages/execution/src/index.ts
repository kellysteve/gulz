import { createHash, randomUUID } from "node:crypto";
import { copyFile, lstat, realpath, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
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
  kind: "inspect" | "read_file" | "write_file";
  risk: "low" | "moderate" | "high" | "critical";
  outcome: "succeeded" | "denied" | "failed";
  target: string;
  detail: string;
}

export interface LocalExecutionResult {
  operationId: string;
  verified: boolean;
  output: {
    kind: "file_metadata" | "file_content" | "file_written";
    path: string;
    sizeBytes: number;
    sha256?: string;
    content?: string;
    isDirectory?: boolean;
    backupPath?: string;
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
    kind: operation.kind as "inspect" | "read_file" | "write_file",
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
      ...(input.commandPreview === undefined ? {} : { commandPreview: input.commandPreview }),
    });
    if (input.requiresApproval !== validated.requiresApproval) {
      throw new ExecutionError("Operation approval metadata is inconsistent with its risk level.");
    }
    if (validated.kind !== "inspect" && validated.kind !== "read_file" && validated.kind !== "write_file") {
      throw new ExecutionError("This execution engine supports inspect, read_file and write_file operations.");
    }
    if (validated.kind === "write_file" && validated.risk !== "moderate") {
      throw new ExecutionError("write_file operations must be moderate-risk and explicitly approved.");
    }
    if (validated.kind !== "write_file" && validated.risk !== "low") {
      throw new ExecutionError("Filesystem inspection and reading are currently restricted to low-risk operations.");
    }
    return validated;
  } catch (error) {
    if (error instanceof ExecutionError) throw error;
    throw new ExecutionError(error instanceof Error ? error.message : "Operation validation failed.");
  }
}

/**
 * Executes bounded local filesystem operations. Writes are moderate-risk,
 * require explicit caller approval and preserve replaced files as backups.
 * No shell, network, install, delete or permission-changing operation is exposed.
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
    const parent = await realpath(target === root ? root : dirname(target));
    if (parent !== root && !parent.startsWith(root + sep)) throw new ExecutionError("Target parent escapes the authorized root directory.");
    await rejectSymlinkComponents(root, parent);
    let targetInfo;
    try { targetInfo = await lstat(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (targetInfo?.isSymbolicLink()) throw new ExecutionError("Symbolic links are not allowed in execution targets.");
    if (targetInfo && !targetInfo.isFile() && operation.kind !== "inspect") throw new ExecutionError("Target must be a regular file.");
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

    if (operation.kind === "write_file") {
      const content = operation.content;
      if (typeof content !== "string") throw new ExecutionError("write_file requires UTF-8 text content.");
      const bytes = Buffer.from(content, "utf8");
      if (bytes.byteLength > maxReadBytes) throw new ExecutionError(`Content exceeds the configured write limit of ${maxReadBytes} bytes.`);
      if (controller.signal.aborted) throw new ExecutionError("Execution was cancelled or timed out.");
      const backupPath = info ? resolve(parent, `.${target.split(sep).pop()}.gulz-backup-${randomUUID()}`) : undefined;
      const temporary = resolve(parent, `.gulz-write-${randomUUID()}.tmp`);
      try {
        if (info && backupPath) await copyFile(realTarget, backupPath, constants.COPYFILE_EXCL);
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
