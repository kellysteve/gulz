#!/usr/bin/env node

import { arch, homedir, platform, release } from "node:os";
import { access, appendFile, chmod, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { constants, existsSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { addGoalTask, createGoal, createPlannedOperation, operationRequiresApproval, transitionGoal, transitionTask, type GoalRecord, type GoalStatus, type TaskStatus, type RiskLevel, type OperationKind } from "@gulz/core";
import { executeLocalOperation, type LocalExecutionResult } from "@gulz/execution";
import { generateGoalPlan, type OpenAICompatibleProviderConfig, type ProviderChatMessage } from "@gulz/providers";
import { createLocalAgentTools, createRemoteAgentTools, runAgent } from "@gulz/agent";
import { OpenSshRemoteTransport, validateRemoteAlias, validateRemoteDestination, validateRemoteWorkspace } from "@gulz/remote";

const VERSION = "0.1.0";
const dataHome = resolve(process.env.GULZ_HOME || join(homedir(), ".gulz"));
const goalsFile = join(dataHome, "goals.json");
const goalsLockFile = join(dataHome, "goals.lock");
const auditFile = join(dataHome, "audit.jsonl");
const providerFile = join(dataHome, "provider.json");
const conversationFile = join(dataHome, "conversation.json");
const remoteEnvironmentsFile = join(dataHome, "remote-environments.json");
const executionLockFile = join(dataHome, "execution.lock");

const isInteractive = Boolean(stdout.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb");
const ansi = { reset: "\u001b[0m", bold: "\u001b[1m", dim: "\u001b[2m", cyan: "\u001b[36m", blue: "\u001b[34m", green: "\u001b[32m", yellow: "\u001b[33m", red: "\u001b[31m", magenta: "\u001b[35m" };
function paint(value: string, ...styles: string[]): string { return isInteractive ? styles.join("") + value + ansi.reset : value; }
function title(value: string): void { console.log("\n" + paint(value, ansi.bold, ansi.cyan)); }
function success(value: string): void { console.log(paint("✓ " + value, ansi.green, ansi.bold)); }
function warning(value: string): void { console.log(paint("! " + value, ansi.yellow)); }
function failure(value: string): void { console.error(paint("✗ " + value, ansi.red, ansi.bold)); }
function label(name: string, value: string): void { console.log(paint(name.padEnd(14), ansi.dim) + value); }

const goalStatuses = new Set<GoalStatus>(["draft", "planned", "awaiting_approval", "running", "paused", "completed", "failed", "cancelled"]);
const taskStatuses = new Set<TaskStatus>(["pending", "awaiting_approval", "running", "paused", "completed", "failed", "skipped", "cancelled"]);
const risks = new Set<RiskLevel>(["low", "moderate", "high", "critical"]);
const operationKinds = new Set<OperationKind>(["inspect", "list_directory", "create_directory", "delete_file", "read_file", "write_file", "run_command", "network", "install", "delete", "permission_change", "remote_operation"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isValidOperation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.description)) return false;
  if (typeof value.kind !== "string" || !operationKinds.has(value.kind as OperationKind)) return false;
  if (typeof value.risk !== "string" || !risks.has(value.risk as RiskLevel)) return false;
  if (value.requiresApproval !== operationRequiresApproval(value.risk as RiskLevel)) return false;
  const validArgs = value.args === undefined || (Array.isArray(value.args) && value.args.every((arg) => typeof arg === "string"));
  const validCommand = value.kind !== "run_command" || (isNonEmptyString(value.command) && Array.isArray(value.args) && value.args.every((arg) => typeof arg === "string") && value.commandPreview === [value.command, ...value.args].join(" "));
  return isOptionalString(value.target) && isOptionalString(value.content) && isOptionalString(value.command) && validArgs && validCommand && isOptionalString(value.commandPreview);
}

function isValidTask(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.title) || typeof value.description !== "string") return false;
  if (typeof value.status !== "string" || !taskStatuses.has(value.status as TaskStatus)) return false;
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) return false;
  if (!Array.isArray(value.operations) || !value.operations.every(isValidOperation)) return false;
  if (value.completedOperationIds !== undefined) {
    if (!Array.isArray(value.completedOperationIds) || !value.completedOperationIds.every(isNonEmptyString)) return false;
    const operationIds = new Set(value.operations.map((operation) => (operation as { id: string }).id));
    if (new Set(value.completedOperationIds).size !== value.completedOperationIds.length || value.completedOperationIds.some((id) => !operationIds.has(id))) return false;
  }
  return isOptionalString(value.result) && isOptionalString(value.error);
}

function isValidGoal(value: unknown): value is GoalRecord {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.title) || typeof value.description !== "string") return false;
  if (typeof value.status !== "string" || !goalStatuses.has(value.status as GoalStatus)) return false;
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) return false;
  if (value.completedAt !== undefined && !isTimestamp(value.completedAt)) return false;
  if (!isOptionalString(value.failureReason)) return false;
  if (!Array.isArray(value.tasks) || !value.tasks.every(isValidTask)) return false;
  const taskIds = value.tasks.map((task) => (task as { id: string }).id);
  return new Set(taskIds).size === taskIds.length;
}

function validateGoals(value: unknown): GoalRecord[] {
  if (!Array.isArray(value) || !value.every(isValidGoal)) {
    throw new Error("Saved goals data has an invalid structure or unsupported state.");
  }
  const ids = value.map((goal) => goal.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Saved goals data contains duplicate goal IDs.");
  }
  return value;
}

function help(): void {
  console.log([
    "GULZ — Tell it. Get it done.",
    "",
    "Usage: gulz <command>",
    "",
    "Commands:",
    "  init                  Create the local GULZ data directory",
    "  doctor                Check the local runtime and data directory",
    "  audit [--limit N]     View recent local action history",
    "  provider builtin      Use the built-in GULZ AI",
    "  provider configure    Set your own OpenAI-compatible AI provider",
    "  provider status       Show provider connection settings",
    "  provider test         Test the configured AI connection with a sample request",
    "  provider remove       Remove saved provider credentials",
    "  chat                  Open a continuous AI conversation with GULZ",
    "  remote list           List saved VPS connections",
    "  remote add <name> <user@host> [workspace]  Pair a VPS over SSH",
    "  remote test <name>    Test a saved VPS connection",
    "  remote remove <name> Remove a saved VPS connection",
    "  update                Safely update GULZ from its source installation",
    "  repair                Reinstall CLI dependencies, rebuild and relink",
    "  uninstall             Remove the CLI and source checkout; preserve local data",
    "  inspect <path>        Inspect a path inside the current directory",
    "  list [path]           List directory entries without following symlinks",
    "  mkdir <path>          Create directories after explicit approval",
    "  delete <file>         Move a file to a private recoverable backup",
    "  read <path>           Read a file inside the current directory (256 KiB max)",
    "  write <path>          Write one line of text after explicit confirmation",
    "  run <command> [args]  Run a fixed allowlisted diagnostic command",
    "  restore <backup> <target>  Restore a saved backup after confirmation",
    "  --help, -h            Show this help",
    "  --version, -v         Show the installed version",
    "",
    "Data is stored locally in ~/.gulz (or GULZ_HOME if configured).",
    "Agent file tools are confined to the current working directory; approved programs may affect wider system state.",
    "Writes require interactive approval and preserve replaced files as backups.",
    "The AI agent can run approved programs without a shell; shell interpreters and inline code are blocked.",
    "Package managers may run after approval. Direct SSH commands are blocked; use paired remote environments.",
  ].join("\n"));
}

async function ensureDataHome(): Promise<void> {
  await mkdir(dataHome, { recursive: true, mode: 0o700 });
  const info = await lstat(dataHome);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("GULZ data path must be a real directory, not a symbolic link.");
  }
  await chmod(dataHome, 0o700);
}

