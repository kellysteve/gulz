import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlannedOperation } from "@gulz/core";
import { executeLocalOperation, ExecutionError } from "../dist/index.js";

async function withRoot(run) {
  const root = await mkdtemp(join(tmpdir(), "gulz-execution-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

const operation = (kind, target, risk = "low") => createPlannedOperation({
  id: `op-${Math.random().toString(16).slice(2)}`, kind, description: `Test ${kind}`, risk, target,
});

test("inspects metadata within the authorized root", async () => withRoot(async (root) => {
  await writeFile(join(root, "note.txt"), "hello");
  const result = await executeLocalOperation(operation("inspect", "note.txt"), { rootDirectory: root });
  assert.equal(result.verified, true);
  assert.equal(result.output.sizeBytes, 5);
  assert.equal(result.audit.outcome, "succeeded");
}));

test("reads a file and verifies its SHA-256 digest", async () => withRoot(async (root) => {
  await writeFile(join(root, "note.txt"), "hello GULZ");
  const result = await executeLocalOperation(operation("read_file", "note.txt"), { rootDirectory: root });
  assert.equal(result.output.content, "hello GULZ");
  assert.equal(result.output.sha256?.length, 64);
  assert.equal(result.verified, true);
}));

test("rejects path traversal and absolute paths", async () => withRoot(async (root) => {
  await assert.rejects(executeLocalOperation(operation("read_file", "../outside"), { rootDirectory: root }), /escapes|relative path/);
  await assert.rejects(executeLocalOperation(operation("read_file", join(root, "x")), { rootDirectory: root }), /relative path/);
}));

test("rejects symlink targets", async () => withRoot(async (root) => {
  const outside = join(root, "outside.txt");
  await writeFile(outside, "secret");
  await symlink(outside, join(root, "linked.txt"));
  await assert.rejects(executeLocalOperation(operation("read_file", "linked.txt"), { rootDirectory: root }), /Symbolic links/);
}));

test("rejects unsupported operation kinds", async () => withRoot(async (root) => {
  const unsupported = createPlannedOperation({ id: "shell", kind: "run_command", description: "Run shell", risk: "high" });
  await assert.rejects(executeLocalOperation(unsupported, { rootDirectory: root, approved: true }), /only supports inspect and read_file/);
}));

test("rejects inconsistent approval metadata and high-risk filesystem operations", async () => withRoot(async (root) => {
  const moderate = createPlannedOperation({ id: "moderate", kind: "read_file", description: "Read", risk: "moderate", target: "x" });
  await assert.rejects(executeLocalOperation({ ...moderate, requiresApproval: false }, { rootDirectory: root }), /inconsistent/);
  await assert.rejects(executeLocalOperation(moderate, { rootDirectory: root, approved: true }), /restricted to low-risk/);
}));

test("enforces the maximum file size", async () => withRoot(async (root) => {
  await writeFile(join(root, "large.txt"), "123456");
  await assert.rejects(executeLocalOperation(operation("read_file", "large.txt"), { rootDirectory: root, maxReadBytes: 5 }), /exceeds/);
}));

test("supports cancellation", async () => withRoot(async (root) => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(executeLocalOperation(operation("read_file", "note.txt"), { rootDirectory: root, signal: controller.signal }), /cancelled/);
}));

test("rejects directories as file contents", async () => withRoot(async (root) => {
  await mkdir(join(root, "folder"));
  await assert.rejects(executeLocalOperation(operation("read_file", "folder"), { rootDirectory: root }), /regular files/);
}));
