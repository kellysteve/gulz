#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifests = [
  "package.json",
  "apps/cli/package.json",
  "packages/core/package.json",
  "packages/execution/package.json",
  "packages/providers/package.json",
];
const marker = join(root, "node_modules", ".gulz-cli-install.json");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(program, args) {
  const result = spawnSync(program, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(program + " " + args.join(" ") + " failed with exit code " + String(result.status) + ".");
  }
}

async function main() {
  const manifestContents = [];
  for (const path of manifests) {
    try {
      manifestContents.push(await readFile(join(root, path), "utf8"));
    } catch {
      throw new Error("The GULZ source checkout is incomplete: " + path + " is missing. Run gulz update again after restoring the complete repository checkout.");
    }
  }
  const fingerprint = createHash("sha256").update(manifestContents.join("\n---\n")).digest("hex");
  let installedFingerprint = "";
  try {
    installedFingerprint = JSON.parse(await readFile(marker, "utf8")).fingerprint ?? "";
  } catch {
    // A missing or invalid marker triggers a normal dependency install.
  }
  const required = [
    join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc"),
    join(root, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx"),
    join(root, "node_modules", "@gulz", "core"),
    join(root, "node_modules", "@gulz", "execution"),
    join(root, "node_modules", "@gulz", "providers"),
    join(root, "node_modules", "@gulz", "cli"),
  ];
  let dependenciesReady = true;
  for (const path of required) {
    try { await access(path); } catch { dependenciesReady = false; break; }
  }

  if (installedFingerprint === fingerprint && dependenciesReady) {
    console.log("CLI dependencies are already up to date; skipping npm install.");
  } else {
    console.log("Installing the CLI workspaces and their required build tools...");
    run(npm, [
      "install",
      "--workspace=@gulz/core",
      "--workspace=@gulz/execution",
      "--workspace=@gulz/providers",
      "--workspace=@gulz/cli",
      "--include-workspace-root=false",
      "--include=dev",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--prefer-offline",
    ]);
    await mkdir(dirname(marker), { recursive: true });
    await writeFile(marker, JSON.stringify({ fingerprint, installedAt: new Date().toISOString() }) + "\n", { mode: 0o600 });
  }

  run(npm, ["run", "build:cli"]);
  run(npm, ["link", "--workspace", "@gulz/cli"]);
  console.log("GULZ CLI is built and linked.");
}

main().catch((error) => {
  console.error("\nGULZ CLI installation failed: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