async function readGoals(): Promise<GoalRecord[]> {
  await ensureDataHome();
  let raw: string;
  try {
    const info = await lstat(goalsFile);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error("GULZ goals storage must be a regular file, not a symbolic link.");
    }
    await chmod(goalsFile, 0o600);
    raw = await readFile(goalsFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Saved goals file contains invalid JSON. It was left untouched; back it up and repair it before continuing.");
  }

  try {
    return validateGoals(parsed);
  } catch (error) {
    throw new Error(`Saved goals file failed validation and was left untouched: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function saveGoals(goals: GoalRecord[]): Promise<void> {
  validateGoals(goals);
  await ensureDataHome();
  const temporary = join(dataHome, `goals.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(goals, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, goalsFile);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}


async function recordAudit(action: string, details: Record<string, string | number | boolean | undefined> = {}): Promise<void> {
  await ensureDataHome();
  try {
    const info = await lstat(auditFile);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("GULZ audit storage must be a regular file, not a symbolic link.");
    await chmod(auditFile, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const entry = { id: randomUUID(), timestamp: new Date().toISOString(), action, ...details };
  await appendFile(auditFile, JSON.stringify(entry) + "\n", { encoding: "utf8", mode: 0o600 });
  await chmod(auditFile, 0o600);
}


interface RemoteEnvironmentRecord {
  name: string;
  destination: string;
  workspace: string;
  addedAt: string;
}

async function readRemoteEnvironments(): Promise<RemoteEnvironmentRecord[]> {
  await ensureDataHome();
  try {
    const info = await lstat(remoteEnvironmentsFile);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Remote environment settings must be a regular file, not a symbolic link.");
    await chmod(remoteEnvironmentsFile, 0o600);
    const parsed: unknown = JSON.parse(await readFile(remoteEnvironmentsFile, "utf8"));
    if (!Array.isArray(parsed) || parsed.length > 50 || !parsed.every((item) =>
      isRecord(item) && isNonEmptyString(item.name) && isNonEmptyString(item.destination) && (item.workspace === undefined || isNonEmptyString(item.workspace)) && isTimestamp(item.addedAt))) {
      throw new Error("Saved remote environment settings are invalid. They were left untouched.");
    }
    const names = parsed.map((item) => (item as { name: string }).name);
    if (new Set(names).size !== names.length) throw new Error("Saved remote environment names contain duplicates.");
    return parsed.map((item) => ({
      name: validateRemoteAlias((item as { name: string }).name),
      destination: validateRemoteDestination((item as { destination: string }).destination),
      workspace: validateRemoteWorkspace(typeof (item as { workspace?: unknown }).workspace === "string" ? (item as { workspace: string }).workspace : "."),
      addedAt: (item as { addedAt: string }).addedAt,
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function saveRemoteEnvironments(environments: RemoteEnvironmentRecord[]): Promise<void> {
  if (environments.length > 50 || new Set(environments.map((item) => item.name)).size !== environments.length) {
    throw new Error("Remote environment list is invalid or contains duplicate names.");
  }
  for (const item of environments) {
    validateRemoteAlias(item.name);
    validateRemoteDestination(item.destination);
    validateRemoteWorkspace(item.workspace);
    if (!isTimestamp(item.addedAt)) throw new Error("Remote environment timestamp is invalid.");
  }
  await ensureDataHome();
  const temporary = join(dataHome, "remote-environments." + randomUUID() + ".tmp");
  try {
    await writeFile(temporary, JSON.stringify(environments, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, remoteEnvironmentsFile);
    await chmod(remoteEnvironmentsFile, 0o600);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

interface StoredProviderConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

async function readProviderConfig(): Promise<StoredProviderConfig | null> {
  const envBase = process.env.GULZ_AI_BASE_URL;
  const envModel = process.env.GULZ_AI_MODEL;
  const envKey = process.env.GULZ_AI_API_KEY;
  if (envBase || envModel || envKey) {
    if (!envBase || !envModel || !envKey) throw new Error("Set all three variables: GULZ_AI_BASE_URL, GULZ_AI_MODEL and GULZ_AI_API_KEY.");
    return { baseUrl: envBase, model: envModel, apiKey: envKey };
  }
  try {
    const info = await lstat(providerFile);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Provider settings must be a regular file, not a symbolic link.");
    await chmod(providerFile, 0o600);
    const parsed: unknown = JSON.parse(await readFile(providerFile, "utf8"));
    if (!isRecord(parsed) || !isNonEmptyString(parsed.baseUrl) || !isNonEmptyString(parsed.model) || !isNonEmptyString(parsed.apiKey)) {
      throw new Error("Saved provider settings are invalid. Run gulz provider configure to replace them.");
    }
    return { baseUrl: parsed.baseUrl, model: parsed.model, apiKey: parsed.apiKey };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function saveProviderConfig(config: StoredProviderConfig): Promise<void> {
  await ensureDataHome();
  try {
    const info = await lstat(providerFile);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Provider settings must be a regular file, not a symbolic link.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = join(dataHome, "provider." + randomUUID() + ".tmp");
  try {
    await writeFile(temporary, JSON.stringify(config, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, providerFile);
    await chmod(providerFile, 0o600);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function askSecret(prompt: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") throw new Error("Secret input requires a real interactive terminal.");
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  let value = "";
  return await new Promise<string>((resolveSecret, rejectSecret) => {
    const finish = (error?: Error) => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdout.write("\n");
      if (error) rejectSecret(error); else resolveSecret(value);
    };
    const onData = (chunk: string | Buffer) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") { finish(new Error("Secret entry cancelled.")); return; }
        if (character === "\r" || character === "\n") { finish(); return; }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else if (character >= " " && character !== "\u007f") value += character;
      }
    };
    stdin.on("data", onData);
  });
}

function validatePlannedOperations(raw: Awaited<ReturnType<typeof generateGoalPlan>>["tasks"][number]["operations"]) {
  const allowedCommands = [
    ["node", "--version"], ["node", "-v"],
    ["git", "status", "--short"], ["git", "status", "--short", "--branch"],
    ["git", "branch", "--show-current"], ["git", "log", "-1", "--oneline"],
    ["git", "diff", "--stat"], ["git", "rev-parse", "--show-toplevel"],
    ["npm", "--version"], ["npm", "run", "build:cli"], ["npm", "run", "test:cli"],
  ];
  return raw.map((item) => {
    if (item.target !== undefined && (isAbsolute(item.target) || /^[A-Za-z]:/.test(item.target) || item.target.includes("..") || item.target.includes(String.fromCharCode(0)))) {
      throw new Error("The AI proposed a path outside the authorized relative workspace. The plan was rejected.");
    }
    if (item.kind === "run_command" && item.command === "npm" && process.platform === "win32") throw new Error("AI proposed an npm workflow that is not supported by the shell-free Windows runner.");
    if (item.kind === "run_command" && !allowedCommands.some((allowed) => JSON.stringify(allowed) === JSON.stringify([item.command, ...(item.args ?? [])]))) {
      throw new Error("The AI proposed a command outside GULZ's fixed read-only allowlist. The plan was rejected.");
    }
    const risk: RiskLevel = item.kind === "inspect" || item.kind === "list_directory" || item.kind === "read_file" ? "low" : item.kind === "delete_file" ? "high" : "moderate";
    return createPlannedOperation({
      id: randomUUID(),
      kind: item.kind,
      description: item.description,
      risk,
      ...(item.target === undefined ? {} : { target: item.target }),
      ...(item.content === undefined ? {} : { content: item.content }),
      ...(item.command === undefined ? {} : { command: item.command }),
      ...(item.args === undefined ? {} : { args: item.args }),
    });
  });
}
async function mutateGoalRecord(id: string, mutate: (goal: GoalRecord) => GoalRecord): Promise<GoalRecord> {
  return await withGoalsLock(async () => {
    const goals = await readGoals();
    const index = goals.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("Goal not found.");
    const updated = mutate(goals[index]!);
    goals[index] = updated;
    await saveGoals(goals);
    return updated;
  });
}

async function withExecutionLock<T>(run: () => Promise<T>): Promise<T> {
  await ensureDataHome();
  const token = randomUUID();
  const lockContent = JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() });
  try {
    await writeFile(executionLockFile, lockContent, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let lock: unknown;
    try {
      const info = await lstat(executionLockFile);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Execution lock is not a regular file.");
      lock = JSON.parse(await readFile(executionLockFile, "utf8"));
    } catch {
      throw new Error("GULZ found an unreadable execution lock. Inspect " + executionLockFile + " before removing it.");
    }
    if (isRecord(lock) && typeof lock.pid === "number" && lock.pid > 0) {
      try {
        process.kill(lock.pid, 0);
        throw new Error("Another GULZ execution is active (PID " + lock.pid + "). Wait for it to finish.");
      } catch (probeError) {
        if (probeError instanceof Error && probeError.message.startsWith("Another GULZ execution")) throw probeError;
        if ((probeError as NodeJS.ErrnoException).code !== "ESRCH") {
          throw new Error("GULZ cannot confirm whether the previous execution is still active. Do not remove the lock automatically.");
        }
      }
    } else {
      throw new Error("GULZ found an invalid execution lock. Inspect " + executionLockFile + " before removing it.");
    }
    await rm(executionLockFile, { force: true });
    await writeFile(executionLockFile, lockContent, { encoding: "utf8", mode: 0o600, flag: "wx" });
  }
  try {
    return await run();
  } finally {
    try {
      const lock = JSON.parse(await readFile(executionLockFile, "utf8")) as { token?: unknown };
      if (lock.token === token) await rm(executionLockFile, { force: true });
    } catch {
      // Never remove a lock that cannot be confirmed as ours.
    }
  }
}

async function askForOperationApproval(operationId: string, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false;
  const rl = createInterface({ input: stdin, output: stdout });
  let onAbort: (() => void) | undefined;
  try {
    const question = rl.question("Approve this operation? (y/N): ").catch(() => "");
    const aborted = new Promise<string>((resolveQuestion) => {
      onAbort = () => resolveQuestion("");
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    const answer = await Promise.race([question, aborted]);
    return ["y", "yes"].includes(answer.trim().toLowerCase());
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    rl.close();
  }
}

async function runGoalExecution(goalId: string, resume: boolean): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error("Goal execution requires an interactive terminal and explicit approval.");
  await withExecutionLock(async () => {
    let goal = (await readGoals()).find((item) => item.id === goalId);
    if (!goal) throw new Error("Goal not found.");
    if (goal.tasks.length === 0 || goal.tasks.some((task) => task.operations.length === 0)) {
      throw new Error("Every executable task must contain at least one validated operation. Add an AI-generated plan before executing this goal.");
    }
    if (goal.status === "completed" || goal.status === "cancelled") throw new Error("This goal is already in a terminal state and cannot be executed.");
    if (!resume && goal.status !== "planned") throw new Error("Only a planned goal can be executed. Use gulz resume " + goalId + " for paused or interrupted work.");
    if (resume && !["paused", "running", "failed", "planned"].includes(goal.status)) {
      throw new Error("This goal cannot be resumed from its current state: " + goal.status + ".");
    }
    if (goal.status === "running") {
      for (const task of goal.tasks) if (task.status === "running") goal = transitionTask(goal, task.id, "paused");
      goal = transitionGoal(goal, "paused");
    }
    if (goal.status === "failed") {
      for (const task of goal.tasks) {
        if (task.status === "failed") goal = transitionTask(goal, task.id, "pending");
        else if (task.status === "running") goal = transitionTask(goal, task.id, "paused");
      }
      goal = transitionGoal(goal, "planned");
    }
    if (goal.status === "planned" || goal.status === "paused") goal = transitionGoal(goal, "running");
    await mutateGoalRecord(goalId, () => goal!);

    const controller = new AbortController();
    const onInterrupt = () => {
      warning("Interrupt received. GULZ is stopping safely and saving the current task state...");
      controller.abort();
    };
    process.once("SIGINT", onInterrupt);
    try {
      for (const initialTask of goal.tasks) {
        let latest = (await readGoals()).find((item) => item.id === goalId)!;
        let task = latest.tasks.find((item) => item.id === initialTask.id)!;
        if (["completed", "skipped"].includes(task.status)) continue;
        if (task.status === "failed") {
          latest = await mutateGoalRecord(goalId, (current) => transitionTask(current, task.id, "pending"));
          task = latest.tasks.find((item) => item.id === task.id)!;
        }
        if (task.status === "paused" || task.status === "pending" || task.status === "awaiting_approval") {
          latest = await mutateGoalRecord(goalId, (current) => transitionTask(current, task.id, "running"));
          task = latest.tasks.find((item) => item.id === task.id)!;
        }
        title("TASK · " + task.title);
        for (const operation of task.operations) {
          latest = (await readGoals()).find((item) => item.id === goalId)!;
          task = latest.tasks.find((item) => item.id === initialTask.id)!;
          if ((task.completedOperationIds ?? []).includes(operation.id)) {
            console.log(paint("✓ Already completed · " + operation.description, ansi.green));
            continue;
          }
          if (controller.signal.aborted) throw new Error("Execution interrupted by the user.");
          console.log("\n" + paint(operation.kind.toUpperCase(), ansi.bold, ansi.cyan) + " · " + operation.description);
          if (operation.target) label("Target", operation.target);
          if (operation.commandPreview) label("Command", operation.commandPreview);
          if (operation.kind === "delete_file" && operation.target) {
            const backupToken = createHash("sha256").update(operation.id).digest("hex").slice(0, 24);
            const backupPath = join(dirname(operation.target), ".gulz-deleted-" + backupToken);
            try {
              const backup = await executeLocalOperation(createPlannedOperation({
                id: randomUUID(), kind: "read_file", description: "Verify a prior reversible deletion backup",
                risk: "low", target: backupPath,
              }), { rootDirectory: process.cwd(), signal: controller.signal });
              let originalExists = false;
              try {
                await executeLocalOperation(createPlannedOperation({
                  id: randomUUID(), kind: "inspect", description: "Check original file after interrupted deletion",
                  risk: "low", target: operation.target,
                }), { rootDirectory: process.cwd(), signal: controller.signal });
                originalExists = true;
              } catch (error) {
                if (controller.signal.aborted) throw error;
                if (!(error instanceof Error) || !/not found|ENOENT/i.test(error.message)) throw error;
              }
              if (!originalExists && backup.output.kind === "file_content") {
                await mutateGoalRecord(goalId, (current) => {
                  const index = current.tasks.findIndex((item) => item.id === task.id);
                  const tasks = [...current.tasks];
                  const currentTask = tasks[index]!;
                  tasks[index] = { ...currentTask, completedOperationIds: [...new Set([...(currentTask.completedOperationIds ?? []), operation.id])], updatedAt: new Date().toISOString() };
                  return { ...current, tasks, updatedAt: new Date().toISOString() };
                });
                await recordAudit("operation.recovered", { goalId, taskId: task.id, operationId: operation.id, backupPath, verified: true });
                success("Previous deletion backup verified; operation checkpoint recovered.");
                continue;
              }
            } catch (error) {
              if (controller.signal.aborted) throw error;
              // No verified prior backup was found; the approved delete operation below will validate its target.
            }
          }
          if (operation.kind === "write_file" && operation.content !== undefined) {
            label("Content", Buffer.byteLength(operation.content, "utf8") + " bytes");
            console.log(operation.content.length > 400 ? operation.content.slice(0, 400) + "\n[content preview truncated]" : operation.content);
          }
          if (operation.risk !== "low") warning("Approval required · " + operation.risk.toUpperCase() + " risk");
          if (operation.kind === "write_file" && operation.content !== undefined) {
            try {
              const existing = await executeLocalOperation(createPlannedOperation({
                id: randomUUID(), kind: "read_file", description: "Check whether a previous write already completed",
                risk: "low", target: operation.target!,
              }), { rootDirectory: process.cwd(), signal: controller.signal });
              if (existing.output.content === operation.content) {
                await mutateGoalRecord(goalId, (current) => {
                  const index = current.tasks.findIndex((item) => item.id === task.id);
                  const tasks = [...current.tasks];
                  const currentTask = tasks[index]!;
                  tasks[index] = { ...currentTask, completedOperationIds: [...new Set([...(currentTask.completedOperationIds ?? []), operation.id])], updatedAt: new Date().toISOString() };
                  return { ...current, tasks, updatedAt: new Date().toISOString() };
                });
                await recordAudit("operation.recovered", { goalId, taskId: task.id, operationId: operation.id, verified: true });
                success("Write already exists with the expected content; checkpoint recovered.");
                continue;
              }
            } catch (error) {
              if (controller.signal.aborted) throw error;
              // Missing files and unreadable targets are handled by the approved write operation below.
            }
          }
          if (operation.requiresApproval) {
            const approved = await askForOperationApproval(operation.id, controller.signal);
            if (!approved) {
              await mutateGoalRecord(goalId, (current) => {
                const pausedTask = current.tasks.find((item) => item.id === task.id)?.status === "running"
                  ? transitionTask(current, task.id, "paused") : current;
                return pausedTask.status === "running" ? transitionGoal(pausedTask, "paused") : pausedTask;
              });
              await recordAudit("operation.approval_declined", { goalId, taskId: task.id, operationId: operation.id });
              warning("Execution paused. No unapproved operation was run. Use gulz resume " + goalId + " when ready.");
              return;
            }
          }
          const result = await executeLocalOperation(operation, {
            rootDirectory: process.cwd(),
            approved: operation.requiresApproval,
            signal: controller.signal,
            timeoutMs: operation.command === "npm" ? 180_000 : 5_000,
          });
          if (!result.verified || (result.output.kind === "command_result" && result.output.exitCode !== 0)) {
            throw new Error("GULZ could not verify operation " + operation.id + ".");
          }
          await recordExecutionAudit(result);
          await mutateGoalRecord(goalId, (current) => {
            const index = current.tasks.findIndex((item) => item.id === task.id);
            const tasks = [...current.tasks];
            const currentTask = tasks[index]!;
            tasks[index] = {
              ...currentTask,
              completedOperationIds: [...new Set([...(currentTask.completedOperationIds ?? []), operation.id])],
              updatedAt: new Date().toISOString(),
            };
            return { ...current, tasks, updatedAt: new Date().toISOString() };
          });
          success("Verified · " + operation.description);
          if (result.output.kind === "file_deleted" && result.output.backupPath) label("Recovery backup", result.output.backupPath);
        }
        await mutateGoalRecord(goalId, (current) => {
          const completed = transitionTask(current, initialTask.id, "completed");
          const tasks = completed.tasks.map((item) => item.id === initialTask.id ? { ...item, result: "All planned operations completed and verified." } : item);
          return { ...completed, tasks };
        });
        success("Task completed · " + initialTask.title);
      }
      await mutateGoalRecord(goalId, (current) => transitionGoal(current, "completed"));
      await recordAudit("goal.completed", { goalId, verified: true });
      success("Goal completed. Every planned operation was verified.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const latest = (await readGoals()).find((item) => item.id === goalId);
      if (latest?.status === "running") {
        await mutateGoalRecord(goalId, (current) => {
          const active = current.tasks.find((item) => item.status === "running");
          let next = current;
          if (active) {
            next = transitionTask(next, active.id, controller.signal.aborted ? "paused" : "failed");
            const tasks = next.tasks.map((item) => item.id === active.id ? { ...item, error: message } : item);
            next = { ...next, tasks };
          }
          if (next.status === "running") next = transitionGoal(next, controller.signal.aborted ? "paused" : "failed");
          return { ...next, ...(controller.signal.aborted ? {} : { failureReason: message }) };
        });
      }
      await recordAudit(controller.signal.aborted ? "goal.paused" : "goal.failed", { goalId, reason: message });
      if (controller.signal.aborted) warning("Execution paused safely. Use gulz resume " + goalId + " to continue.");
      else failure("Goal execution stopped: " + message);
      if (!controller.signal.aborted) process.exitCode = 1;
    } finally {
      process.removeListener("SIGINT", onInterrupt);
    }
  });
}

async function recordExecutionAudit(result: LocalExecutionResult): Promise<void> {
  await recordAudit("operation." + result.audit.kind, {
    operationId: result.operationId,
    target: result.audit.target,
    risk: result.audit.risk,
    outcome: result.audit.outcome,
    verified: result.verified,
    detail: result.audit.detail,
    backupPath: result.output.backupPath,
    sha256: result.output.sha256,
  });
}

async function withGoalsLock<T>(run: () => Promise<T>): Promise<T> {
  await ensureDataHome();
  const token = randomUUID();
  const started = Date.now();
  while (true) {
    try {
      await writeFile(goalsLockFile, JSON.stringify({ pid: process.pid, token }), {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() - started > 15_000) {
        throw new Error(`GULZ storage is locked by another process. If no GULZ process is running, remove the stale lock file at ${goalsLockFile} and retry.`);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
  }

  try {
    return await run();
  } finally {
    try {
      const lock = JSON.parse(await readFile(goalsLockFile, "utf8")) as { token?: unknown };
      if (lock.token === token) await rm(goalsLockFile, { force: true });
    } catch {
      // Never remove a lock that cannot be confirmed as ours.
    }
  }
}

async function doctor(): Promise<boolean> {
  title("GULZ SYSTEM CHECK");
  label("Version", VERSION);
  label("Platform", `${platform()} (${arch()})`);
  label("OS release", release());
  label("Node.js", process.version);
  label("Data folder", dataHome);
  const [major, minor] = process.versions.node.split(".").map(Number);
  let ok = true;
  if (major! < 20 || (major === 20 && minor! < 19)) {
    failure("Node.js 20.19 or newer is required");
    ok = false;
  } else success("Node.js version is supported");
  const git = spawnSync("git", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (git.status === 0) success("Git is available · " + git.stdout.trim());
  else { failure("Git is unavailable or could not be started"); ok = false; }
  try {
    await ensureDataHome();
    await access(dataHome, constants.R_OK | constants.W_OK);
    success("Local storage is ready");
    try {
      const provider = await readProviderConfig();
      if (provider) success("AI provider configured · " + new URL(provider.baseUrl).host + " / " + provider.model);
      else warning("No AI provider configured; local CLI features remain available.");
    } catch (error) {
      failure("AI provider settings are invalid · " + (error instanceof Error ? error.message : String(error)));
      ok = false;
    }
    try {
      const auditInfo = await lstat(auditFile);
      if (!auditInfo.isFile() || auditInfo.isSymbolicLink()) throw new Error("Audit history is not a regular file.");
      await chmod(auditFile, 0o600);
      success("Activity history is available");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") success("Activity history will be created when needed");
      else throw error;
    }
    try {
      await lstat(executionLockFile);
      warning("An execution lock exists. Check that no other GULZ execution is active before continuing.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return ok;
  } catch (error) {
    failure("Local storage is unavailable");
    console.error(error instanceof Error ? error.message : String(error));
    return false;
  }
}


async function updateInstallation(): Promise<void> {
  const installDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  if (!existsSync(join(installDirectory, ".git")) || !existsSync(join(installDirectory, "package.json"))) {
    throw new Error("This GULZ installation is not linked from a source checkout. Published package updates are not available yet. Follow the platform update instructions at gulz.gaxity.com.ng.");
  }
  if (!stdin.isTTY || !stdout.isTTY) throw new Error("Updates require an interactive terminal and confirmation.");
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    title("UPDATE GULZ");
    console.log("Repository: " + installDirectory);
    console.log("GULZ will download the latest CLI source, rebuild it and refresh the command.");
    console.log("Your saved conversations, provider settings and local data will be preserved.");
    const confirmation = await rl.question("Continue with the update? (y/N): ");
    if (!["y", "yes"].includes(confirmation.trim().toLowerCase())) { console.log("Update cancelled."); return; }
  } finally { rl.close(); }
  await withExecutionLock(async () => {
    const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: installDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (dirty.error) throw dirty.error;
    if (dirty.status !== 0) throw new Error("Unable to inspect the source checkout before updating.");
    if (dirty.stdout.trim()) throw new Error("The GULZ source checkout has uncommitted changes. Commit or safely stash them before running gulz update.");
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const updateEnv: NodeJS.ProcessEnv = { ...process.env };
    if (process.platform !== "win32") updateEnv.NPM_CONFIG_PREFIX = process.env.PREFIX?.includes("com.termux") ? process.env.PREFIX : join(homedir(), ".local");
    const steps = [
      ["git", ["pull", "--ff-only"]],
      [npm, ["run", "install:cli"]],
    ] as const;
    for (const [program, args] of steps) {
      console.log("\n$ " + program + " " + args.join(" "));
      const result = spawnSync(program, [...args], { cwd: installDirectory, stdio: "inherit", shell: process.platform === "win32", env: updateEnv });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error("Update stopped because " + program + " exited with status " + String(result.status) + ". Fix the reported issue and run gulz update again.");
    }
    success("GULZ source updated and rebuilt.");

    const setupRl = createInterface({ input: stdin, output: stdout });
    let changeProvider = "";
    try {
      changeProvider = await setupRl.question("Would you like to set up or change your AI provider now? (y/N): ");
    } finally { setupRl.close(); }
    if (["y", "yes"].includes(changeProvider.trim().toLowerCase())) {
      const choiceRl = createInterface({ input: stdin, output: stdout });
      let choice = "";
      try {
        console.log("\n  1) Built-in GULZ AI");
        console.log("  2) Use my own AI provider / choose a model");
        console.log("  3) Keep my current settings");
        choice = await choiceRl.question("Choose 1, 2 or 3: ");
      } finally { choiceRl.close(); }
      const action = choice.trim() === "1" ? "builtin" : choice.trim() === "2" ? "configure" : "";
      if (action) {
        const cliEntry = join(installDirectory, "apps", "cli", "dist", "index.js");
        const configured = spawnSync(process.execPath, [cliEntry, "provider", action], { stdio: "inherit", env: updateEnv });
        if (configured.error) throw configured.error;
        if (configured.status !== 0) throw new Error("The source update succeeded, but AI provider setup did not finish.");
        const tested = spawnSync(process.execPath, [cliEntry, "provider", "test"], { stdio: "inherit", env: updateEnv });
        if (tested.error) throw tested.error;
        if (tested.status !== 0) warning("The source update succeeded, but the AI connection test did not pass. You can retry with gulz provider test.");
      } else if (choice.trim() !== "3") {
        warning("No provider changes were made. Your existing settings were preserved.");
      }
    }
    console.log("\nGULZ update completed. Close this session and run gulz again to use the updated CLI.");
  });
}

async function interactiveSession(): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) {
    help();
    console.log("\nTip: run gulz in a terminal to open the interactive assistant.");
    return;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  const ask = async (question: string): Promise<string> => (await rl.question(question)).trim();
  const showMenu = (): void => {
    console.log("\n" + paint("GULZ", ansi.bold, ansi.cyan) + paint("  YOUR AI, READY TO WORK.", ansi.bold));
    console.log(paint("Tell GULZ what you need. Keep chatting naturally.", ansi.dim));
    console.log("\n  " + paint("1.", ansi.cyan) + " Chat with GULZ");
    console.log("  " + paint("2.", ansi.cyan) + " System check");
    console.log("  " + paint("3.", ansi.cyan) + " AI provider settings");
    console.log("  " + paint("4.", ansi.cyan) + " Connected VPS environments");
    console.log("  " + paint("5.", ansi.cyan) + " Recent activity");
    console.log("  " + paint("6.", ansi.cyan) + " Update GULZ");
    console.log("  " + paint("7.", ansi.cyan) + " Help");
    console.log("  " + paint("0.", ansi.dim) + " Exit");
  };
  const runCli = async (args: string[]): Promise<number | null> => {
    rl.close();
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { stdio: "inherit", env: process.env });
    if (result.error) throw result.error;
    return result.status;
  };
  try {
    title("WELCOME TO GULZ");
    console.log("Your conversations and local settings are saved on this device in " + paint(dataHome, ansi.cyan));
    const configuredProvider = await readProviderConfig().catch(() => null);
    if (configuredProvider) warning("AI is ready. Chat naturally; GULZ can use the tools available in your environment.");
    else warning("AI is not set up yet. Choose option 3 to connect built-in GULZ AI or your own provider.");
    while (true) {
      showMenu();
      const choice = await ask("\nChoose an option: ");
      if (choice === "0" || ["exit", "quit", "q"].includes(choice.toLowerCase())) {
        success("See you next time. Your conversations and settings remain on this device.");
        break;
      }
      if (choice === "1" || choice.toLowerCase() === "chat") {
        await runCli(["chat"]);
        return await interactiveSession();
      }
      if (choice === "2" || choice.toLowerCase() === "doctor") {
        await doctor();
        continue;
      }
      if (choice === "3" || choice.toLowerCase() === "provider" || choice.toLowerCase() === "settings") {
        console.log("\n  1) Built-in GULZ AI");
        console.log("  2) Connect my own AI provider / model");
        console.log("  3) Test current AI connection");
        console.log("  4) View provider status");
        console.log("  5) Remove provider settings");
        console.log("  0) Back");
        const setupChoice = await ask("Choose an option: ");
        if (setupChoice === "0" || !setupChoice) continue;
        const action = setupChoice === "1" ? "builtin" : setupChoice === "2" ? "configure" : setupChoice === "3" ? "test" : setupChoice === "4" ? "status" : setupChoice === "5" ? "remove" : "";
        if (!action) { warning("Choose 1, 2, 3, 4, 5 or 0."); continue; }
        const result = await runCli(["provider", action]);
        if (result === 0 && (action === "builtin" || action === "configure")) await runCli(["provider", "test"]);
        return await interactiveSession();
      }
      if (choice === "4" || ["remote", "vps", "servers"].includes(choice.toLowerCase())) {
        const environments = await readRemoteEnvironments();
        console.log("\nConnected VPS environments:");
        if (environments.length) for (const environment of environments) console.log("  " + environment.name + " · " + environment.destination + " · " + environment.workspace);
        else console.log("  None connected yet.");
        console.log("\n  1) Add a VPS");
        console.log("  2) Test a VPS connection");
        console.log("  3) Remove a VPS connection");
        console.log("  0) Back");
        const remoteChoice = await ask("Choose an option: ");
        if (remoteChoice === "0" || !remoteChoice) continue;
        if (remoteChoice === "1") {
          const name = await ask("Connection name (e.g. production): ");
          const destination = await ask("SSH destination (user@host or SSH config alias): ");
          const workspace = await ask("Existing remote workspace path (blank for SSH home): ");
          const remoteArgs = ["remote", "add", name, destination];
          if (workspace) remoteArgs.push(workspace);
          await runCli(remoteArgs);
          return await interactiveSession();
        }
        if (remoteChoice === "2") {
          const name = await ask("Saved connection name: ");
          await runCli(["remote", "test", name]);
          return await interactiveSession();
        }
        if (remoteChoice === "3") {
          const name = await ask("Saved connection name: ");
          await runCli(["remote", "remove", name]);
          return await interactiveSession();
        }
        warning("Choose 1, 2, 3 or 0.");
        continue;
      }
      if (choice === "5" || ["activity", "audit"].includes(choice.toLowerCase())) {
        await runCli(["audit"]);
        return await interactiveSession();
      }
      if (choice === "6" || choice.toLowerCase() === "update") {
        rl.close();
        await updateInstallation();
        return;
      }
      if (choice === "7" || choice.toLowerCase() === "help") {
        help();
        continue;
      }
      warning("Choose 1, 2, 3, 4, 5, 6, 7 or 0.");
    }
  } finally {
    rl.close();
  }
}


async function readConversation(): Promise<ProviderChatMessage[]> {
  await ensureDataHome();
  try {
    const info = await lstat(conversationFile);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Conversation storage must be a regular file, not a symbolic link.");
    await chmod(conversationFile, 0o600);
    const parsed: unknown = JSON.parse(await readFile(conversationFile, "utf8"));
    if (!Array.isArray(parsed) || parsed.length > 40 || !parsed.every((item) =>
      isRecord(item) && (item.role === "user" || item.role === "assistant") &&
      typeof item.content === "string" && item.content.length > 0 && item.content.length <= 8000)) {
      throw new Error("Saved conversation is invalid. It was left untouched.");
    }
    return parsed as ProviderChatMessage[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function saveConversation(messages: ProviderChatMessage[]): Promise<void> {
  await ensureDataHome();
  const bounded = messages.slice(-40);
  const temporary = join(dataHome, "conversation." + randomUUID() + ".tmp");
  try {
    await writeFile(temporary, JSON.stringify(bounded, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, conversationFile);
    await chmod(conversationFile, 0o600);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function runRemoteAgentStdio(): Promise<void> {
  const initialWorkingDirectory = process.cwd();
  const controller = new AbortController();
  const onTerminate = () => controller.abort();
  process.once("SIGHUP", onTerminate);
  process.once("SIGTERM", onTerminate);
  stdout.on("error", onTerminate);
  const rl = createInterface({ input: stdin, crlfDelay: Infinity, terminal: false });
  try {
    for await (const rawLine of rl) {
      const line = String(rawLine);
      let requestId = "";
      try {
        if (Buffer.byteLength(line, "utf8") > 1700000) throw new Error("Remote request exceeds the 1.7 MB protocol limit.");
        const request: unknown = JSON.parse(line);
        if (!isRecord(request) || request.protocolVersion !== 1 || !isNonEmptyString(request.requestId) ||
            !isNonEmptyString(request.toolName) || !isRecord(request.arguments) || typeof request.approved !== "boolean" ||
            (request.workspaceRoot !== undefined && !isNonEmptyString(request.workspaceRoot))) {
          throw new Error("Remote agent request has an invalid protocol shape.");
        }
        requestId = request.requestId;
        const workspaceRoot = validateRemoteWorkspace(typeof request.workspaceRoot === "string" ? request.workspaceRoot : ".");
        const requestedPath = workspaceRoot === "." ? initialWorkingDirectory : resolve(workspaceRoot);
        const info = await lstat(requestedPath);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("The configured remote workspace must be an existing, non-symlink directory.");
        const canonicalPath = await realpath(requestedPath);
        if (canonicalPath !== requestedPath) throw new Error("The configured remote workspace resolves through a symbolic link and was rejected.");
        const tools = createLocalAgentTools(canonicalPath);
        const registry = new Map<string, (typeof tools)[number]>(tools.map((tool): [string, (typeof tools)[number]] => [tool.definition.name, tool]));
        const tool = registry.get(request.toolName);
        if (!tool) throw new Error("Remote tool is not registered on this host.");
        if (tool.requiresApproval(request.arguments) && request.approved !== true) {
          throw new Error("Remote policy denied this operation because the controller did not provide an approval.");
        }
        const output = await tool.execute(request.arguments, { approved: request.approved, signal: controller.signal });
        await recordAudit("remote.agent.tool", {
          toolName: request.toolName,
          outcome: isRecord(output) && output.processSucceeded === false ? "process_failed" : isRecord(output) && output.verified === true ? "verified" : "returned",
        });
        const response = { protocolVersion: 1, requestId, ok: true, output };
        const serialized = JSON.stringify(response);
        if (Buffer.byteLength(serialized, "utf8") > 650000) throw new Error("Remote tool output exceeded the 650 KB response limit.");
        stdout.write(serialized + "\n");
      } catch (error) {
        const response = { protocolVersion: 1, requestId, ok: false, error: error instanceof Error ? error.message : "Remote agent operation failed." };
        stdout.write(JSON.stringify(response) + "\n");
      }
    }
  } finally {
    process.off("SIGHUP", onTerminate);
    process.off("SIGTERM", onTerminate);
    stdout.off("error", onTerminate);
    rl.close();
  }
}


async function chatSession(): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error("GULZ chat requires an interactive terminal.");
  const config = await readProviderConfig();
  if (!config) throw new Error("AI is not configured. Run gulz provider builtin or choose AI setup from the GULZ menu.");
  const remoteEnvironments = await readRemoteEnvironments();
  const remoteTransport = new OpenSshRemoteTransport(
    Object.fromEntries(remoteEnvironments.map((item): [string, string] => [item.name, item.destination])),
    Object.fromEntries(remoteEnvironments.map((item): [string, string] => [item.name, item.workspace])),
  );
  const agentTools = [
    ...createLocalAgentTools(process.cwd()),
    ...remoteEnvironments.flatMap((item) => createRemoteAgentTools(remoteTransport, item.name)),
  ];
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    title("GULZ AI");
    console.log("Chat naturally. GULZ can work in this workspace and on your " + remoteEnvironments.length + " connected VPS environment(s). Changes and commands require approval. Type /clear to erase history or /exit to leave.");
    const messages = await readConversation();
    if (messages.length) {
      for (const message of messages.slice(-12)) {
        const speaker = message.role === "user" ? "You" : "GULZ";
        const color = message.role === "user" ? ansi.green : ansi.cyan;
        console.log("\n" + paint(speaker, color, ansi.bold) + "\n" + message.content);
      }
    }
    while (true) {
      const input = (await rl.question("\n" + paint("You › ", ansi.green, ansi.bold))).trim();
      if (!input) continue;
      if (input.toLowerCase() === "/exit" || input.toLowerCase() === "/quit") break;
      if (input.toLowerCase() === "/clear") {
        const confirmation = await rl.question("Clear the saved conversation? (y/N): ");
        if (["y", "yes"].includes(confirmation.trim().toLowerCase())) {
          messages.length = 0;
          await saveConversation(messages);
          success("Conversation cleared.");
        }
        continue;
      }
      if (input.length > 8000) {
        warning("That message is too long. Keep each message under 8,000 characters.");
        continue;
      }
      messages.push({ role: "user", content: input });
      const turnController = new AbortController();
      const cancelTurn = () => turnController.abort();
      process.once("SIGINT", cancelTurn);
      process.once("SIGTERM", cancelTurn);
      try {
        const result = await runAgent({
          provider: config,
          signal: turnController.signal,
          messages: messages.slice(-30).map((message) => ({ role: message.role, content: message.content })),
          tools: agentTools,
          approve: async (request) => {
            title("GULZ ACTION REQUEST");
            console.log(request.description);
            console.log("Tool: " + request.toolName);
            if (typeof request.arguments.command === "string") console.log("$ " + request.arguments.command + " " + (Array.isArray(request.arguments.args) ? request.arguments.args.join(" ") : ""));
            console.log("Details: " + JSON.stringify(request.arguments, null, 2));
            if (request.risk === "high") warning("HIGH-IMPACT ACTION: this may change system services, permissions, users or network security. Review every argument carefully.");
            else warning("This action can change files or run a program on the selected device/server.");
            warning("Tool results and command output may be sent to your configured AI provider. Do not approve commands that expose passwords, API keys or private data.");
            const answer = await rl.question("Allow GULZ to continue? (y/N): ");
            return ["y", "yes"].includes(answer.trim().toLowerCase());
          },
          onToolResult: async (toolName, toolResult) => {
            const output = isRecord(toolResult) && isRecord(toolResult.output) ? toolResult.output : {};
            const ok = isRecord(toolResult) && toolResult.ok === true && output.processSucceeded !== false && output.verified !== false;
            await recordAudit("agent.tool", { toolName, outcome: ok ? "succeeded" : "not_completed" });
          },
        });
        const answer = result.reply || "The requested tool operations finished, but the AI did not provide a final explanation.";
        messages.push({ role: "assistant", content: answer });
        await saveConversation(messages);
        console.log("\n" + paint("GULZ", ansi.cyan, ansi.bold) + "\n" + answer);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failureReply = "I couldn't finish that request: " + message;
        messages.push({ role: "assistant", content: failureReply });
        await saveConversation(messages);
        warning(failureReply);
      } finally {
        process.off("SIGINT", cancelTurn);
        process.off("SIGTERM", cancelTurn);
      }
    }
  } finally {
    rl.close();
  }
}

async function remoteCommand(args: string[]): Promise<void> {
  const [action, ...values] = args;
  if (!action || action === "list") {
    const environments = await readRemoteEnvironments();
    if (!environments.length) {
      console.log("No VPS environments connected yet.");
      console.log("Add one with: gulz remote add <name> <user@host>");
      return;
    }
    title("CONNECTED VPS ENVIRONMENTS");
    for (const environment of environments) {
      console.log("  " + environment.name + "  ·  " + environment.destination + "  ·  " + environment.workspace);
    }
    console.log("\nThe remote host must have a compatible GULZ CLI installed and its SSH host key verified.");
    return;
  }
  if (action === "add") {
    if (values.length < 2 || values.length > 3) { console.error("Usage: gulz remote add <name> <user@host-or-ssh-alias> [remote-workspace]"); process.exitCode = 2; return; }
    const name = validateRemoteAlias(values[0]!);
    const destination = validateRemoteDestination(values[1]!);
    const workspace = validateRemoteWorkspace(values[2] ?? ".");
    const environments = await readRemoteEnvironments();
    if (environments.some((item) => item.name === name)) throw new Error("A remote environment with that name already exists. Remove it first or choose another name.");
    if (!stdin.isTTY || !stdout.isTTY) throw new Error("Adding a remote environment requires an interactive terminal.");
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      title("CONNECT A VPS");
      console.log("Name: " + name);
      console.log("SSH destination: " + destination);
      console.log("GULZ will use your existing OpenSSH configuration and SSH agent. It will not store your private key or password.");
      warning("Strict host-key verification is enabled. GULZ will never automatically accept an unknown or changed host key.");
      const confirmation = await rl.question("Check this VPS over SSH? (y/N): ");
      if (!["y", "yes"].includes(confirmation.trim().toLowerCase())) { console.log("Connection cancelled."); return; }
      const transport = new OpenSshRemoteTransport({ [name]: destination }, { [name]: workspace });
      const capabilities = await transport.testDestination(destination);
      const environmentInfo = await transport.invoke({ environmentId: name, toolName: "inspect_environment", arguments: {}, approved: false });
      console.log("Remote GULZ version: " + capabilities.version);
      console.log("Remote workspace: " + workspace);
      console.log("Environment: " + JSON.stringify(environmentInfo));
      console.log("Remote tools: " + capabilities.tools.join(", "));
      const save = await rl.question("Save this VPS connection for GULZ chat? (y/N): ");
      if (!["y", "yes"].includes(save.trim().toLowerCase())) { console.log("Connection was tested but not saved."); return; }
      await saveRemoteEnvironments([...environments, { name, destination, workspace, addedAt: new Date().toISOString() }]);
      await recordAudit("remote.environment_added", { name, destination });
      success("VPS connection saved. Its tools will be available in gulz chat.");
    } finally { rl.close(); }
    return;
  }
  if (action === "test") {
    if (values.length !== 1) { console.error("Usage: gulz remote test <name>"); process.exitCode = 2; return; }
    const environments = await readRemoteEnvironments();
    const environment = environments.find((item) => item.name === values[0]);
    if (!environment) throw new Error("Remote environment not found.");
    const transport = new OpenSshRemoteTransport({ [environment.name]: environment.destination }, { [environment.name]: environment.workspace });
    const capabilities = await transport.testDestination(environment.destination);
    const environmentInfo = await transport.invoke({ environmentId: environment.name, toolName: "inspect_environment", arguments: {}, approved: false });
    success("Remote GULZ agent is reachable · version " + capabilities.version);
    label("Workspace", environment.workspace);
    label("Environment", JSON.stringify(environmentInfo));
    label("Tools", capabilities.tools.join(", "));
    return;
  }
  if (action === "remove") {
    if (values.length !== 1) { console.error("Usage: gulz remote remove <name>"); process.exitCode = 2; return; }
    if (!stdin.isTTY || !stdout.isTTY) throw new Error("Removing a remote environment requires an interactive terminal.");
    const environments = await readRemoteEnvironments();
    const environment = environments.find((item) => item.name === values[0]);
    if (!environment) throw new Error("Remote environment not found.");
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      console.log("Remove connection " + environment.name + " (" + environment.destination + ") from GULZ?");
      const confirmation = await rl.question("Remove this saved connection? (y/N): ");
      if (!["y", "yes"].includes(confirmation.trim().toLowerCase())) { console.log("Nothing changed."); return; }
      await saveRemoteEnvironments(environments.filter((item) => item.name !== environment.name));
      await recordAudit("remote.environment_removed", { name: environment.name });
      success("Remote connection removed from GULZ. The VPS itself was not changed.");
    } finally { rl.close(); }
    return;
  }
  console.error("Usage: gulz remote <list|add|test|remove>");
  process.exitCode = 2;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command) return interactiveSession();
  if (command === "--help" || command === "-h") return help();
  if (command === "--version" || command === "-v") {
    console.log(`GULZ ${VERSION}`);
    return;
  }
  if (command === "init") {
    await withGoalsLock(async () => {
      const goals = await readGoals();
      try {
        await access(goalsFile);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await saveGoals(goals);
      }
    });
    success("GULZ is initialized");
    console.log(`Local data: ${dataHome}`);
    return;
  }

  if (command === "cancel") {
    const id = args[0];
    if (!id || args.length !== 1) { console.error("Usage: gulz cancel <goal-id>"); process.exitCode = 2; return; }
    if (!stdin.isTTY || !stdout.isTTY) throw new Error("Cancelling a goal requires an interactive terminal and explicit confirmation.");
    const goal = (await readGoals()).find((item) => item.id === id);
    if (!goal) throw new Error("Goal not found.");
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      warning("This cancels the goal and all unfinished tasks. Completed work and its audit history are preserved.");
      const confirmation = await rl.question("Cancel this goal and its unfinished tasks? (y/N): ");
      if (!["y", "yes"].includes(confirmation.trim().toLowerCase())) { console.log("Cancellation aborted."); return; }
    } finally { rl.close(); }
    await withExecutionLock(async () => {
      await mutateGoalRecord(id, (current) => {
        let next = current;
        for (const task of current.tasks) {
          if (!["completed", "skipped", "cancelled"].includes(task.status)) next = transitionTask(next, task.id, "cancelled");
        }
        return transitionGoal(next, "cancelled");
      });
      await recordAudit("goal.cancelled", { goalId: id });
    });
    success("Goal cancelled. Completed work and saved data were preserved.");
    return;
  }
  if (command === "execute" || command === "resume") {
    const id = args[0];
    if (!id || args.length !== 1) { console.error("Usage: gulz " + command + " <goal-id>"); process.exitCode = 2; return; }
    await runGoalExecution(id, command === "resume");
    return;
  }
  if (command === "provider") {
    const action = args[0] ?? "status";
    if (action === "test") {
      if (args.length > 1) { console.error("Usage: gulz provider test"); process.exitCode = 2; return; }
      const config = await readProviderConfig();
      if (!config) throw new Error("No AI provider is configured. Choose the built-in GULZ AI with 'gulz provider builtin' or configure your own with 'gulz provider configure'.");
      title("TEST AI CONNECTION");
      console.log("Sending a small sample request only. No workspace files or saved goals are included.");
      const plan = await generateGoalPlan(config, {
        title: "GULZ AI connection test",
        description: "Create a tiny safe test plan with exactly one inspect operation targeting the current workspace root. Return the required structured JSON only.",
      });
      const operationCount = plan.tasks.reduce((total, task) => total + task.operations.length, 0);
      if (!plan.tasks.length || !operationCount) throw new Error("The AI connection responded, but did not return a usable plan.");
      success("AI connection works and returned a valid structured plan.");
      label("Test tasks", String(plan.tasks.length));
      label("Test operations", String(operationCount));
      console.log("The test plan was discarded. Nothing was saved or executed.");
      return;
    }
    if (action === "builtin") {
      if (args.length > 1) { console.error("Usage: gulz provider builtin"); process.exitCode = 2; return; }
      if (process.env.GULZ_AI_BASE_URL || process.env.GULZ_AI_MODEL || process.env.GULZ_AI_API_KEY) {
        throw new Error("AI provider settings are controlled by GULZ_AI_* environment variables. Remove them before selecting the built-in provider.");
      }
      await saveProviderConfig({
        baseUrl: "https://apis.nabeestech.com/api/v1/ai/gpt5-luna",
        model: "gpt5-luna",
        apiKey: "nabeestech",
      });
      success("Built-in GULZ AI is ready");
      return;
    }
    if (action === "status") {
      const config = await readProviderConfig();
      title("AI PROVIDER");
      if (!config) { warning("No provider configured. Run gulz provider builtin for the recommended setup, or gulz provider configure to use your own."); return; }
      const isBuiltin = config.model === "gpt5-luna" && new URL(config.baseUrl).pathname.replace(/\/$/, "").endsWith("/gpt5-luna");
      success("Provider settings are available");
      label("Provider", isBuiltin ? "Built-in GULZ AI" : new URL(config.baseUrl).host);
      label("Model", config.model);
      label("API key", "Stored privately; value hidden");
      return;
    }
    if (action === "configure") {
      if (!stdin.isTTY || !stdout.isTTY) throw new Error("Provider configuration requires an interactive terminal.");
      if (process.env.GULZ_AI_BASE_URL || process.env.GULZ_AI_MODEL || process.env.GULZ_AI_API_KEY) {
        throw new Error("Provider settings are supplied by GULZ_AI_* environment variables. Update those variables instead of saving a second configuration.");
      }
      let existing: StoredProviderConfig | null = null;
      try {
        existing = await readProviderConfig();
      } catch (error) {
        const info = await lstat(providerFile).catch((fileError) => {
          if ((fileError as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw fileError;
        });
        if (!info || !info.isFile() || info.isSymbolicLink()) throw error;
        warning("Saved provider settings could not be read. The new configuration will replace the regular settings file.");
      }
      const rl = createInterface({ input: stdin, output: stdout });
      let baseUrl: string;
      let model: string;
      try {
        title("CONFIGURE AI PROVIDER");
        console.log("GULZ supports OpenAI-compatible chat-completions APIs. Use an HTTPS endpoint; localhost is allowed for local model servers.");
        baseUrl = (await rl.question("Base URL" + (existing ? " [" + existing.baseUrl + "]" : "") + ": ")).trim() || existing?.baseUrl || "";
        model = (await rl.question("Model name" + (existing ? " [" + existing.model + "]" : "") + ": ")).trim() || existing?.model || "";
      } finally { rl.close(); }
      const apiKey = await askSecret(existing ? "API key (leave blank to keep the current key): " : "API key (input hidden): ");
      const finalKey = apiKey || existing?.apiKey || "";
      if (!finalKey) throw new Error("An API key is required.");
      const validated: OpenAICompatibleProviderConfig = { baseUrl, model, apiKey: finalKey };
      const parsed = new URL(baseUrl);
      if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("Provider URL must not contain credentials, query parameters or fragments.");
      if (!["https:", "http:"].includes(parsed.protocol) || (parsed.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))) {
        throw new Error("Provider URL must use HTTPS. HTTP is allowed only for localhost.");
      }
      if (!model.trim()) throw new Error("A model name is required.");
      await saveProviderConfig(validated);
      success("Provider settings saved");
      console.log("API key stored in " + providerFile + " with owner-only permissions where supported.");
      return;
    }
    if (action === "remove") {
      if (process.env.GULZ_AI_BASE_URL || process.env.GULZ_AI_MODEL || process.env.GULZ_AI_API_KEY) {
        throw new Error("Provider settings are supplied by environment variables; remove GULZ_AI_* from your environment instead.");
      }
      let info: Stats;
      try { info = await lstat(providerFile); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") { console.log("No saved provider settings were found."); return; }
        throw error;
      }
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Provider settings must be a regular file, not a symbolic link.");
      if (!stdin.isTTY || !stdout.isTTY) throw new Error("Removing provider settings requires an interactive terminal.");
      const rl = createInterface({ input: stdin, output: stdout });
      try {
        const confirmation = await rl.question("Remove the saved AI provider settings? (y/N): ");
        if (!["y", "yes"].includes(confirmation.trim().toLowerCase())) { console.log("Removal cancelled."); return; }
      } finally { rl.close(); }
      await rm(providerFile, { force: true });
      success("Saved provider settings removed");
      return;
    }
    console.error("Usage: gulz provider [builtin|configure|status|remove]");
    process.exitCode = 2;
    return;
  }
  if (command === "remote") {
    await remoteCommand(args);
    return;
  }
  if (command === "agent" && args[0] === "--capabilities") {
    if (args.length !== 1) { console.error("Usage: gulz agent --capabilities"); process.exitCode = 2; return; }
    console.log(JSON.stringify({ protocolVersion: 1, version: VERSION, tools: createLocalAgentTools(process.cwd()).map((tool) => tool.definition.name) }));
    return;
  }
  if (command === "agent" && args[0] === "--stdio") {
    if (args.length !== 1) { console.error("Usage: gulz agent --stdio"); process.exitCode = 2; return; }
    await runRemoteAgentStdio();
    return;
  }
  if (command === "chat") {
    if (args.length) { console.error("Usage: gulz chat"); process.exitCode = 2; return; }
    await chatSession();
    return;
  }
  if (command === "do") {
    const request = args.join(" ").trim();
    if (!request) {
      console.error('Usage: gulz do "Describe what you want GULZ to do"');
      process.exitCode = 2;
      return;
    }
    if (!stdin.isTTY || !stdout.isTTY) throw new Error("The AI task workflow needs an interactive terminal for reviewing and approving operations.");
    const config = await readProviderConfig();
    if (!config) throw new Error("AI is not set up yet. Run 'gulz provider builtin' or open 'gulz' and choose AI setup first.");
    title("LET GULZ HANDLE IT");
    console.log(request);
    console.log("Using your configured AI provider. Your request is sent directly; workspace files are not uploaded automatically.");
    console.log(paint("\nUnderstanding your request and preparing a safe plan...", ansi.cyan));
    const generated = await generateGoalPlan(config, { title: "User request", description: request });
    const goalId = randomUUID();
    const goalTitle = (generated.summary || request).trim().slice(0, 120) || "AI task";
    const created = await withGoalsLock(async () => {
      let goal = createGoal({ id: goalId, title: goalTitle, description: request });
      for (const item of generated.tasks) {
        goal = addGoalTask(goal, {
          id: randomUUID(),
          title: item.title,
          description: item.description,
          operations: validatePlannedOperations(item.operations),
        });
      }
      goal = transitionGoal(goal, "planned");
      const goals = await readGoals();
      await saveGoals([...goals, goal]);
      await recordAudit("goal.created_by_ai", { goalId, provider: config.model, tasks: generated.tasks.length });
      return goal;
    });

    success("GULZ created a task plan for your request");
    console.log(generated.summary);
    for (const [index, task] of created.tasks.entries()) {
      console.log(paint("\n" + (index + 1) + ". " + task.title, ansi.bold, ansi.cyan));
      console.log(task.description);
      for (const operation of task.operations) {
        const riskColor = operation.risk === "low" ? ansi.green : ansi.yellow;
        console.log("   • " + operation.kind + " [" + paint(operation.risk.toUpperCase(), riskColor) + "] " + operation.description);
        if (operation.target) console.log("     Target: " + operation.target);
        if (operation.commandPreview) console.log("     Command: " + operation.commandPreview);
        if (operation.kind === "write_file" && operation.content !== undefined) {
          console.log("     Proposed content (" + Buffer.byteLength(operation.content, "utf8") + " bytes):");
          console.log("     " + (operation.content.length > 300 ? operation.content.slice(0, 300) + "…" : operation.content));
        }
      }
    }
    const executeRl = createInterface({ input: stdin, output: stdout });
    let executeNow = "";
    try {
      executeNow = await executeRl.question("\nWould you like GULZ to start doing this now? (y/N): ");
    } finally { executeRl.close(); }
    if (!["y", "yes"].includes(executeNow.trim().toLowerCase())) {
      console.log("Your plan is saved. You can start it later with 'gulz execute " + goalId + "'.");
      return;
    }
    await runGoalExecution(goalId, false);
    return;
  }
  if (command === "plan") {
    const id = args[0];
    if (!id || args.length !== 1) { console.error("Usage: gulz plan <goal-id>"); process.exitCode = 2; return; }
    if (!stdin.isTTY || !stdout.isTTY) throw new Error("AI planning requires an interactive terminal so you can approve sending the goal description.");
    const config = await readProviderConfig();
    if (!config) throw new Error("No AI provider configured. Run gulz provider configure first.");
    const goal = (await readGoals()).find((item) => item.id === id);
    if (!goal) throw new Error("Goal not found.");
    if (goal.status !== "draft" || goal.tasks.length > 0) throw new Error("Only an untouched draft goal can be planned. Create a new goal if you need a fresh plan.");
    const isBuiltin = config.model === "gpt5-luna" && new URL(config.baseUrl).pathname.replace(/\/$/, "").endsWith("/gpt5-luna");
    const providerName = isBuiltin ? "Built-in GULZ AI" : new URL(config.baseUrl).host;
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      title("AI GOAL PLANNING");
      label("Goal", goal.title);
      label("Provider", providerName);
      label("Model", config.model);
      warning("Only this goal's title and description will be sent. GULZ will not upload workspace files.");
      const confirmation = await rl.question("Send this goal description to the selected AI provider? (y/N): ");
      if (!["y", "yes"].includes(confirmation.trim().toLowerCase())) { console.log("Planning cancelled; nothing was sent."); return; }
    } finally { rl.close(); }
    console.log(paint("Planning your goal...", ansi.cyan));
    const generated = await generateGoalPlan(config, { title: goal.title, description: goal.description });
    const updated = await withGoalsLock(async () => {
      const goals = await readGoals();
      const index = goals.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("Goal no longer exists.");
      if (goals[index]!.status !== "draft" || goals[index]!.tasks.length > 0) throw new Error("Goal changed while planning. The generated plan was not saved.");
      let next = goals[index]!;
      for (const item of generated.tasks) {
        next = addGoalTask(next, {
          id: randomUUID(),
          title: item.title,
          description: item.description,
          operations: validatePlannedOperations(item.operations),
        });
      }
      next = transitionGoal(next, "planned");
      goals[index] = next;
      await saveGoals(goals);
      await recordAudit("goal.planned", { goalId: id, provider: providerName, model: config.model, tasks: generated.tasks.length });
      return next;
    });
    success("AI plan saved for review");
    console.log(generated.summary);
    for (const [index, task] of updated.tasks.entries()) {
      console.log(paint("\n" + (index + 1) + ". " + task.title, ansi.bold, ansi.cyan));
      console.log(task.description);
      for (const operation of task.operations) {
        const riskColor = operation.risk === "low" ? ansi.green : ansi.yellow;
        console.log("   • " + operation.kind + " [" + paint(operation.risk.toUpperCase(), riskColor) + "] " + operation.description);
        if (operation.target) console.log("     Target: " + operation.target);
        if (operation.commandPreview) console.log("     Command: " + operation.commandPreview);
        if (operation.kind === "write_file" && operation.content !== undefined) {
          console.log("     Proposed content (" + Buffer.byteLength(operation.content, "utf8") + " bytes):");
          console.log("     " + (operation.content.length > 300 ? operation.content.slice(0, 300) + "…" : operation.content));
        }
      }
    }
    console.log("\nReview the plan with gulz goal show " + id + ". No operations have been executed.");
    return;
  }
  if (command === "repair") {
    if (args.length !== 0) { console.error("Usage: gulz repair"); process.exitCode = 2; return; }
    if (!stdin.isTTY || !stdout.isTTY) throw new Error("Repair requires an interactive terminal and explicit confirmation.");
    const installDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    if (!existsSync(join(installDirectory, ".git")) || !existsSync(join(installDirectory, "package.json"))) {
      throw new Error("GULZ cannot identify its source checkout for repair.");
    }
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      title("REPAIR GULZ");
      console.log("Source checkout: " + installDirectory);
      console.log("This reinstalls CLI workspace dependencies, rebuilds the CLI and refreshes the global link. Local data is not changed.");
      const confirmation = await rl.question("Repair the GULZ CLI now? (y/N): ");
      if (!["y", "yes"].includes(confirmation.trim().toLowerCase())) { console.log("Repair cancelled."); return; }
    } finally { rl.close(); }
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const repairEnv: NodeJS.ProcessEnv = { ...process.env };
    delete repairEnv.GULZ_AI_API_KEY;
    delete repairEnv.GULZ_AI_BASE_URL;
    delete repairEnv.GULZ_AI_MODEL;
    if (process.platform !== "win32") repairEnv.NPM_CONFIG_PREFIX = process.env.PREFIX?.includes("com.termux") ? process.env.PREFIX : join(homedir(), ".local");
    await withExecutionLock(async () => {
      const result = spawnSync(npm, ["run", "install:cli"], {
        cwd: installDirectory, stdio: "inherit", shell: process.platform === "win32", env: repairEnv,
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error("Repair did not complete. Fix the reported build issue and run gulz repair again.");
  
    });
    success("GULZ CLI repaired and relinked");
    return;
  }
  if (command === "uninstall") {
    if (args.length !== 0) { console.error("Usage: gulz uninstall"); process.exitCode = 2; return; }
    if (!stdin.isTTY || !stdout.isTTY) throw new Error("Uninstallation requires an interactive terminal and explicit confirmation.");
    const installDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const info = await lstat(installDirectory);
    if (installDirectory === homedir() || installDirectory === "/" || dataHome === installDirectory || dataHome.startsWith(installDirectory + sep)) {
      throw new Error("GULZ cannot uninstall from this location because it could remove your home directory or local data. Move GULZ_HOME outside the source checkout first.");
    }
    if (!info.isDirectory() || info.isSymbolicLink() || !existsSync(join(installDirectory, ".git")) || !existsSync(join(installDirectory, "package.json"))) {
      throw new Error("GULZ cannot safely identify this source installation for removal.");
    }
    const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: installDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (dirty.error) throw dirty.error;
    if (dirty.status !== 0 || dirty.stdout.trim()) throw new Error("The source checkout contains uncommitted changes. Back up or commit your work before uninstalling; GULZ will not delete a modified checkout.");
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      title("UNINSTALL GULZ");
      console.log("Source checkout: " + installDirectory);
      console.log("Local goals, provider settings and activity history in " + dataHome + " will be preserved.");
      warning("This removes the global CLI link and deletes the GULZ source checkout.");
      const confirmation = await rl.question("Remove the GULZ command and source files? Your saved goals and AI settings will stay. (y/N): ");
      if (!["y", "yes"].includes(confirmation.trim().toLowerCase())) { console.log("Uninstallation cancelled."); return; }
    } finally { rl.close(); }
    await withExecutionLock(async () => {
      const npm = process.platform === "win32" ? "npm.cmd" : "npm";
      const unlinkEnv: NodeJS.ProcessEnv = { ...process.env };
      delete unlinkEnv.GULZ_AI_API_KEY;
      delete unlinkEnv.GULZ_AI_BASE_URL;
      delete unlinkEnv.GULZ_AI_MODEL;
      if (process.platform !== "win32") unlinkEnv.NPM_CONFIG_PREFIX = process.env.PREFIX?.includes("com.termux") ? process.env.PREFIX : join(homedir(), ".local");
      const result = spawnSync(npm, ["unlink", "--global", "@gulz/cli"], {
        cwd: installDirectory, stdio: "inherit", shell: process.platform === "win32", env: unlinkEnv,
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error("The global CLI link could not be removed. The source checkout and local data were left in place.");
      await rm(installDirectory, { recursive: true, force: true });
      await recordAudit("installation.uninstalled", { sourceRemoved: true, dataPreserved: true });
    });
    success("GULZ CLI and source checkout removed");
    console.log("Your local data remains at " + dataHome + ".");
    return;
  }
  if (command === "update") {
    await updateInstallation();
    return;
  }
  if (command === "audit") {
    let limit = 30;
    if (args.length) {
      if (args.length !== 2 || args[0] !== "--limit" || !/^\d+$/.test(args[1]!) || Number(args[1]) < 1 || Number(args[1]) > 500) {
        console.error("Usage: gulz audit [--limit 1..500]"); process.exitCode = 2; return;
      }
      limit = Number(args[1]);
    }
    await ensureDataHome();
    let raw = "";
    try {
      const info = await lstat(auditFile);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("GULZ audit storage must be a regular file, not a symbolic link.");
      await chmod(auditFile, 0o600);
      raw = await readFile(auditFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const lines = raw.split("\n").filter(Boolean);
    const entries = lines.map((line) => {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed) || !isNonEmptyString(parsed.timestamp) || !isNonEmptyString(parsed.action)) throw new Error("Audit history contains an invalid entry; the file was left untouched.");
      return parsed;
    });
    title("RECENT ACTIVITY");
    if (!entries.length) { console.log("No recorded actions yet."); return; }
    for (const entry of entries.slice(-limit).reverse()) {
      console.log(paint(entry.timestamp as string, ansi.dim) + "  " + paint(entry.action as string, ansi.cyan));
      for (const [key, value] of Object.entries(entry)) {
        if (["id", "timestamp", "action"].includes(key) || value === undefined) continue;
        console.log("  " + key + ": " + String(value));
      }
    }
    return;
  }
  if (command === "doctor") {
    const ok = await doctor();
    if (!ok) process.exitCode = 1;
    return;
  }
  if (command === "write") {
    const target = args.join(" ").trim();
    if (!target) { console.error("Usage: gulz write <relative-path>"); process.exitCode = 2; return; }
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("File writes require an interactive terminal; non-interactive approval is disabled.");
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const content = await rl.question("Text to write (single line): ");
      const bytes = Buffer.byteLength(content, "utf8");
      console.log("Target: " + target + "\nBytes:  " + bytes + "\nPreview: " + content);
      console.log("If this file already exists, GULZ will preserve the original as a private backup.");
      const confirmation = await rl.question("Write this file and preserve any existing version as a backup? (y/N): ");
      if (!["y", "yes"].includes(confirmation.trim().toLowerCase())) { console.log("Write cancelled."); return; }
      const operation = createPlannedOperation({ id: randomUUID(), kind: "write_file", description: "Write a local text file", risk: "moderate", target, content });
      const result = await executeLocalOperation(operation, { rootDirectory: process.cwd(), approved: true });
      await recordExecutionAudit(result);
      title("FILE WRITE VERIFIED");
      label("Path", result.output.path);
      label("Bytes", String(result.output.sizeBytes));
      if (result.output.sha256) label("SHA-256", result.output.sha256);
      if (result.output.backupPath) label("Backup", result.output.backupPath);
      success("File write verified");
    } finally { rl.close(); }
    return;
  }
  if (command === "run") {
    const [executable, ...commandArgs] = args;
    if (!executable) {
      console.error("Usage: gulz run <allowlisted-command> [args]");
      process.exitCode = 2;
      return;
    }
    const preview = [executable, ...commandArgs].join(" ");
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error("Command execution requires an interactive terminal; non-interactive approval is disabled.");
    }
    const operation = createPlannedOperation({
      id: randomUUID(),
      kind: "run_command",
      description: "Run an allowlisted local diagnostic or CLI workflow",
      risk: "moderate",
      command: executable,
      args: commandArgs,
      target: ".",
      commandPreview: preview,
    });
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      console.log("Command: " + preview);
      console.log("Working directory: " + process.cwd());
      console.log("Only fixed diagnostics and CLI build/test workflows are supported. No shell is used; npm workflows execute repository scripts and require explicit approval.");
      const confirmation = await rl.question("Run this approved command? (y/N): ");
      if (!["y", "yes"].includes(confirmation.trim().toLowerCase())) { console.log("Command cancelled."); return; }
      const result = await executeLocalOperation(operation, { rootDirectory: process.cwd(), approved: true, timeoutMs: executable === "npm" ? 180_000 : 5_000 });
      await recordExecutionAudit(result);
      title("COMMAND RESULT");
      label("Command", result.output.command ?? preview);
      label("Exit code", String(result.output.exitCode));
      if (result.output.stdout) console.log(result.output.stdout);
      if (result.output.stderr) console.error(result.output.stderr);
      if (result.output.exitCode === 0) success("Command completed");
      else { failure("Command failed"); process.exitCode = 1; }
    } finally { rl.close(); }
    return;
  }
  if (command === "restore") {
    const [backupPath, target] = args;
    if (!backupPath || !target || args.length !== 2) {
      console.error("Usage: gulz restore <backup-path> <target-path>");
      process.exitCode = 2;
      return;
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Restores require an interactive terminal; non-interactive approval is disabled.");
    const backupOperation = createPlannedOperation({
      id: randomUUID(), kind: "read_file", description: "Read a local backup", risk: "low", target: backupPath,
    });
    const backup = await executeLocalOperation(backupOperation, { rootDirectory: process.cwd() });
    await recordExecutionAudit(backup);
    if (backup.output.kind !== "file_content" || typeof backup.output.content !== "string") {
      throw new Error("The selected backup could not be read as a text file.");
    }
    const content = backup.output.content;
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      console.log("Backup: " + backupPath + "\nRestore target: " + target + "\nBytes: " + Buffer.byteLength(content, "utf8"));
      const confirmation = await rl.question("Restore this backup to the target path? (y/N): ");
      if (!["y", "yes"].includes(confirmation.trim().toLowerCase())) { console.log("Restore cancelled."); return; }
      const operation = createPlannedOperation({
        id: randomUUID(), kind: "write_file", description: "Restore a local file from backup",
        risk: "moderate", target, content,
      });
      const result = await executeLocalOperation(operation, { rootDirectory: process.cwd(), approved: true });
      await recordExecutionAudit(result);
      console.log(JSON.stringify(result, null, 2));
    } finally { rl.close(); }
    return;
  }
  if (command === "delete") {
    const target = args.join(" ").trim();
    if (!target) { console.error("Usage: gulz delete <relative-file-path>"); process.exitCode = 2; return; }
    if (!stdin.isTTY || !stdout.isTTY) throw new Error("File deletion requires an interactive terminal and high-risk approval.");
    const operation = createPlannedOperation({
      id: randomUUID(), kind: "delete_file", description: "Move a file into a private recoverable backup",
      risk: "high", target,
    });
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      console.log("File: " + target);
      warning("The file will be moved to a private backup in the same directory, not permanently erased. Restore it with gulz restore if needed.");
      const confirmation = await rl.question("Move this file into a recoverable backup? (y/N): ");
      if (!["y", "yes"].includes(confirmation.trim().toLowerCase())) { console.log("Deletion cancelled."); return; }
      const result = await executeLocalOperation(operation, { rootDirectory: process.cwd(), approved: true });
      await recordExecutionAudit(result);
      if (result.output.kind !== "file_deleted" || !result.output.backupPath) throw new Error("GULZ could not verify the recoverable file backup.");
      success("File moved to a private backup");
      label("Backup", result.output.backupPath);
      console.log("Restore with: gulz restore " + result.output.backupPath + " " + target);
    } finally { rl.close(); }
    return;
  }
  if (command === "mkdir") {
    const target = args.join(" ").trim();
    if (!target) { console.error("Usage: gulz mkdir <relative-path>"); process.exitCode = 2; return; }
    if (!stdin.isTTY || !stdout.isTTY) throw new Error("Directory creation requires an interactive terminal and explicit approval.");
    const operation = createPlannedOperation({
      id: randomUUID(), kind: "create_directory", description: "Create a directory inside the current workspace",
      risk: "moderate", target,
    });
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      console.log("Directory: " + target);
      warning("GULZ will create missing parent directories if necessary. Existing directories are left unchanged.");
      const confirmation = await rl.question("Create this directory? (y/N): ");
      if (!["y", "yes"].includes(confirmation.trim().toLowerCase())) { console.log("Directory creation cancelled."); return; }
      const result = await executeLocalOperation(operation, { rootDirectory: process.cwd(), approved: true });
      await recordExecutionAudit(result);
      success("Directory created or already present · " + target);
    } finally { rl.close(); }
    return;
  }
  if (command === "list") {
    const target = args.join(" ").trim() || ".";
    const operation = createPlannedOperation({
      id: randomUUID(), kind: "list_directory", description: "List directory entry names and types",
      risk: "low", target,
    });
    const result = await executeLocalOperation(operation, { rootDirectory: process.cwd() });
    await recordExecutionAudit(result);
    if (result.output.kind !== "directory_listing" || !result.output.entries) throw new Error("GULZ could not verify the directory listing.");
    title("DIRECTORY · " + result.output.path);
    for (const entry of result.output.entries) {
      const marker = entry.type === "directory" ? "DIR " : entry.type === "symlink" ? "LINK" : entry.type === "file" ? "FILE" : "OTHER";
      const style = entry.type === "directory" ? ansi.cyan : entry.type === "symlink" ? ansi.yellow : ansi.dim;
      console.log("  " + paint(marker, style) + "  " + entry.name);
    }
    if (result.output.hasMore) warning("Only the first 200 entries are shown.");
    success(result.output.entries.length + " entries listed");
    return;
  }
  if (command === "inspect" || command === "read") {
    const target = args.join(" ").trim();
    if (!target) {
      console.error(`Usage: gulz ${command} <relative-path>`);
      process.exitCode = 2;
      return;
    }
    const operation = createPlannedOperation({
      id: randomUUID(),
      kind: command === "inspect" ? "inspect" : "read_file",
      description: command === "inspect" ? "Inspect a local path" : "Read a local file",
      risk: "low",
      target,
    });
    const result = await executeLocalOperation(operation, { rootDirectory: process.cwd() });
    await recordExecutionAudit(result);
    if (command === "read" && result.output.kind === "file_content") {
      title("FILE · " + result.output.path);
      label("Size", result.output.sizeBytes + " bytes");
      if (result.output.sha256) label("SHA-256", result.output.sha256);
      console.log("\n" + (result.output.content ?? ""));
    } else if (command === "inspect" && result.output.kind === "file_metadata") {
      title("PATH INSPECTION");
      label("Path", result.output.path);
      label("Type", result.output.isDirectory ? "Directory" : "File");
      label("Size", result.output.sizeBytes + " bytes");
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
    return;
  }
  if (command === "goals") {
    const goals = await readGoals();
    if (goals.length === 0) {
      console.log('No goals yet. Create one with: gulz goal create "Your goal"');
      return;
    }
    for (const goal of goals) {
      console.log(`${goal.id}  [${goal.status}]  ${goal.title}`);
    }
    return;
  }
  if (command === "goal" && args[0] === "create") {
    const descriptionIndex = args.indexOf("--description");
    const title = (descriptionIndex < 0 ? args.slice(1) : args.slice(1, descriptionIndex)).join(" ").trim();
    const description = descriptionIndex < 0 ? "" : args.slice(descriptionIndex + 1).join(" ").trim();
    if (!title || (descriptionIndex >= 0 && !description)) {
      console.error('Usage: gulz goal create "<title>" [--description "<details>"]');
      process.exitCode = 2;
      return;
    }
    const goal = await withGoalsLock(async () => {
      const goals = await readGoals();
      const created = createGoal({ id: randomUUID(), title, description });
      await saveGoals([...goals, created]);
      await recordAudit("goal.created", { goalId: created.id, title: created.title });
      return created;
    });
    console.log("Goal saved.");
    console.log(`ID:     ${goal.id}`);
    console.log(`Title:  ${goal.title}`);
    console.log("Status: draft");
    return;
  }
  if (command === "goal" && args[0] === "edit") {
    const id = args[1];
    if (!id) { console.error("Usage: gulz goal edit <id>"); process.exitCode = 2; return; }
    if (!stdin.isTTY || !stdout.isTTY) throw new Error("Editing goals requires an interactive terminal.");
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const updated = await withGoalsLock(async () => {
        const goals = await readGoals();
        const index = goals.findIndex((item) => item.id === id);
        if (index < 0) throw new Error("Goal not found.");
        const current = goals[index]!;
        console.log("Leave a field blank to keep its current value.");
        const titleInput = (await rl.question("Title [" + current.title + "]: ")).trim();
        const descriptionInput = (await rl.question("Description [" + (current.description || "none") + "]: ")).trim();
        const next = { ...current, title: titleInput || current.title, description: descriptionInput || current.description, updatedAt: new Date().toISOString() };
        if (!next.title.trim()) throw new Error("A goal title cannot be empty.");
        goals[index] = next;
        await saveGoals(goals);
        await recordAudit("goal.updated", { goalId: id });
        return next;
      });
      success("Goal updated");
      label("Title", updated.title);
    } finally { rl.close(); }
    return;
  }
  if (command === "goal" && args[0] === "delete") {
    const id = args[1];
    if (!id) { console.error("Usage: gulz goal delete <id>"); process.exitCode = 2; return; }
    if (!stdin.isTTY || !stdout.isTTY) throw new Error("Deleting goals requires an interactive terminal and explicit confirmation.");
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const goal = (await readGoals()).find((item) => item.id === id);
      if (!goal) throw new Error("Goal not found.");
      warning("This permanently removes the selected goal and its task list from local GULZ storage.");
      const confirmation = await rl.question("Permanently remove this saved goal and its task list? (y/N): ");
      if (!["y", "yes"].includes(confirmation.trim().toLowerCase())) { console.log("Deletion cancelled."); return; }
      await withExecutionLock(async () => {
        await withGoalsLock(async () => {
        const goals = await readGoals();
        if (!goals.some((item) => item.id === id)) throw new Error("Goal no longer exists.");
        await saveGoals(goals.filter((item) => item.id !== id));
        await recordAudit("goal.deleted", { goalId: id });
        });
      });
      success("Goal deleted");
    } finally { rl.close(); }
    return;
  }
  if (command === "goal" && args[0] === "task" && args[1] === "add") {
    const id = args[2];
    const taskTitle = args.slice(3).join(" ").trim();
    if (!id || !taskTitle) { console.error('Usage: gulz goal task add <goal-id> "<task title>"'); process.exitCode = 2; return; }
    const task = await withGoalsLock(async () => {
      const goals = await readGoals();
      const index = goals.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("Goal not found.");
      const now = new Date().toISOString();
      const updated = addGoalTask(goals[index]!, { id: randomUUID(), title: taskTitle, description: "", operations: [] }, now);
      goals[index] = updated;
      await saveGoals(goals);
      await recordAudit("task.created", { goalId: id, taskId: updated.tasks[updated.tasks.length - 1]!.id, title: taskTitle });
      return updated.tasks[updated.tasks.length - 1]!;
    });
    success("Task added to goal");
    label("Task ID", task.id);
    label("Title", task.title);
    return;
  }
  if (command === "goal" && args[0] === "task" && args[1] === "edit") {
    const [goalId, taskId] = args.slice(2);
    if (!goalId || !taskId || args.length !== 4) { console.error("Usage: gulz goal task edit <goal-id> <task-id>"); process.exitCode = 2; return; }
    if (!stdin.isTTY || !stdout.isTTY) throw new Error("Editing a task requires an interactive terminal.");
    const goal = (await readGoals()).find((item) => item.id === goalId);
    const task = goal?.tasks.find((item) => item.id === taskId);
    if (!goal || !task) throw new Error("Goal or task not found.");
    if (goal.status !== "draft" || task.operations.length > 0) throw new Error("Only manual checklist tasks in draft goals can be edited.");
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const titleInput = (await rl.question("Task title [" + task.title + "]: ")).trim();
      const descriptionInput = (await rl.question("Task description [" + (task.description || "none") + "] (use - to clear): ")).trim();
      await withGoalsLock(async () => {
        const goals = await readGoals();
        const goalIndex = goals.findIndex((item) => item.id === goalId);
        if (goalIndex < 0) throw new Error("Goal not found.");
        const taskIndex = goals[goalIndex]!.tasks.findIndex((item) => item.id === taskId);
        if (taskIndex < 0) throw new Error("Task not found.");
        const tasks = [...goals[goalIndex]!.tasks];
        const current = tasks[taskIndex]!;
        tasks[taskIndex] = {
          ...current,
          title: titleInput || current.title,
          description: descriptionInput === "-" ? "" : descriptionInput || current.description,
          updatedAt: new Date().toISOString(),
        };
        goals[goalIndex] = { ...goals[goalIndex]!, tasks, updatedAt: new Date().toISOString() };
        await saveGoals(goals);
        await recordAudit("task.updated", { goalId, taskId });
      });
      success("Checklist task updated");
    } finally { rl.close(); }
    return;
  }
  if (command === "goal" && args[0] === "task" && args[1] === "delete") {
    const [goalId, taskId] = args.slice(2);
    if (!goalId || !taskId || args.length !== 4) { console.error("Usage: gulz goal task delete <goal-id> <task-id>"); process.exitCode = 2; return; }
    if (!stdin.isTTY || !stdout.isTTY) throw new Error("Deleting a task requires an interactive terminal and explicit confirmation.");
    const goal = (await readGoals()).find((item) => item.id === goalId);
    const task = goal?.tasks.find((item) => item.id === taskId);
    if (!goal || !task) throw new Error("Goal or task not found.");
    if (goal.status !== "draft" || task.operations.length > 0) throw new Error("Only manual checklist tasks in draft goals can be deleted.");
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const confirmation = await rl.question("Remove this checklist task? (y/N): ");
      if (!["y", "yes"].includes(confirmation.trim().toLowerCase())) { console.log("Task deletion cancelled."); return; }
    } finally { rl.close(); }
    await withExecutionLock(async () => {
      await withGoalsLock(async () => {
        const goals = await readGoals();
        const goalIndex = goals.findIndex((item) => item.id === goalId);
        if (goalIndex < 0) throw new Error("Goal not found.");
        const current = goals[goalIndex]!;
        if (current.status !== "draft") throw new Error("The goal is no longer a draft.");
        const currentTask = current.tasks.find((item) => item.id === taskId);
        if (!currentTask || currentTask.operations.length > 0) throw new Error("The task changed and can no longer be deleted.");
        goals[goalIndex] = { ...current, tasks: current.tasks.filter((item) => item.id !== taskId), updatedAt: new Date().toISOString() };
        await saveGoals(goals);
        await recordAudit("task.deleted", { goalId, taskId });
      });
    });
    success("Checklist task deleted");
    return;
  }
  if (command === "goal" && args[0] === "task" && args[1] === "status") {
    const [id, taskId, next] = args.slice(2);
    if (!id || !taskId || !next || !taskStatuses.has(next as TaskStatus)) {
      console.error("Usage: gulz goal task status <goal-id> <task-id> <pending|awaiting_approval|running|paused|completed|failed|skipped|cancelled>");
      process.exitCode = 2; return;
    }
    await withGoalsLock(async () => {
      const goals = await readGoals();
      const index = goals.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("Goal not found.");
      const task = goals[index]!.tasks.find((item) => item.id === taskId);
      if (!task) throw new Error("Task not found.");
      if (task.operations.length > 0) throw new Error("Executable task status is controlled by GULZ. Use execute or resume; manual status changes are disabled for planned operations.");
      goals[index] = transitionTask(goals[index]!, taskId, next as TaskStatus);
      await saveGoals(goals);
      await recordAudit("task.status_changed", { goalId: id, taskId, status: next });
    });
    success("Task status updated to " + next);
    return;
  }
  if (command === "goal" && args[0] === "show") {
    const id = args[1];
    if (!id) {
      console.error("Usage: gulz goal show <id>");
      process.exitCode = 2;
      return;
    }
    const goal = (await readGoals()).find((item) => item.id === id);
    if (!goal) {
      console.error("Goal not found.");
      process.exitCode = 1;
      return;
    }
    if (args.length > 2 || (args[2] !== undefined && args[2] !== "--json")) {
      console.error("Usage: gulz goal show <id> [--json]"); process.exitCode = 2; return;
    }
    if (args[2] === "--json") {
      console.log(JSON.stringify(goal, null, 2));
      return;
    }
    title("GOAL · " + goal.title);
    label("ID", goal.id);
    label("Status", goal.status);
    label("Created", goal.createdAt);
    label("Updated", goal.updatedAt);
    console.log("\n" + paint("DESCRIPTION", ansi.bold, ansi.cyan));
    console.log(goal.description || "No description added.");
    console.log("\n" + paint("TASKS", ansi.bold, ansi.cyan));
    if (!goal.tasks.length) warning("No tasks have been added or generated yet.");
    for (const [index, task] of goal.tasks.entries()) {
      console.log("\n" + paint((index + 1) + ". " + task.title, ansi.bold));
      label("Status", task.status);
      if (task.description) label("Details", task.description);
      if (task.error) warning("Last error: " + task.error);
      if (task.result) success(task.result);
      if (task.operations.length) {
        label("Progress", (task.completedOperationIds ?? []).length + "/" + task.operations.length + " operations checkpointed");
        for (const operation of task.operations) {
          console.log("  " + operation.kind + " [" + operation.risk.toUpperCase() + "] " + operation.description);
          if (operation.target) console.log("    Target: " + operation.target);
          if (operation.commandPreview) console.log("    Command: " + operation.commandPreview);
          if (operation.kind === "write_file" && operation.content !== undefined) {
            console.log("    Proposed content: " + Buffer.byteLength(operation.content, "utf8") + " bytes");
            console.log("    " + (operation.content.length > 240 ? operation.content.slice(0, 240) + "…" : operation.content));
          }
        }
      }
    }
    return;
  }
  console.error(`Unknown command: ${command}`);
  console.error('Run "gulz --help" to see available commands.');
  process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error("GULZ encountered an error.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
