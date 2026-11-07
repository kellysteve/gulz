import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export interface RemoteToolRequest {
  environmentId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  approved: boolean;
  signal?: AbortSignal;
}
export interface RemoteCapabilities {
  protocolVersion: number;
  version: string;
  tools: string[];
}
export class RemoteTransportError extends Error {
  constructor(message: string) { super(message); this.name = "RemoteTransportError"; }
}
export function validateRemoteAlias(alias: string): string {
  if (typeof alias !== "string" || !/^[a-z][a-z0-9_-]{1,31}$/.test(alias)) throw new RemoteTransportError("Remote name must start with a lowercase letter and contain only lowercase letters, numbers, hyphens or underscores (2–32 characters).");
  return alias;
}
export function validateRemoteDestination(destination: string): string {
  if (typeof destination !== "string" || !/^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9][A-Za-z0-9.-]*$/.test(destination) || destination.startsWith("-")) {
    throw new RemoteTransportError("Remote destination must be a host or user@host, or an SSH config alias. Ports and command strings are not accepted; configure them in your SSH config.");
  }
  return destination;
}

/**
 * Uses the system OpenSSH client and the user's existing SSH config/agent.
 * The only remote command strings are fixed GULZ protocol entry points;
 * model-provided text is sent as JSON on stdin, never interpolated into a shell command.
 */
export class OpenSshRemoteTransport {
  private readonly destinations: Record<string, string>;
  constructor(destinations: Record<string, string>) {
    this.destinations = Object.fromEntries(Object.entries(destinations).map(([alias, destination]) => [
      validateRemoteAlias(alias), validateRemoteDestination(destination),
    ]));
  }
  async testDestination(destination: string): Promise<RemoteCapabilities> {
    const safeDestination = validateRemoteDestination(destination);
    const output = await this.runSsh(safeDestination, "gulz agent --capabilities", undefined, 20000);
    let parsed: unknown;
    try { parsed = JSON.parse(output.stdout.trim()); } catch { throw new RemoteTransportError("The remote host did not return valid GULZ agent capabilities. Install or update GULZ on that host first."); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RemoteTransportError("The remote GULZ agent returned invalid capabilities.");
    const value = parsed as Record<string, unknown>;
    if (value.protocolVersion !== 1 || typeof value.version !== "string" || !Array.isArray(value.tools) || !value.tools.every((tool) => typeof tool === "string")) {
      throw new RemoteTransportError("The remote GULZ version does not support the required agent protocol. Update GULZ on the VPS.");
    }
    return { protocolVersion: 1, version: value.version, tools: value.tools as string[] };
  }
  async invoke(request: RemoteToolRequest): Promise<unknown> {
    const destination = this.destinations[validateRemoteAlias(request.environmentId)];
    if (!destination) throw new RemoteTransportError("Remote environment is not configured: " + request.environmentId);
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(request.toolName)) throw new RemoteTransportError("Remote tool name is invalid.");
    const body = JSON.stringify({
      protocolVersion: 1,
      requestId: randomUUID(),
      toolName: request.toolName,
      arguments: request.arguments,
      approved: request.approved === true,
    });
    if (Buffer.byteLength(body, "utf8") > 300000) throw new RemoteTransportError("Remote tool request exceeds the 300 KB protocol limit.");
    const output = await this.runSsh(destination, "gulz agent --stdio", body, 120000, request.signal);
    let parsed: unknown;
    try { parsed = JSON.parse(output.stdout.trim()); } catch { throw new RemoteTransportError("Remote agent returned invalid protocol JSON."); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RemoteTransportError("Remote agent returned an invalid response.");
    const response = parsed as Record<string, unknown>;
    if (response.protocolVersion !== 1 || response.requestId !== JSON.parse(body).requestId) throw new RemoteTransportError("Remote agent response did not match the request.");
    if (response.ok !== true) throw new RemoteTransportError(typeof response.error === "string" ? response.error : "Remote operation failed.");
    return response.output;
  }
  private async runSsh(destination: string, remoteCommand: string, input?: string, timeoutMs = 120000, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
    if (signal?.aborted) throw new RemoteTransportError("SSH operation was cancelled before it started.");
    return await new Promise((resolveResult, rejectResult) => {
      const safeEnv: NodeJS.ProcessEnv = {};
      for (const key of ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "HOME", "USERPROFILE", "TMP", "TEMP", "TMPDIR", "SSH_AUTH_SOCK"]) {
        const value = process.env[key];
        if (value !== undefined) safeEnv[key] = value;
      }
      const args = [
        "-T",
        "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=yes",
        "-o", "ConnectTimeout=10",
        "-o", "ServerAliveInterval=15",
        "-o", "ServerAliveCountMax=2",
        "-o", "ClearAllForwardings=yes",
        "-o", "ForwardAgent=no",
        "-o", "PermitLocalCommand=no",
        destination,
        remoteCommand,
      ];
      const child = spawn("ssh", args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: safeEnv });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      let onAbort = () => undefined;
      const finishError = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        child.kill();
        rejectResult(error);
      };
      onAbort = () => finishError(new RemoteTransportError("SSH operation was cancelled."));
      timer = setTimeout(() => finishError(new RemoteTransportError("SSH operation timed out.")), timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      const collect = (bucket: Buffer[], limit: number, stream: "stdout" | "stderr") => (chunk: Buffer | string) => {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (stream === "stdout") stdoutBytes += data.byteLength;
        else stderrBytes += data.byteLength;
        const count = stream === "stdout" ? stdoutBytes : stderrBytes;
        if (count > limit) {
          finishError(new RemoteTransportError("SSH response exceeded the configured output limit."));
          return;
        }
        bucket.push(data);
      };
      child.stdout.on("data", collect(stdout, 700000, "stdout"));
      child.stderr.on("data", collect(stderr, 64000, "stderr"));
      child.stdin.on("error", (error) => finishError(new RemoteTransportError("Unable to send a request to OpenSSH: " + error.message)));
      child.once("error", (error) => finishError(new RemoteTransportError("Unable to start OpenSSH: " + error.message)));
      child.once("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (settled) return;
        settled = true;
        const out = Buffer.concat(stdout).toString("utf8");
        const err = Buffer.concat(stderr).toString("utf8");
        if (code !== 0) {
          if (/host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(err)) {
            rejectResult(new RemoteTransportError("SSH host identity could not be verified. Connect manually, verify the host fingerprint, then retry. GULZ will not accept a host key automatically."));
          } else {
            rejectResult(new RemoteTransportError("SSH connection failed (exit " + String(code) + "). Check the destination, OpenSSH configuration, network and remote GULZ installation. " + err.slice(0, 1200)));
          }
          return;
        }
        resolveResult({ stdout: out, stderr: err });
      });
      if (input !== undefined) child.stdin.end(input + "\n");
      else child.stdin.end();
      if (signal?.aborted) onAbort();
    });
  }
}
