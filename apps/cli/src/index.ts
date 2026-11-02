#!/usr/bin/env node

import { homedir, platform, arch, release } from "node:os";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createGoal, type GoalRecord } from "@gulz/core";

const VERSION = "0.1.0";
const dataHome = resolve(process.env.GULZ_HOME || join(homedir(), ".gulz"));
const goalsFile = join(dataHome, "goals.json");

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
    "  --help, -h            Show this help",
    "  --version, -v         Show the installed version",
    "",
    "Data is stored locally in ~/.gulz (or GULZ_HOME if configured).",
    "This first build does not execute shell commands or use an AI provider.",
  ].join("\n"));
}

async function ensureDataHome(): Promise<void> {
  await mkdir(dataHome, { recursive: true, mode: 0o700 });
}

async function readGoals(): Promise<GoalRecord[]> {
  try {
    const raw = await readFile(goalsFile, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Stored goals data is not a list.");
    return parsed as GoalRecord[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function saveGoals(goals: GoalRecord[]): Promise<void> {
  await ensureDataHome();
  const temporary = join(dataHome, `goals.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(goals, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  await rename(temporary, goalsFile);
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

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") return help();
  if (command === "--version" || command === "-v") {
    console.log(`GULZ ${VERSION}`);
    return;
  }
  if (command === "init") {
    await ensureDataHome();
    const goals = await readGoals();
    if (!(await import("node:fs/promises")).stat(goalsFile).then(() => true).catch(() => false)) {
      await saveGoals(goals);
    }
    console.log("GULZ is initialized.");
    console.log(`Local data: ${dataHome}`);
    return;
  }
  if (command === "doctor") {
    const ok = await doctor();
    if (!ok) process.exitCode = 1;
    return;
  }
  if (command === "goals") {
    const goals = await readGoals();
    if (goals.length === 0) {
      console.log("No goals yet. Create one with: gulz goal create \"Your goal\"");
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
    const goals = await readGoals();
    const goal = createGoal({ id: randomUUID(), title });
    await saveGoals([...goals, goal]);
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
