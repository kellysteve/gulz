import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "../..");

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

test("CLI-only installation includes TypeScript but excludes website tooling", async () => {
  const rootPackage = await readJson("package.json");
  const corePackage = await readJson("packages/core/package.json");
  const executionPackage = await readJson("packages/execution/package.json");
  const cliPackage = await readJson("apps/cli/package.json");
  const installScript = rootPackage.scripts["install:cli"];

  assert.equal(typeof installScript, "string");
  assert.match(installScript, /--include-workspace-root=false/);
  assert.match(installScript, /--include=dev/);
  assert.match(installScript, /--workspace=@gulz\/core/);
  assert.match(installScript, /--workspace=@gulz\/execution/);
  assert.match(installScript, /--workspace=@gulz\/cli/);
  assert.doesNotMatch(installScript, /@gulz\/website|wrangler/);

  for (const [name, manifest] of [
    ["@gulz/core", corePackage],
    ["@gulz/execution", executionPackage],
    ["@gulz/cli", cliPackage],
  ]) {
    assert.ok(
      manifest.devDependencies?.typescript,
      name + " must declare TypeScript as a development dependency",
    );
  }
});
