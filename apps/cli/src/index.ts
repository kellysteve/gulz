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
import { generateAgentTurn, generateGoalPlan, type OpenAICompatibleProviderConfig, type ProviderAgentMessage } from "@gulz/providers";
import { createLocalAgentTools, createRemoteAgentTools, runAgent } from "@gulz/agent";
import { OpenSshRemoteTransport, validateRemoteAlias, validateRemoteDestination, validateRemoteWorkspace } from "@gulz/remote";

const VERSION = "0.1.0";
const dataHome = resolve(process.env.GULZ_HOME || join(homedir(), ".gulz"));
const goalsFile = join(dataHome, "goals.json");
const goalsLockFile = join(dataHome, "goals.lock");
const auditFile = join(dataHome, "audit.jsonl");
const providerFile = join(dataHome, "provider.json");
const providerProfilesFile = join(dataHome, "provider-profiles.json");
const placeFile = join(dataHome, "place.json");
const conversationFile = join(dataHome, "conversation.json");
const remoteEnvironmentsFile = join(dataHome, "remote-environments.json");
const executionLockFile = join(dataHome, "execution.lock");

const isInteractive = Boolean(stdout.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb");
const ansi = { reset: "\u001b[0m", bold: "\u001b[1m", dim: "\u001b[2m", cyan: "\u001b[36m", blue: "\u001b[34m", green: "\u001b[32m", yellow: "\u001b[33m", red: "\u001b[31m", magenta: "\u001b[35m", white: "\u001b[37m" };
function paint(value: string, ...styles: string[]): string { return isInteractive ? styles.join("") + value + ansi.reset : value; }
// Give plain terminal output a readable default color while preserving explicitly styled text.
const plainLog = console.log.bind(console);
const plainError = console.error.bind(console);
console.log = (...values: unknown[]) => plainLog(...values.map((value) =>
  typeof value === "string" && !value.includes("\u001b[") ? paint(value, ansi.white) : value));
console.error = (...values: unknown[]) => plainError(...values.map((value) =>
  typeof value === "string" && !value.includes("\u001b[") ? paint(value, ansi.red) : value));
function title(value: string): void { console.log("\n" + paint(value, ansi.bold, ansi.cyan)); }
function success(value: string): void { console.log(paint("✓ " + value, ansi.green, ansi.bold)); }
function warning(value: string): void { console.log(paint("! " + value, ansi.yellow)); }
function failure(value: string): void { console.error(paint("✗ " + value, ansi.red, ansi.bold)); }
function label(name: string, value: string): void { console.log(paint(name.padEnd(14), ansi.dim) + paint(value, ansi.cyan)); }
function info(value: string): void { console.log(paint("› ", ansi.magenta, ansi.bold) + paint(value, ansi.blue)); }
function muted(value: string): void { console.log(paint(value, ansi.dim)); }

function terminalWidth(): number { return Math.max(48, Math.min(120, (stdout.columns || 80) - 4)); }

/** Turn common AI Markdown into readable terminal output instead of showing raw syntax. */
function renderMarkdown(input: string): string {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let code = false;
  let language = "";
  let codeLines: string[] = [];
  const inline = (value: string): string => {
    const saved: string[] = [];
    let text = value.replace(/\x60([^\x60]+)\x60/g, (_m, body: string) => {
      const key = String.fromCharCode(1) + saved.length + String.fromCharCode(2);
      saved.push(paint(body, ansi.yellow));
      return key;
    });
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) => paint(label, ansi.cyan) + paint(" (" + url + ")", ansi.dim));
    text = text.replace(/\*\*(.+?)\*\*/g, (_m, body: string) => paint(body, ansi.bold, ansi.white));
    text = text.replace(/__(.+?)__/g, (_m, body: string) => paint(body, ansi.bold, ansi.white));
    text = text.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, (_m, body: string) => paint(body, ansi.magenta));
    text = text.replace(/~~(.+?)~~/g, (_m, body: string) => paint(body, ansi.dim));
    text = text.replace(/<((?:https?:\/\/)[^>]+)>/g, (_m, url: string) => paint(url, ansi.cyan, ansi.bold));
    return text.replace(/\u0001(\d+)\u0002/g, (_m, index: string) => saved[Number(index)] ?? "");
  };
  const wrap = (value: string): string => {
    const width = terminalWidth();
    if (value.replace(/\u001b\[[0-9;]*m/g, "").length <= width) return value;
    const indent = value.match(/^\s*/)?.[0] ?? "";
    const words = value.trim().split(/\s+/);
    const result: string[] = [];
    let line = indent;
    for (const word of words) {
      if (line.trim() && (line + " " + word).replace(/\u001b\[[0-9;]*m/g, "").length > width) {
        result.push(line); line = indent + word;
      } else line += (line.trim() ? " " : "") + word;
    }
    if (line.trim()) result.push(line);
    return result.join("\n");
  };
  const flushCode = () => {
    output.push(paint("  ┌─ " + (language || "CODE"), ansi.cyan, ansi.dim));
    for (const line of codeLines) {
      const width = terminalWidth() - 4;
      if (!line) output.push("  " + paint("│", ansi.cyan, ansi.dim));
      else for (let i = 0; i < line.length; i += width) output.push("  " + paint("│ ", ansi.cyan, ansi.dim) + paint(line.slice(i, i + width), ansi.green));
    }
    output.push(paint("  └" + "─".repeat(18), ansi.cyan, ansi.dim));
    codeLines = []; language = "";
  };
  for (const line of lines) {
    const fence = line.match(/^\s*\x60{3}([^\s\x60]*)\s*$/);
    if (fence) {
      if (code) { flushCode(); code = false; }
      else { code = true; language = fence[1] || "CODE"; }
      continue;
    }
    if (code) { codeLines.push(line); continue; }
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      output.push(paint(inline(heading[1]!), ansi.bold, ansi.cyan));
      output.push(paint("  " + "─".repeat(Math.min(terminalWidth() - 2, 28)), ansi.dim));
      continue;
    }
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)) continue;
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.split("|").slice(1, -1).map((cell) => inline(cell.trim()));
      output.push("  " + cells.join(paint("  │  ", ansi.dim)));
      continue;
    }
    if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) {
      output.push(paint("  " + "─".repeat(28), ansi.dim)); continue;
    }
    const bullet = line.match(/^(\s*)[-+*]\s+(.+)$/);
    const numbered = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (bullet) output.push(wrap(bullet[1] + paint("• ", ansi.magenta, ansi.bold) + inline(bullet[2]!)));
    else if (numbered) output.push(wrap(numbered[1] + paint(numbered[2] + ". ", ansi.magenta, ansi.bold) + inline(numbered[3]!)));
    else if (quote) output.push("  " + paint("│ ", ansi.cyan) + paint(inline(quote[1]!), ansi.dim));
    else output.push(wrap(inline(line)));
  }
  if (code) flushCode();
  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function renderAssistantMessage(value: string): void {
  const rendered = renderMarkdown(value);
  if (rendered) console.log(rendered);
}

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
    "  provider              Open the interactive provider centre",
    "  provider list         List saved providers on this Place",
    "  provider add          Add another provider (up to 50)",
    "  provider use <id>     Switch the active provider",
    "  provider models       Browse or change models",
    "  provider test         Test the active provider",
    "  provider remove [id] Remove a saved provider",
    "  AI provider profiles are managed per Place and stored locally",
    "  account connect <code> Pair this installation with your GULZ account",
    "  account status       Show this Place connection",
    "  account disconnect  Remove this installation's Place credential",
    "  provider builtin      Use the legacy built-in provider",
    "  provider configure    Configure a custom compatible API",
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
    if (!Array.isArray(parsed) || parsed.length > 4 || !parsed.every((item) =>
      isRecord(item) && isNonEmptyString(item.name) && isNonEmptyString(item.destination) && (item.workspace === undefined || isNonEmptyString(item.workspace)) && isTimestamp(item.addedAt))) {
      throw new Error("Saved remote environment settings are invalid. They were left untouched.");
    }
    const names = parsed.map((item) => (item as { name: string }).name);
    const toolPrefixes = names.map((name) => name.replace(/-/g, "_"));
    if (new Set(names).size !== names.length || new Set(toolPrefixes).size !== toolPrefixes.length) throw new Error("Saved remote environment names contain duplicates or collide in agent tool names.");
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
  const names = environments.map((item) => item.name);
  const toolPrefixes = names.map((name) => name.replace(/-/g, "_"));
  if (environments.length > 4 || new Set(names).size !== names.length || new Set(toolPrefixes).size !== toolPrefixes.length) {
    throw new Error("Remote environment list is invalid or contains duplicate/colliding names.");
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
  const profiles = await readProviderProfiles();
  if (profiles.active) {
    const active = profiles.providers.find((item) => item.id === profiles.active);
    if (!active) throw new Error("The active provider profile is missing.");
    return { baseUrl: active.baseUrl, model: active.model, apiKey: active.apiKey };
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


interface StoredProviderProfile extends StoredProviderConfig { id: string; name: string; }
interface StoredProviderProfiles { active: string; providers: StoredProviderProfile[]; }
const providerCatalog = [
 {id:"openrouter",name:"OpenRouter",baseUrl:"https://openrouter.ai/api/v1",model:"openai/gpt-4o-mini",models:["openai/gpt-4o-mini","deepseek/deepseek-chat","google/gemini-2.5-flash"]},
 {id:"deepseek",name:"DeepSeek",baseUrl:"https://api.deepseek.com",model:"deepseek-chat",models:["deepseek-chat","deepseek-reasoner"]},
 {id:"openai",name:"OpenAI",baseUrl:"https://api.openai.com/v1",model:"gpt-4o-mini",models:["gpt-4o-mini","gpt-4.1-mini","gpt-4.1"]},
 {id:"gemini",name:"Google Gemini",baseUrl:"https://generativelanguage.googleapis.com/v1beta/openai",model:"gemini-2.5-flash",models:["gemini-2.5-flash","gemini-2.5-pro"]},
 {id:"groq",name:"Groq",baseUrl:"https://api.groq.com/openai/v1",model:"llama-3.3-70b-versatile",models:["llama-3.3-70b-versatile","qwen-qwq-32b"]},
 {id:"mistral",name:"Mistral",baseUrl:"https://api.mistral.ai/v1",model:"mistral-small-latest",models:["mistral-small-latest","mistral-large-latest"]},
 {id:"together",name:"Together AI",baseUrl:"https://api.together.xyz/v1",model:"meta-llama/Llama-3.3-70B-Instruct-Turbo",models:["meta-llama/Llama-3.3-70B-Instruct-Turbo"]},
 {id:"fireworks",name:"Fireworks AI",baseUrl:"https://api.fireworks.ai/inference/v1",model:"accounts/fireworks/models/llama-v3p3-70b-instruct",models:["accounts/fireworks/models/llama-v3p3-70b-instruct"]},
 {id:"cerebras",name:"Cerebras",baseUrl:"https://api.cerebras.ai/v1",model:"llama-3.3-70b",models:["llama-3.3-70b"]},
 {id:"deepinfra",name:"DeepInfra",baseUrl:"https://api.deepinfra.com/v1/openai",model:"meta-llama/Meta-Llama-3.3-70B-Instruct",models:["meta-llama/Meta-Llama-3.3-70B-Instruct"]},
 {id:"perplexity",name:"Perplexity",baseUrl:"https://api.perplexity.ai",model:"sonar",models:["sonar","sonar-pro"]},
 {id:"xai",name:"xAI",baseUrl:"https://api.x.ai/v1",model:"grok-3-mini",models:["grok-3-mini","grok-3"]},
 {id:"nvidia",name:"NVIDIA NIM",baseUrl:"https://integrate.api.nvidia.com/v1",model:"meta/llama-3.3-70b-instruct",models:["meta/llama-3.3-70b-instruct"]},
 {id:"ollama",name:"Ollama (local)",baseUrl:"http://127.0.0.1:11434/v1",model:"qwen2.5-coder:7b",models:["qwen2.5-coder:7b","llama3.2"]},
 {id:"lmstudio",name:"LM Studio (local)",baseUrl:"http://127.0.0.1:1234/v1",model:"local-model",models:["local-model"]},
] as const;
async function readProviderProfiles(): Promise<StoredProviderProfiles> {
 await ensureDataHome();
 try {
  const info=await lstat(providerProfilesFile);
  if(!info.isFile()||info.isSymbolicLink()) throw new Error("Provider profiles must be a regular file.");
  await chmod(providerProfilesFile,0o600);
  const raw:unknown=JSON.parse(await readFile(providerProfilesFile,"utf8"));
  if(!isRecord(raw)||typeof raw.active!=="string"||!Array.isArray(raw.providers)||raw.providers.length>50) throw new Error("Saved provider profiles are invalid.");
  const providers=raw.providers.map((p):StoredProviderProfile=>{
   if(!isRecord(p)||!isNonEmptyString(p.id)||!isNonEmptyString(p.name)||!isNonEmptyString(p.baseUrl)||!isNonEmptyString(p.model)||!isNonEmptyString(p.apiKey)) throw new Error("A saved provider profile is invalid.");
   return {id:p.id,name:p.name,baseUrl:p.baseUrl,model:p.model,apiKey:p.apiKey};
  });
  if(new Set(providers.map(p=>p.id)).size!==providers.length) throw new Error("Duplicate provider profile IDs were found.");
  if(providers.length&&!providers.some(p=>p.id===raw.active)) throw new Error("The active provider profile is missing.");
  return {active:raw.active,providers};
 } catch(e) { if((e as NodeJS.ErrnoException).code==="ENOENT") return {active:"",providers:[]}; throw e; }
}
async function saveProviderProfiles(value:StoredProviderProfiles):Promise<void>{
 if(value.providers.length>50) throw new Error("You can save up to 50 providers on this Place.");
 await ensureDataHome(); const temp=join(dataHome,"provider-profiles."+randomUUID()+".tmp");
 try { await writeFile(temp,JSON.stringify(value,null,2)+"\n",{encoding:"utf8",mode:0o600,flag:"wx"}); await rename(temp,providerProfilesFile); await chmod(providerProfilesFile,0o600); }
 finally { await rm(temp,{force:true}).catch(()=>undefined); }
}
async function manageProviderProfiles(action="menu",values:string[]=[]):Promise<void>{
 let saved=await readProviderProfiles();
 const list=()=>{title("AI PROVIDERS"); if(!saved.providers.length && !existsSync(providerFile)) warning("No saved providers yet."); for(const p of saved.providers) console.log((p.id===saved.active?paint("● ",ansi.green,ansi.bold):"  ")+p.name+(p.id===saved.active?paint("  ACTIVE",ansi.green):"")+" · "+p.id+" · "+p.model); if(!saved.providers.length && existsSync(providerFile)) console.log(paint("● Legacy provider configuration",ansi.green)+" · use `provider configure` to replace it"); muted("API keys remain local and are never displayed.");};
 if(action==="menu"){
  if(!stdin.isTTY||!stdout.isTTY) throw new Error("The provider centre requires an interactive terminal.");
  list(); console.log("\n  1) Add provider\n  2) Switch provider\n  3) Browse/change models\n  4) Test active provider\n  5) Remove provider\n  0) Back");
  const rl=createInterface({input:stdin,output:stdout}); let c=""; try{c=(await rl.question("Choose an option: ")).trim();}finally{rl.close();}
  const next:Record<string,string>={"1":"add","2":"use","3":"models","4":"test","5":"remove"}; if(!next[c])return;
  if(c==="4"){await runProviderConnectionTest();return;} await manageProviderProfiles(next[c]!,[]); return;
 }
 if(action==="list"){list();return;}
 if(action==="add"){
  if(!stdin.isTTY||!stdout.isTTY)throw new Error("Adding a provider requires an interactive terminal.");
  if(saved.providers.length>=50)throw new Error("This Place already has 50 saved providers.");
  const rl=createInterface({input:stdin,output:stdout}); let selected="",name="",baseUrl="",model="";
  try{
   title("ADD AI PROVIDER"); providerCatalog.forEach((p,i)=>console.log("  "+(i+1)+") "+p.name+" ("+p.id+")"));
   console.log("  "+(providerCatalog.length+1)+") Custom OpenAI-compatible API");
   selected=(await rl.question("Choose a provider: ")).trim(); const preset=providerCatalog[Number(selected)-1];
   if(preset){name=preset.name;baseUrl=preset.baseUrl;model=preset.model;}
   else if(selected===String(providerCatalog.length+1)){name=(await rl.question("Provider name: ")).trim();baseUrl=(await rl.question("API base URL: ")).trim();model=(await rl.question("Model name: ")).trim();}
   else throw new Error("Choose one of the listed providers.");
  }finally{rl.close();}
  const url=new URL(baseUrl); if(url.username||url.password||url.search||url.hash||(url.protocol!=="https:"&&!(url.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(url.hostname))))throw new Error("Provider URL must use HTTPS; HTTP is allowed only for localhost.");
  const key=await askSecret("API key (hidden; local Ollama/LM Studio may use a placeholder): ");
  const apiKey=key||(["ollama","lmstudio"].includes(selected)?"local":""); if(!apiKey)throw new Error("An API key is required.");
  const idBase=(providerCatalog[Number(selected)-1]?.id??name.toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/^-|-$/g,"")).slice(0,40)||"custom";
  const id=saved.providers.some(p=>p.id===idBase)?idBase+"-"+randomUUID().slice(0,6):idBase;
  saved.providers.push({id,name,baseUrl,model,apiKey});saved.active=id;await saveProviderProfiles(saved);success(name+" added and selected.");return;
 }
 if(action==="use"){
  let id=values[0];if(!id&&stdin.isTTY&&stdout.isTTY){list();const rl=createInterface({input:stdin,output:stdout});try{id=(await rl.question("Provider ID to activate: ")).trim();}finally{rl.close();}}
  const p=saved.providers.find(x=>x.id===id);if(!p)throw new Error("Provider not found. Run /provider to see saved providers.");
  saved.active=p.id;await saveProviderProfiles(saved);success("Active provider: "+p.name+" · "+p.model);return;
 }
 if(action==="models"){
  const p=saved.providers.find(x=>x.id===(values[0]||saved.active));if(!p)throw new Error("Add a provider first.");
  const preset=providerCatalog.find(x=>x.id===p.id);const options=preset?.models??[p.model];title("MODELS · "+p.name);console.log("Current: "+p.model);options.forEach((m,i)=>console.log("  "+(i+1)+") "+m));console.log("  "+(options.length+1)+") Enter model name");
  if(!stdin.isTTY||!stdout.isTTY)return;
  const rl=createInterface({input:stdin,output:stdout});let c="",custom="";try{c=(await rl.question("Choose a model (blank keeps current): ")).trim();if(c===String(options.length+1))custom=(await rl.question("Model name: ")).trim();}finally{rl.close();}
  const model=custom||(Number(c)>0&&Number(c)<=options.length?options[Number(c)-1]:p.model);
  if(model!==p.model){saved.providers=saved.providers.map(x=>x.id===p.id?{...x,model}:x);await saveProviderProfiles(saved);success("Model changed to "+model);}return;
 }
 if(action==="remove"){
  const id=values[0]||saved.active;const p=saved.providers.find(x=>x.id===id);if(!p){if(!saved.providers.length && existsSync(providerFile)){if(!stdin.isTTY||!stdout.isTTY)throw new Error("Removing a provider requires an interactive terminal.");const legacyRl=createInterface({input:stdin,output:stdout});let legacyAnswer="";try{legacyAnswer=await legacyRl.question("Remove the legacy saved provider configuration? (y/N): ");}finally{legacyRl.close();}if(["y","yes"].includes(legacyAnswer.trim().toLowerCase())){await rm(providerFile,{force:true});success("Legacy provider configuration removed.");}return;}console.log("No matching saved provider.");return;}
  if(!stdin.isTTY||!stdout.isTTY)throw new Error("Removing a provider requires an interactive terminal.");
  const rl=createInterface({input:stdin,output:stdout});let answer="";try{answer=await rl.question("Remove "+p.name+" from this Place? (y/N): ");}finally{rl.close();}
  if(!["y","yes"].includes(answer.trim().toLowerCase())){console.log("Nothing changed.");return;}
  saved.providers=saved.providers.filter(x=>x.id!==p.id);saved.active=saved.providers[0]?.id??"";await saveProviderProfiles(saved);success(p.name+" removed.");return;
 }
 throw new Error("Use /provider, list, add, use, models, test or remove.");
}
async function runProviderConnectionTest():Promise<void>{
 const config=await readProviderConfig();if(!config){warning("No active provider. Add one with /provider.");return;}
 title("AI CONNECTION CHECK");
 const turn=await generateAgentTurn({...config,toolChoice:"required"},[{role:"user",content:"Call the gulz_connection_check tool exactly once with an empty object. Do not execute any real-world action."}],[{name:"gulz_connection_check",description:"Harmless tool-calling capability check. Never execute it.",parameters:{type:"object",properties:{},additionalProperties:false}}]);
 success("Provider responded.");label("Tool calling",turn.toolCalls.some(c=>c.name==="gulz_connection_check"&&Object.keys(c.arguments).length===0)?"Supported":"Not confirmed");
}


interface PlaceCredentials { placeId: string; deviceToken: string; controlUrl: string; pairedAt: string; }
async function readPlaceCredentials(): Promise<PlaceCredentials | null> {
  await ensureDataHome();
  try {
    const info = await lstat(placeFile);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Place credentials must be a regular file.");
    await chmod(placeFile, 0o600);
    const parsed: unknown = JSON.parse(await readFile(placeFile, "utf8"));
    if (!isRecord(parsed) || !isNonEmptyString(parsed.placeId) || !isNonEmptyString(parsed.deviceToken) ||
        !isNonEmptyString(parsed.controlUrl) || !isTimestamp(parsed.pairedAt)) throw new Error("Saved Place credentials are invalid.");
    return parsed as unknown as PlaceCredentials;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function savePlaceCredentials(value: PlaceCredentials): Promise<void> {
  await ensureDataHome();
  const temporary = join(dataHome, "place." + randomUUID() + ".tmp");
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, placeFile);
    await chmod(placeFile, 0o600);
  } finally { await rm(temporary, { force: true }).catch(() => undefined); }
}
async function connectPlace(code: string): Promise<void> {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(normalized)) throw new Error("Enter the eight-character pairing code from your GULZ dashboard.");
  const controlUrl = (process.env.GULZ_CONTROL_URL || "https://gulz.gaxity.com.ng").replace(/\/$/, "");
  const response = await fetch(controlUrl + "/api/places/pair/complete", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      code: normalized,
      name: (process.env.PREFIX?.includes("com.termux") ? "Android Termux" : platform()) + " · " + arch(),
      platform: process.env.PREFIX?.includes("com.termux") ? "termux" : platform(),
      architecture: arch(), version: VERSION,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json() as { placeId?: string; deviceToken?: string; message?: string; error?: string };
  if (!response.ok || !payload.placeId || !payload.deviceToken) throw new Error(payload.error || "Place pairing failed. Generate a fresh code on the website and try again.");
  await savePlaceCredentials({ placeId: payload.placeId, deviceToken: payload.deviceToken, controlUrl, pairedAt: new Date().toISOString() });
  success("This installation is now connected as a GULZ Place.");
  console.log("Manage it at " + controlUrl + "/dashboard");
}
async function heartbeatPlace(): Promise<void> {
  const place = await readPlaceCredentials();
  if (!place) return;
  try {
    const config = await readProviderConfig();
    await fetch(place.controlUrl + "/api/places/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + place.deviceToken },
      body: JSON.stringify({
        version: VERSION,
        platform: process.env.PREFIX?.includes("com.termux") ? "termux" : platform(),
        architecture: arch(),
        ...(config ? { provider: new URL(config.baseUrl).host, model: config.model } : {}),
      }),
      signal: AbortSignal.timeout(4000),
    });
  } catch { /* Place heartbeat is best-effort; local CLI work must remain available offline. */ }
}
async function accountCommand(args: string[]): Promise<void> {
  const action = args[0] || "status";
  if (action === "connect") {
    if (args.length !== 2) throw new Error("Usage: gulz account connect <8-character-code>");
    await connectPlace(args[1]!);
    await heartbeatPlace();
    return;
  }
  if (action === "status") {
    const place = await readPlaceCredentials();
    title("GULZ ACCOUNT");
    if (!place) { warning("This installation is not connected to a GULZ account. Local coding and BYOK providers still work."); console.log("Sign in at " + (process.env.GULZ_CONTROL_URL || "https://gulz.gaxity.com.ng") + "/dashboard and run gulz account connect <code>."); return; }
    success("This installation is paired as a Place.");
    label("Place ID", place.placeId);
    label("Dashboard", place.controlUrl + "/dashboard");
    label("Paired", new Date(place.pairedAt).toLocaleString());
    return;
  }
  if (action === "disconnect") {
    if (args.length !== 1) throw new Error("Usage: gulz account disconnect");
    const place = await readPlaceCredentials();
    if (!place) { console.log("This installation is not connected."); return; }
    if (!stdin.isTTY || !stdout.isTTY) throw new Error("Disconnecting a Place requires an interactive terminal.");
    const rl = createInterface({ input: stdin, output: stdout });
    let answer = "";
    try { answer = await rl.question("Remove this Place credential from this installation? (y/N): "); } finally { rl.close(); }
    if (!["y", "yes"].includes(answer.trim().toLowerCase())) { console.log("Nothing changed."); return; }
    await rm(placeFile, { force: true });
    success("Local Place credential removed. You can also revoke the Place from your website dashboard.");
    return;
  }
  throw new Error("Usage: gulz account <connect <code>|status|disconnect>");
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
    try {
      const history = await readConversation();
      success("Saved conversation is valid · " + history.length + " messages");
    } catch (error) {
      failure("Saved conversation could not be loaded");
      console.error(error instanceof Error ? error.message : String(error));
      ok = false;
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
    const previousCommit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: installDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (previousCommit.error) throw previousCommit.error;
    if (previousCommit.status !== 0 || !/^[a-f0-9]{40,64}$/i.test(previousCommit.stdout.trim())) {
      throw new Error("Unable to record the currently installed GULZ version. Update cancelled before changing source.");
    }
    updateEnv.GULZ_PREVIOUS_COMMIT = previousCommit.stdout.trim();
    console.log("\n$ git pull --ff-only");
    const pulled = spawnSync("git", ["pull", "--ff-only"], { cwd: installDirectory, stdio: "inherit", env: updateEnv });
    if (pulled.error) throw pulled.error;
    if (pulled.status !== 0) throw new Error("GULZ could not download the latest source. Your previous installation was not intentionally replaced.");
    const latestCommit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: installDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (latestCommit.error) throw latestCommit.error;
    if (latestCommit.status !== 0 || !/^[a-f0-9]{40,64}$/i.test(latestCommit.stdout.trim())) {
      throw new Error("Unable to identify the downloaded GULZ version.");
    }

    console.log("\n$ " + npm + " run install:cli");
    const installation = spawnSync(npm, ["run", "install:cli"], {
      cwd: installDirectory, stdio: "inherit", shell: process.platform === "win32", env: updateEnv,
    });
    if (installation.error) throw installation.error;
    if (installation.status !== 0) {
      throw new Error("GULZ could not install the downloaded version. Review the build output and retry after the issue is fixed.");
    }
    const installedCommit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: installDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (installedCommit.error) throw installedCommit.error;
    const installedFallback = installedCommit.status === 0 && latestCommit.status === 0 && installedCommit.stdout.trim() === previousCommit.stdout.trim() && latestCommit.stdout.trim() !== previousCommit.stdout.trim();
    if (installedFallback) warning("The latest version failed its build. The installer restored and rebuilt your previous version instead.");
    else success("GULZ source updated and rebuilt.");

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
        if (configured.status !== 0) throw new Error("The GULZ installation succeeded, but AI provider setup did not finish.");
        const tested = spawnSync(process.execPath, [cliEntry, "provider", "test"], { stdio: "inherit", env: updateEnv });
        if (tested.error) throw tested.error;
        if (tested.status !== 0) warning("The GULZ installation succeeded, but the AI connection test did not pass. You can retry with gulz provider test.");
      } else if (choice.trim() !== "3") {
        warning("No provider changes were made. Your existing settings were preserved.");
      }
    }
    console.log(installedFallback
      ? "\nGULZ fallback completed. You are using the previous version. Try updating again after the latest release is fixed."
      : "\nGULZ update completed. Close this session and run gulz again to use the updated CLI.");
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


