#!/usr/bin/env node

import { homedir, platform, arch, release } from "node:os";
import { access, chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createGoal, createPlannedOperation, operationRequiresApproval, type GoalRecord, type GoalStatus, type TaskStatus, type RiskLevel, type OperationKind } from "@gulz/core";
import { executeLocalOperation } from "@gulz/execution";

const VERSION = "0.1.0";
const dataHome = resolve(process.env.GULZ_HOME || join(homedir(), ".gulz"));
const goalsFile = join(dataHome, "goals.json");
const goalsLockFile = join(dataHome, "goals.lock");

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
    "  goal create <title>   Save a new goal locally",
    "  goals                 List saved goals",
    "  goal show <id>        Show a saved goal",
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
  console.log("GULZ system check");
  console.log(`Version:       ${VERSION}`);
  console.log(`Platform:      ${platform()} (${arch()})`);
  console.log(`OS release:    ${release()}`);
  console.log(`Node.js:       ${process.version}`);
  console.log(`Data folder:   ${dataHome}`);
  try {
    await ensureDataHome();
    await access(dataHome, constants.R_OK | constants.W_OK);
    console.log("Local storage: ready");
    const goals = await readGoals();
    console.log(`Saved goals:   ${goals.length}`);
    return true;
  } catch (error) {
    console.error("Local storage: unavailable");
    console.error(error instanceof Error ? error.message : String(error));
    return false;
  }
}


async function interactiveSession(): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) {
    help();
    console.log("\\nTip: run `gulz` in a terminal to open the interactive session.");
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  const ask = async (question: string): Promise<string> => (await rl.question(question)).trim();
  const showMenu = (): void => {
    console.log("\\nGULZ — Goals. Executed.");
    console.log("Your local supervised workspace");
    console.log("\\n  1. Create a goal");
    console.log("  2. View saved goals");
    console.log("  3. System check");
    console.log("  4. Command reference");
    console.log("  0. Exit");
  };

  try {
    console.log("Welcome to GULZ.");
    console.log("Goals are saved on this device in " + dataHome);
    console.log("AI planning and autonomous task execution are not connected in this preview yet.");
    while (true) {
      showMenu();
      const choice = await ask("\\nChoose an option: ");
      if (choice === "0" || choice.toLowerCase() === "exit" || choice.toLowerCase() === "quit") {
        console.log("GULZ session closed. Your saved goals remain on this device.");
        break;
      }
      if (choice === "1" || choice.toLowerCase() === "create") {
        const title = await ask("What goal do you want to save? ");
        if (!title) { console.log("No goal entered; nothing was saved."); continue; }
        const goal = await withGoalsLock(async () => {
          const goals = await readGoals();
          const created = createGoal({ id: randomUUID(), title });
          await saveGoals([...goals, created]);
          return created;
        });
        console.log("\\nGoal saved successfully.");
        console.log("Title:  " + goal.title);
        console.log("ID:     " + goal.id);
        console.log("Status: draft");
        console.log("Next: planning and task execution will become available in a later CLI update.");
        continue;
      }
      if (choice === "2" || choice.toLowerCase() === "goals") {
        const goals = await readGoals();
        if (!goals.length) console.log("No saved goals yet. Choose 1 to create your first goal.");
        else for (const goal of goals) console.log("\\n" + goal.id + "  [" + goal.status + "]  " + goal.title);
        continue;
      }
      if (choice === "3" || choice.toLowerCase() === "doctor") {
        await doctor();
        continue;
      }
      if (choice === "4" || choice.toLowerCase() === "help") {
        help();
        continue;
      }
      console.log("I didn't recognise that option. Choose 1, 2, 3, 4 or 0.");
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
    console.log("GULZ is initialized.");
    console.log(`Local data: ${dataHome}`);
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
    const title = args.slice(1).join(" ").trim();
    if (!title) {
      console.error("Usage: gulz goal create <title>");
      process.exitCode = 2;
      return;
    }
    const goal = await withGoalsLock(async () => {
      const goals = await readGoals();
      const created = createGoal({ id: randomUUID(), title });
      await saveGoals([...goals, created]);
      return created;
    });
    console.log("Goal saved.");
    console.log(`ID:     ${goal.id}`);
    console.log(`Title:  ${goal.title}`);
    console.log("Status: draft");
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
