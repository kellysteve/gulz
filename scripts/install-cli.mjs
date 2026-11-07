#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaces = [
  ["@gulz/core", "packages/core/package.json"],
  ["@gulz/execution", "packages/execution/package.json"],
  ["@gulz/providers", "packages/providers/package.json"],
  ["@gulz/environments", "packages/environments/package.json"],
  ["@gulz/agent", "packages/agent/package.json"],
  ["@gulz/remote", "packages/remote/package.json"],
  ["@gulz/cli", "apps/cli/package.json"],
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
  const rootManifestPath = join(root, "package.json");
  let rootManifest;
  try {
    rootManifest = JSON.parse(await readFile(rootManifestPath, "utf8"));
  } catch {
    throw new Error("The GULZ source root package.json is missing or invalid. Run gulz update from the official GULZ source installation.");
  }
  if (!Array.isArray(rootManifest.workspaces) ||
      !rootManifest.workspaces.includes("apps/*") ||
      !rootManifest.workspaces.includes("packages/*")) {
    throw new Error("This checkout does not declare the expected GULZ workspaces. Refusing to run npm with incomplete workspace filters.");
  }

  const manifestContents = [];
  for (const [name, path] of workspaces) {
    const absolutePath = join(root, path);
    try {
      const manifestText = await readFile(absolutePath, "utf8");
      const manifest = JSON.parse(manifestText);
      if (manifest.name !== name) {
        throw new Error(path + " declares package name " + String(manifest.name) + "; expected " + name + ".");
      }
      manifestContents.push(manifestText);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("The GULZ workspace manifest is invalid: " + path + ".");
      if (error instanceof Error && error.message.includes("declares package name")) throw error;
      throw new Error("The GULZ source checkout is incomplete: " + path + " is missing. Run gulz update again after restoring the complete repository checkout.");
    }
  }
  manifestContents.unshift(JSON.stringify(rootManifest));
  const npmVersion = spawnSync(npm, ["--version"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  if (npmVersion.error || npmVersion.status !== 0) throw new Error("npm could not be started. Install a supported Node.js/npm release and try again.");
  const fingerprint = createHash("sha256")
    .update(manifestContents.join("\n---\n"))
    .update("\nnode=" + process.versions.node + "\nplatform=" + process.platform + "\narch=" + process.arch + "\nnpm=" + npmVersion.stdout.trim())
    .digest("hex");
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
    join(root, "node_modules", "@gulz", "environments"),
    join(root, "node_modules", "@gulz", "agent"),
    join(root, "node_modules", "@gulz", "remote"),
    join(root, "node_modules", "@gulz", "cli"),
  ];
  let dependenciesReady = true;
  for (const path of required) {
    try { await access(path); } catch { dependenciesReady = false; break; }
  }

  if (installedFingerprint === fingerprint && dependenciesReady) {
    console.log("CLI dependencies are already up to date; skipping npm install.");
  } else {
    console.log("Installing the CLI workspaces and required build tools (first install or dependency change)...");
    console.log("Source: " + root);
    console.log("Workspace layout verified: core, execution, providers, environments, agent, remote and CLI.");
    run(npm, [
      "install",
      "--workspace=@gulz/core",
      "--workspace=@gulz/execution",
      "--workspace=@gulz/providers",
      "--workspace=@gulz/environments",
      "--workspace=@gulz/agent",
      "--workspace=@gulz/remote",
      "--workspace=@gulz/cli",
      "--include-workspace-root=false",
      "--include=dev",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--prefer-offline",
    ]);
    await mkdir(dirname(marker), { recursive: true });
    await writeFile(marker, JSON.stringify({
      fingerprint,
      installedAt: new Date().toISOString(),
      node: process.versions.node,
      npm: npmVersion.stdout.trim(),
      platform: process.platform,
      arch: process.arch,
    }) + "\n", { mode: 0o600 });
  }

  run(npm, ["run", "build:cli"]);
  run(npm, ["link", "--workspace", "@gulz/cli"]);
  console.log("GULZ CLI is built and linked.");
}

main().catch((error) => {
  console.error("\nGULZ CLI installation failed: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