async function readConversation(): Promise<ProviderAgentMessage[]> {
  await ensureDataHome();
  try {
    const info = await lstat(conversationFile);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Conversation storage must be a regular file, not a symbolic link.");
    await chmod(conversationFile, 0o600);
    const raw = await readFile(conversationFile, "utf8");
    if (Buffer.byteLength(raw, "utf8") > 2_000_000) throw new Error("Saved conversation exceeds the 2 MB storage limit. It was left untouched.");
    const parsed: unknown = JSON.parse(raw);
    const valid = Array.isArray(parsed) && parsed.length <= 40 && parsed.every((item) => {
      if (!isRecord(item) || !["user", "assistant", "tool"].includes(String(item.role)) ||
          typeof item.content !== "string" || item.content.length > 32000) return false;
      if (item.role === "user") return item.content.length > 0 && item.toolCallId === undefined && item.toolCalls === undefined;
      if (item.role === "tool") return isNonEmptyString(item.toolCallId) && item.toolCallId.length <= 200 && item.toolCalls === undefined;
      if (item.toolCallId !== undefined || (item.content.length === 0 && item.toolCalls === undefined)) return false;
      if (item.toolCalls !== undefined) {
        if (!Array.isArray(item.toolCalls) || item.toolCalls.length < 1 || item.toolCalls.length > 8) return false;
        if (!item.toolCalls.every((call) => isRecord(call) && isNonEmptyString(call.id) && call.id.length <= 200 &&
            isNonEmptyString(call.name) && /^[a-z][a-z0-9_]{1,63}$/.test(call.name) && isRecord(call.arguments))) return false;
      }
      return true;
    });
    if (!valid) throw new Error("Saved conversation is invalid. It was left untouched.");
    return parsed as ProviderAgentMessage[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function saveConversation(messages: ProviderAgentMessage[]): Promise<void> {
  await ensureDataHome();
  const bounded = messages.slice(-40);
  const serialized = JSON.stringify(bounded, null, 2) + "\n";
  if (Buffer.byteLength(serialized, "utf8") > 2_000_000) throw new Error("Conversation is too large to save safely. Use /clear to start a fresh conversation.");
  const temporary = join(dataHome, "conversation." + randomUUID() + ".tmp");
  try {
    await writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600, flag: "wx" });
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


function quickChatHelpReply(input: string): string | null {
  const value = input.trim().toLowerCase().replace(/[?!.,]+$/g, "");
  if (/^(\/help|\/commands|help|commands|show commands)$/.test(value)) {
    return [
      "Here are the chat commands:",
      "- /help or /commands — show this guide",
      "- /clear — clear the saved conversation",
      "- /exit or /quit — leave GULZ chat",
      "",
      "You can also ask questions normally. GULZ only asks for approval when it is about to perform an action that needs permission.",
    ].join("\n");
  }
  if (/(how|where|what).*(exit|leave|quit).*(chat|gulz)?/.test(value) ||
      /^(\/exit|\/quit|exit|quit|leave chat)$/.test(value)) {
    return "To leave this chat, type /exit or /quit and press Enter. Your saved conversation will remain available the next time you open GULZ.";
  }
  if (/(how|where|what).*(clear|delete).*(chat|conversation|history)/.test(value)) {
    return "Type /clear and press Enter to clear the saved conversation. This is a built-in chat command; it does not need an AI action or approval.";
  }
  return null;
}

async function chatSession(): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error("GULZ chat requires an interactive terminal.");
  let config = await readProviderConfig();
  if (!config) throw new Error("AI is not configured. Run /provider to add an AI provider.");
  const remoteEnvironments = await readRemoteEnvironments();
  const remoteTransport = new OpenSshRemoteTransport(
    Object.fromEntries(remoteEnvironments.map((item): [string, string] => [item.name, item.destination])),
    Object.fromEntries(remoteEnvironments.map((item): [string, string] => [item.name, item.workspace])),
  );
  await heartbeatPlace();
  const agentTools = [
    ...createLocalAgentTools(process.cwd()),
    ...remoteEnvironments.flatMap((item) => createRemoteAgentTools(remoteTransport, item.name)),
  ];
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    title("GULZ AI  ·  WORKSPACE ASSISTANT");
    console.log(paint("Your terminal, projects and connected VPSs—one conversation.", ansi.dim));
    console.log(paint("Local workspace: ", ansi.dim) + paint(process.cwd(), ansi.cyan));
    console.log(paint("Connected VPSs: ", ansi.dim) + paint(String(remoteEnvironments.length), ansi.cyan));
    console.log(paint("Ask naturally. /help for commands · /clear for history · /exit to leave.", ansi.dim));
    const messages = await readConversation();
    if (messages.length) {
      for (const message of messages.filter((item) => item.role !== "tool" && !(item.role === "assistant" && item.toolCalls?.length)).slice(-12)) {
        const speaker = message.role === "user" ? "You" : "GULZ";
        const color = message.role === "user" ? ansi.green : ansi.cyan;
        console.log("\n" + paint(speaker, color, ansi.bold));
        renderAssistantMessage(message.content);
      }
    }
    while (true) {
      const input = (await rl.question("\n" + paint("YOU  ", ansi.green, ansi.bold) + paint("› ", ansi.green))).trim();
      if (!input) continue;
      if (input.toLowerCase() === "/exit" || input.toLowerCase() === "/quit") break;
      if (input.toLowerCase() === "/help" || input.toLowerCase() === "/commands") {
        renderAssistantMessage(quickChatHelpReply("/help")!);
        continue;
      }
      if (input.toLowerCase() === "/provider") {
        await manageProviderProfiles("menu");
        config = await readProviderConfig();
        if (config) success("Active model: " + config.model);
        else warning("No active provider is configured.");
        continue;
      }
      if (input.toLowerCase().startsWith("/provider ")) {
        const parts = input.slice(10).trim().split(/\\s+/);
        const action = parts.shift() || "menu";
        if (action === "test") await runProviderConnectionTest();
        else await manageProviderProfiles(action, parts);
        config = await readProviderConfig();
        if (config) success("Active model: " + config.model);
        continue;
      }
      if (input.toLowerCase() === "/clear") {
        messages.length = 0;
        await saveConversation(messages);
        success("Conversation cleared.");
        continue;
      }
      if (input.length > 8000) {
        warning("That message is too long. Keep each message under 8,000 characters.");
        continue;
      }
      const quickReply = quickChatHelpReply(input);
      if (quickReply) {
        messages.push({ role: "user", content: input }, { role: "assistant", content: quickReply });
        await saveConversation(messages);
        console.log("\n" + paint("GULZ", ansi.cyan, ansi.bold) + paint("  ·  RESPONSE", ansi.dim));
        renderAssistantMessage(quickReply);
        continue;
      }
      messages.push({ role: "user", content: input });
      info("Thinking...");
      const turnController = new AbortController();
      const cancelTurn = () => turnController.abort();
      process.once("SIGINT", cancelTurn);
      process.once("SIGTERM", cancelTurn);
      let streamedText = "";
      let streamAnchor = false;
      const finishStream = () => {
        if (!streamAnchor) return;
        stdout.write("\u001b[u\u001b[J" + renderMarkdown(streamedText) + "\n");
        streamAnchor = false;
        streamedText = "";
      };
      try {
        const result = await runAgent({
          provider: config,
          signal: turnController.signal,
          messages: messages.slice(-30),
          tools: agentTools,
          onContentDelta: (delta) => {
            if (!delta) return;
            if (!streamAnchor) {
              console.log("\n" + paint("GULZ", ansi.cyan, ansi.bold) + paint("  ·  RESPONSE", ansi.dim));
              stdout.write("\u001b[s");
              streamAnchor = true;
            }
            streamedText += delta;
            stdout.write("\u001b[u\u001b[J" + renderMarkdown(streamedText));
          },
          approve: async (request) => {
            finishStream();
            title("REVIEW THIS ACTION");
            console.log(paint(request.description, ansi.bold, ansi.white));
            label("Action", request.toolName);
            if (typeof request.arguments.command === "string") {
              console.log(paint("  $ ", ansi.cyan, ansi.bold) + paint(request.arguments.command + " " + (Array.isArray(request.arguments.args) ? request.arguments.args.join(" ") : ""), ansi.yellow));
            }
            console.log(paint("Arguments", ansi.dim));
            renderAssistantMessage(["\x60\x60\x60json", JSON.stringify(request.arguments, null, 2), "\x60\x60\x60"].join("\n"));
            if (request.risk === "high") warning("HIGH IMPACT · may change services, permissions, users or network security. Review every detail.");
            else warning("This can change files or run a program on the selected device or VPS.");
            muted("Tool output may be shared with your configured AI provider. Never approve commands that expose secrets.");
            const answer = await rl.question(paint("Approve this action? ", ansi.bold, ansi.yellow) + paint("(y/N): ", ansi.dim));
            return ["y", "yes"].includes(answer.trim().toLowerCase());
          },
          onToolResult: async (toolName, toolResult) => {
            finishStream();
            const output = isRecord(toolResult) && isRecord(toolResult.output) ? toolResult.output : {};
            const ok = isRecord(toolResult) && toolResult.ok === true && output.processSucceeded !== false && output.verified !== false;
            await recordAudit("agent.tool", { toolName, outcome: ok ? "succeeded" : "not_completed" });
            if (ok) success("Completed · " + toolName.replace(/_/g, " "));
            else warning("Needs attention · " + toolName.replace(/_/g, " "));
          },
        });
        const answer = result.reply || "The requested tool operations finished, but the AI did not provide a final explanation.";
        messages.splice(0, messages.length, ...result.messages);
        await saveConversation(messages);
        if (streamAnchor) {
          stdout.write("\u001b[u\u001b[J" + renderMarkdown(answer) + "\n");
        } else {
          console.log("\n" + paint("GULZ", ansi.cyan, ansi.bold) + paint("  ·  RESPONSE", ansi.dim));
          renderAssistantMessage(answer);
        }
      } catch (error) {
        finishStream();
        const message = error instanceof Error ? error.message : String(error);
        const failureReply = "I couldn't finish that request: " + message;
        messages.push({ role: "assistant", content: failureReply });
        await saveConversation(messages);
        title("REQUEST NEEDS ATTENTION");
        failure(failureReply);
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
    if (environments.length >= 4) throw new Error("GULZ currently supports up to four paired VPS environments so the agent tool catalogue stays within provider limits.");
    if (environments.some((item) => item.name === name || item.name.replace(/-/g, "_") === name.replace(/-/g, "_"))) throw new Error("A remote environment with that name already exists or collides with another tool prefix. Choose another name.");
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
    const action = args[0] ?? "menu";
    if (["menu", "add", "list", "use", "models", "remove"].includes(action)) {
      await manageProviderProfiles(action, args.slice(1));
      return;
    }
    if (action === "test") {
      if (args.length > 1) { failure("Usage: gulz provider test"); process.exitCode = 2; return; }
      const config = await readProviderConfig();
      if (!config) throw new Error("No AI provider is configured. Choose the built-in GULZ AI with 'gulz provider builtin' or configure your own with 'gulz provider configure'.");
      title("AI CONNECTION CHECK");
      info("Testing the selected provider and this exact model's ability to return GULZ tool calls.");
      muted("A harmless capability check only · no workspace files, saved conversations or machine operations are included.");
      try {
        const turn = await generateAgentTurn({ ...config, toolChoice: "required" }, [
          { role: "user", content: "Call the gulz_connection_check tool exactly once with an empty object. Do not execute any real-world action." },
        ], [{
          name: "gulz_connection_check",
          description: "A harmless test tool used only to verify that this model can return a structured tool call. It must never be executed.",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        }]);
        // A returned assistant turn confirms the provider answered the request.
        success("AI provider connection responded");
        label("Connection", "Connected");
        const supported = turn.toolCalls.some((call) => call.name === "gulz_connection_check" && isRecord(call.arguments) && Object.keys(call.arguments).length === 0);
        if (supported) {
          success("This model returned the required structured tool call.");
          label("Tool calling", "Supported");
          info("GULZ agent tools can be used with this model, subject to GULZ approval and safety checks.");
        } else {
          warning("The provider answered, but this model did not return the required structured tool call.");
          label("Tool calling", "Not confirmed");
          info("What this means");
          info("Ordinary AI chat can still work. Device and VPS actions stay unavailable until a model passes this tool-calling test.");
          info("How to fix it");
          info("Choose a model that explicitly supports tool calling / function calling for your provider's API, then run:");
          console.log(paint("  gulz provider configure", ansi.cyan, ansi.bold));
          console.log(paint("  gulz provider test", ansi.cyan, ansi.bold));
        }
        muted("Safety: the test tool was never executed. No files or machine settings were changed.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/HTTP 400|supports tool calling|invalid agent response/i.test(message)) {
          warning("The provider rejected the tool-calling test request.");
          label("Tool calling", "Unsupported or unavailable");
          info("This does not by itself prove that ordinary chat is unavailable.");
          info("Try a model/provider that documents OpenAI-compatible tool or function calling.");
          muted("No test tool was executed and no files or machine settings were changed.");
          return;
        }
        throw error;
      }
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
  if (command === "account") {
    await accountCommand(args);
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
