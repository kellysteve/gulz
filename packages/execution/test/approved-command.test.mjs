import test from "node:test";
import assert from "node:assert/strict";
import { executeApprovedCommand } from "../dist/index.js";

test("requires explicit approval before starting a program", async () => {
  await assert.rejects(
    executeApprovedCommand("node", ["--version"], { cwd: process.cwd(), approved: false }),
    /explicit user approval/,
  );
});

test("rejects shell interpreters and inline code execution", async () => {
  await assert.rejects(executeApprovedCommand("bash", ["-c", "echo unsafe"], { cwd: process.cwd(), approved: true }), /shell or shell interpreter/);
  await assert.rejects(executeApprovedCommand("node", ["-e", "process.exit(0)"], { cwd: process.cwd(), approved: true }), /Inline shell or interpreter code/);
  await assert.rejects(executeApprovedCommand("sudo", ["apt-get", "install", "nginx"], { cwd: process.cwd(), approved: true }), /non-interactive mode/);
  await assert.rejects(executeApprovedCommand("sudo", ["-n", "/bin/bash", "script.sh"], { cwd: process.cwd(), approved: true }), /cannot be used to launch a shell/);
  await assert.rejects(executeApprovedCommand("sudo", ["-n", "-u", "root", "/usr/bin/bash", "script.sh"], { cwd: process.cwd(), approved: true }), /cannot be used to launch a shell/);
  await assert.rejects(executeApprovedCommand("sudo", ["-n", "-u", "root", "/bin/rm", "-rf", "/"], { cwd: process.cwd(), approved: true }), /critical-operation policy/);
  await assert.rejects(executeApprovedCommand("sudo", ["-n", "/bin/rm", "-r", "-f", "/"], { cwd: process.cwd(), approved: true }), /critical-operation policy/);
  await assert.rejects(executeApprovedCommand("dd", ["if=/dev/zero", "of=/dev/sda"], { cwd: process.cwd(), approved: true }), /critical-operation policy/);
});

test("runs an explicitly approved program without a shell and bounds the result", async () => {
  const result = await executeApprovedCommand("node", ["--version"], { cwd: process.cwd(), approved: true, timeoutMs: 10000 });
  assert.equal(result.processSucceeded, true);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /^v\d+/);
  assert.equal(result.cwd, process.cwd());
});
