#!/usr/bin/env node

import { homedir, platform, arch, release } from "node:os";
import { access, appendFile, chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { addGoalTask, createGoal, createPlannedOperation, operationRequiresApproval, transitionGoal, transitionTask, type GoalRecord, type GoalStatus, type TaskStatus, type RiskLevel, type OperationKind } from "@gulz/core";
import { executeLocalOperation, type LocalExecutionResult } from "@gulz/execution";
import { generateGoalPlan, type OpenAICompatibleProviderConfig } from "@gulz/providers";

const VERSION = "0.1.0";
const dataHome = resolve(process.env.GULZ_HOME || join(homedir(), ".gulz"));
const goalsFile = join(dataHome, "goals.json");
const goalsLockFile = join(dataHome, "goals.lock");
const auditFile = join(dataHome, "audit.jsonl");
const providerFile = join(dataHome, "provider.json");
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
const operationKinds = new Set<OperationKind>(["inspect", "read_file", "write_file", "run_command", "network", "install", "delete", "permission_change", "remote_operation"]);

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
    "GULZ — Goals. Executed.",
    "",
    "Usage: gulz <command>",
    "",
    "Commands:",
    "  init                  Create the local GULZ data directory",
    "  doctor                Check the local runtime and data directory",
    "  audit [--limit N]     View recent local action history",
    "  provider configure    Set an OpenAI-compatible AI provider",
    "  provider status       Show provider connection settings",
    "  provider remove       Remove saved provider credentials",
    "  plan <goal-id>        Generate a task plan with your configured AI provider",
    "  execute <goal-id>     Execute a reviewed plan with per-operation approval",
    "  resume <goal-id>      Resume paused or interrupted goal execution",
    "  cancel <goal-id>      Cancel a goal after confirmation",
    "  update                Safely update GULZ from its source installation",
    "  goal create <title>   Save a new goal locally (--description <text> optional)",
    "  goals                 List saved goals",
    "  goal show <id>        Show a saved goal",
    "  goal edit <id>        Edit a goal title or description",
    "  goal delete <id>      Delete a goal after confirmation",
    "  goal task add <id> <title>  Add a checklist task to a goal",
    "  goal task status <goal> <task> <status>  Change a task status",
    "  inspect <path>        Inspect a path inside the current directory",
    "  read <path>           Read a file inside the current directory (256 KiB max)",
    "  write <path>          Write one line of text after explicit confirmation",
    "  run <command> [args]  Run a small allowlist of approved diagnostic commands",
    "  restore <backup> <target>  Restore a saved backup after confirmation",
    "  --help, -h            Show this help",
    "  --version, -v         Show the installed version",
    "",
    "Data is stored locally in ~/.gulz (or GULZ_HOME if configured).",
    "Filesystem commands are confined to the current working directory.",
    "Writes require interactive approval and preserve replaced files as backups.",
    "Arbitrary shell commands, installs, deletes and network operations are not available.",
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
  ];
  return raw.map((item) => {
    if (item.kind === "run_command" && !allowedCommands.some((allowed) => JSON.stringify(allowed) === JSON.stringify([item.command, ...(item.args ?? [])]))) {
      throw new Error("The AI proposed a command outside GULZ's fixed read-only allowlist. The plan was rejected.");
    }
    const risk: RiskLevel = item.kind === "inspect" || item.kind === "read_file" ? "low" : "moderate";
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
\n
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
    const question = rl.question("Type APPROVE " + operationId + " to authorize this operation: ").catch(() => "");
    const aborted = new Promise<string>((resolveQuestion) => {
      onAbort = () => resolveQuestion("");
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    const answer = await Promise.race([question, aborted]);
    return answer === "APPROVE " + operationId;
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
    const goals = await readGoals();
    label("Saved goals", String(goals.length));
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
  if (!stdin.isTTY || !stdout.isTTY) throw new Error("Updates require an interactive terminal and explicit confirmation.");
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    console.log("GULZ source update");
    console.log("Repository: " + installDirectory);
    console.log("This will fast-forward the source checkout, install only CLI workspace dependencies (including TypeScript), rebuild the CLI and refresh the global link. The website and Wrangler/Workerd are excluded.");
    console.log("Local goal data in " + dataHome + " will not be intentionally changed.");
    const confirmation = await rl.question("Type UPDATE GULZ to continue: ");
    if (confirmation !== "UPDATE GULZ") { console.log("Update cancelled."); return; }
  } finally { rl.close(); }
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
    if (result.status !== 0) throw new Error("Update stopped because " + program + " exited with status " + String(result.status) + ". Fix the reported issue and run `gulz update` again.");
  }
  console.log("\nGULZ update completed. Close this session and run `gulz` again to use the updated CLI.");
}
async function interactiveSession(): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) {
    help();
    console.log("\nTip: run `gulz` in a terminal to open the interactive session.");
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  const ask = async (question: string): Promise<string> => (await rl.question(question)).trim();
  const showMenu = (): void => {
    console.log("\n" + paint("GULZ", ansi.bold, ansi.cyan) + paint("  GOALS. EXECUTED.", ansi.bold));
    console.log(paint("Your local supervised workspace", ansi.dim));
    console.log("\n  " + paint("1.", ansi.cyan) + " Create a goal");
    console.log("  " + paint("2.", ansi.cyan) + " View saved goals and inspect a goal");
    console.log("  " + paint("3.", ansi.cyan) + " System check");
    console.log("  " + paint("4.", ansi.cyan) + " Command reference");
    console.log("  " + paint("5.", ansi.cyan) + " Update GULZ");
    console.log("  " + paint("6.", ansi.cyan) + " Recent activity");
    console.log("  " + paint("7.", ansi.cyan) + " Configure AI provider");
    console.log("  " + paint("8.", ansi.cyan) + " Plan a saved goal with AI");
    console.log("  " + paint("0.", ansi.dim) + " Exit");
  };

  try {
    title("WELCOME TO GULZ");
    console.log("Goals are saved on this device in " + paint(dataHome, ansi.cyan));
    warning("This CLI currently supports local goal management and supervised workspace operations. AI planning and remote execution are not configured in this installation.");
    while (true) {
      showMenu();
      const choice = await ask("\nChoose an option: ");
      if (choice === "0" || choice.toLowerCase() === "exit" || choice.toLowerCase() === "quit" || choice.toLowerCase() === "q") {
        success("Session closed. Your saved goals remain on this device.");
        break;
      }
      if (choice === "1" || choice.toLowerCase() === "create") {
        const title = await ask("What goal do you want to save? ");
        if (!title) { console.log("No goal entered; nothing was saved."); continue; }
        const description = await ask("Describe the goal (optional): ");
        const goal = await withGoalsLock(async () => {
          const goals = await readGoals();
          const created = createGoal({ id: randomUUID(), title, description });
          await saveGoals([...goals, created]);
          await recordAudit("goal.created", { goalId: created.id, title: created.title });
          return created;
        });
        console.log("\nGoal saved successfully.");
        console.log("Title:  " + goal.title);
        console.log("ID:     " + goal.id);
        console.log("Status: draft");
        warning("This goal is saved. No task plan has been generated or executed.");
        continue;
      }
      if (choice === "2" || choice.toLowerCase() === "goals" || choice.toLowerCase() === "view") {
        const goals = await readGoals();
        if (!goals.length) {
          console.log("No saved goals yet. Choose 1 to create your first goal.");
          continue;
        }
        console.log("\nSaved goals:");
        goals.forEach((goal, index) => {
          console.log("  " + (index + 1) + ". " + goal.title + "  [" + goal.status + "]");
          console.log("     ID: " + goal.id);
        });
        const selected = await ask("\nEnter a goal number or ID to view details (Enter to return): ");
        if (!selected) continue;
        const index = Number(selected);
        const goal = Number.isInteger(index) && index >= 1 && index <= goals.length ? goals[index - 1] : goals.find((item) => item.id === selected);
        if (!goal) {
          console.log("That goal was not found. Your saved data was not changed.");
          continue;
        }
        console.log("\nGOAL DETAILS");
        console.log("Title:       " + goal.title);
        console.log("ID:          " + goal.id);
        console.log("Status:      " + goal.status);
        console.log("Description: " + (goal.description || "Not added yet"));
        console.log("Created:     " + goal.createdAt);
        console.log("Updated:     " + goal.updatedAt);
        console.log("Tasks:       " + goal.tasks.length);
        for (const task of goal.tasks) {
          console.log("  - [" + task.status + "] " + task.title);
          for (const operation of task.operations) {
            console.log("      " + operation.kind + " · " + operation.risk.toUpperCase() + " · " + operation.description);
            if (operation.target) console.log("        Target: " + operation.target);
            if (operation.commandPreview) console.log("        Command: " + operation.commandPreview);
            if (operation.kind === "write_file" && operation.content !== undefined) {
              console.log("        Content: " + Buffer.byteLength(operation.content, "utf8") + " bytes");
              console.log("        " + (operation.content.length > 240 ? operation.content.slice(0, 240) + "…" : operation.content));
            }
          }
        }
        if (goal.tasks.length === 0) warning("No task plan has been generated for this goal.");
        const action = await ask("\nEnter E to execute this plan, R to resume it, or press Enter to return: ");
        if (action.toLowerCase() === "e" || action.toLowerCase() === "r") {
          rl.close();
          await runGoalExecution(goal.id, action.toLowerCase() === "r");
          return await interactiveSession();
        }
        continue;
      }
      if (choice === "3" || choice.toLowerCase() === "doctor") {
        await doctor();
        continue;
      }
      if (choice === "5" || choice.toLowerCase() === "update") {
        rl.close();
        await updateInstallation();
        return;
      }
      if (choice === "7" || choice.toLowerCase() === "provider") {
        rl.close();
        const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "provider", "configure"], { stdio: "inherit", env: process.env });
        if (result.error) throw result.error;
        return await interactiveSession();
      }
      if (choice === "8" || choice.toLowerCase() === "plan") {
        const drafts = (await readGoals()).filter((goal) => goal.status === "draft" && goal.tasks.length === 0);
        if (!drafts.length) { warning("Create a new draft goal before requesting an AI plan."); continue; }
        console.log("\nDraft goals available for planning:");
        drafts.forEach((goal, index) => console.log("  " + (index + 1) + ". " + goal.title + "  (" + goal.id + ")"));
        const selected = await ask("Choose a goal number or press Enter to return: ");
        if (!selected) continue;
        const index = Number(selected);
        const goal = Number.isInteger(index) && index >= 1 && index <= drafts.length ? drafts[index - 1] : drafts.find((item) => item.id === selected);
        if (!goal) { warning("That draft goal was not found."); continue; }
        rl.close();
        const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "plan", goal.id], { stdio: "inherit", env: process.env });
        if (result.error) throw result.error;
        return await interactiveSession();
      }
      if (choice === "6" || choice.toLowerCase() === "audit" || choice.toLowerCase() === "activity") {
        const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "audit"], { stdio: "inherit", env: process.env });
        if (result.error) throw result.error;
        if (result.status !== 0) warning("Could not display recent activity.");
        continue;
      }
      if (choice === "4" || choice.toLowerCase() === "help") {
        help();
        continue;
      }
      console.log("I didn't recognise that option. Choose 1, 2, 3, 4, 5, 6, 7, 8 or 0.");
    }
  } finally {
    rl.close();
  }
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
      const confirmation = await rl.question("Type CANCEL " + id + " to confirm: ");
      if (confirmation !== "CANCEL " + id) { console.log("Cancellation aborted."); return; }
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
    if (action === "status") {
      const config = await readProviderConfig();
      title("AI PROVIDER");
      if (!config) { warning("No provider configured. Run gulz provider configure."); return; }
      const host = new URL(config.baseUrl).host;
      success("Provider settings are available");
      label("Endpoint", host);
      label("Model", config.model);
      label("API key", "Stored privately; value hidden");
      return;
    }
    if (action === "configure") {
      if (!stdin.isTTY || !stdout.isTTY) throw new Error("Provider configuration requires an interactive terminal.");
      const existing = await readProviderConfig();
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
      const config = await readProviderConfig();
      if (!config) { console.log("No saved provider settings were found."); return; }
      if (process.env.GULZ_AI_API_KEY) throw new Error("Provider settings are supplied by environment variables; remove GULZ_AI_* from your environment instead.");
      if (!stdin.isTTY || !stdout.isTTY) throw new Error("Removing provider settings requires an interactive terminal.");
      const rl = createInterface({ input: stdin, output: stdout });
      try {
        const confirmation = await rl.question("Type REMOVE PROVIDER to delete the saved API key: ");
        if (confirmation !== "REMOVE PROVIDER") { console.log("Removal cancelled."); return; }
      } finally { rl.close(); }
      await rm(providerFile, { force: true });
      success("Saved provider settings removed");
      return;
    }
    console.error("Usage: gulz provider [configure|status|remove]");
    process.exitCode = 2;
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
    const host = new URL(config.baseUrl).host;
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      title("AI GOAL PLANNING");
      label("Goal", goal.title);
      label("Provider", host);
      label("Model", config.model);
      warning("Only this goal's title and description will be sent. GULZ will not upload workspace files.");
      const confirmation = await rl.question("Type SEND GOAL " + id + " to request a plan: ");
      if (confirmation !== "SEND GOAL " + id) { console.log("Planning cancelled; nothing was sent."); return; }
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
      await recordAudit("goal.planned", { goalId: id, provider: host, model: config.model, tasks: generated.tasks.length });
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
      const confirmation = await rl.question(`Type WRITE ${target} to approve this change: `);
      if (confirmation !== `WRITE ${target}`) { console.log("Write cancelled."); return; }
      const operation = createPlannedOperation({ id: randomUUID(), kind: "write_file", description: "Write a local text file", risk: "moderate", target, content });
      const result = await executeLocalOperation(operation, { rootDirectory: process.cwd(), approved: true });
      await recordExecutionAudit(result);
      console.log(JSON.stringify(result, null, 2));
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
      description: "Run an allowlisted local diagnostic command",
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
      console.log("Only fixed, read-only diagnostic commands are supported. No shell is used.");
      const confirmation = await rl.question(`Type RUN ${preview} to approve this command: `);
      if (confirmation !== `RUN ${preview}`) { console.log("Command cancelled."); return; }
      const result = await executeLocalOperation(operation, { rootDirectory: process.cwd(), approved: true });
      await recordExecutionAudit(result);
      console.log(JSON.stringify(result, null, 2));
      if (result.output.exitCode !== 0) process.exitCode = 1;
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
      const confirmation = await rl.question(`Type RESTORE ${target} to approve this rollback: `);
      if (confirmation !== `RESTORE ${target}`) { console.log("Restore cancelled."); return; }
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
    console.log(JSON.stringify(result, null, 2));
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
      const confirmation = await rl.question("Type DELETE " + id + " to confirm: ");
      if (confirmation !== "DELETE " + id) { console.log("Deletion cancelled."); return; }
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
    console.log(JSON.stringify(goal, null, 2));
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
