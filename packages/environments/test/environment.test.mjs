import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, chmod, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectEnvironment } from "../dist/index.js";

test("detects Termux from its environment marker without exposing other variables", async () => {
  const result = await detectEnvironment({ platform: "linux", env: { PREFIX: "/data/data/com.termux/files/usr", PATH: "" }, workingDirectory: "/data/data/com.termux/files/home" });
  assert.equal(result.kind, "termux");
  assert.equal(result.isTermux, true);
  assert.equal("apiKey" in result, false);
});

test("detects package managers and developer tools from PATH without executing them", async () => {
  const root = await mkdtemp(join(tmpdir(), "gulz-env-"));
  try {
    for (const name of ["pkg", "git", "node"]) {
      const file = join(root, name);
      await writeFile(file, "#!/bin/sh\nexit 0\n");
      await chmod(file, 0o700);
    }
    const result = await detectEnvironment({ platform: "linux", env: { PATH: root }, workingDirectory: root });
    assert.equal(result.kind, "linux");
    assert.deepEqual(result.packageManagers, ["pkg"]);
    assert.deepEqual(result.developerTools, ["node", "git"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
