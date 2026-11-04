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
import { executeLocalOperation } from "@gulz/execution";

const VERSION = "0.1.0";
const dataHome = resolve(process.env.GULZ_HOME || join(homedir(), ".gulz"));
const goalsFile = join(dataHome, "goals.json");
const goalsLockFile = join(dataHome, "goals.lock");
const auditFile = join(dataHome, "audit.jsonl");

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
    "  update                Safely update GULZ from its source installation",
    "  goal create <title>   Save a new goal locally",
    "  goals                 List saved goals",
    "  goal show <id>        Show a saved goal",
    "  goal edit <id>        Edit a goal title or description",
    "  goal delete <id>      Delete a goal after confirmation",
    "  goal task add <id> <title>  Add a checklist task to a goal",
    "  goal task status <goal> <task> <status>  Change a task status",
    "  goal status <id> <status>  Change a goal lifecycle status",
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
  try {
    await ensureDataHome();
    await access(dataHome, constants.R_OK | constants.W_OK);
    success("Local storage is ready");
    const goals = await readGoals();
    label("Saved goals", String(goals.length));
    return true;
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
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const steps = [
    ["git", ["pull", "--ff-only"]],
    [npm, ["run", "install:cli"]],
  ] as const;
  for (const [program, args] of steps) {
    console.log("\n$ " + program + " " + args.join(" "));
    const result = spawnSync(program, [...args], { cwd: installDirectory, stdio: "inherit", shell: process.platform === "win32" });
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
    console.log("\nGULZ — Goals. Executed.");
    console.log("Your local supervised workspace");
    console.log("\n  1. Create a goal");
    console.log("  2. View saved goals and inspect a goal");
    console.log("  3. System check");
    console.log("  4. Command reference");
    console.log("  5. Update GULZ");
    console.log("  0. Exit");
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
        const goal = await withGoalsLock(async () => {
          const goals = await readGoals();
          const created = createGoal({ id: randomUUID(), title });
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
        for (const task of goal.tasks) console.log("  - [" + task.status + "] " + task.title);
        warning("No task plan has been generated or executed for this goal.");
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
      if (choice === "4" || choice.toLowerCase() === "help") {
        help();
        continue;
      }
      console.log("I didn't recognise that option. Choose 1, 2, 3, 4, 5 or 0.");
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
      await withGoalsLock(async () => {
        const goals = await readGoals();
        if (!goals.some((item) => item.id === id)) throw new Error("Goal no longer exists.");
        await saveGoals(goals.filter((item) => item.id !== id));
        await recordAudit("goal.deleted", { goalId: id });
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
      goals[index] = transitionTask(goals[index]!, taskId, next as TaskStatus);
      await saveGoals(goals);
      await recordAudit("task.status_changed", { goalId: id, taskId, status: next });
    });
    success("Task status updated to " + next);
    return;
  }
  if (command === "goal" && args[0] === "status") {
    const [id, next] = args.slice(1);
    if (!id || !next || !goalStatuses.has(next as GoalStatus)) {
      console.error("Usage: gulz goal status <goal-id> <draft|planned|awaiting_approval|running|paused|completed|failed|cancelled>");
      process.exitCode = 2; return;
    }
    await withGoalsLock(async () => {
      const goals = await readGoals();
      const index = goals.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("Goal not found.");
      goals[index] = transitionGoal(goals[index]!, next as GoalStatus);
      await saveGoals(goals);
      await recordAudit("goal.status_changed", { goalId: id, status: next });
    });
    success("Goal status updated to " + next);
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
