import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
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
  const unsupported = createPlannedOperation({ id: "shell", kind: "run_command", description: "Run shell", risk: "moderate", command: "sh", args: ["-c", "echo unsafe"] });
  await assert.rejects(executeLocalOperation(unsupported, { rootDirectory: root, approved: true }), /not allowlisted/);
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
  await assert.rejects(executeLocalOperation(operation("read_file", "folder"), { rootDirectory: root }), /regular file/);
}));


test("requires explicit approval before writing", async () => withRoot(async (root) => {
  const write = createPlannedOperation({ id: "write-denied", kind: "write_file", description: "Write", risk: "moderate", target: "new.txt", content: "hello" });
  await assert.rejects(executeLocalOperation(write, { rootDirectory: root }), /explicit user approval/);
}));

test("writes a new file atomically after approval", async () => withRoot(async (root) => {
  const write = createPlannedOperation({ id: "write-new", kind: "write_file", description: "Write", risk: "moderate", target: "new.txt", content: "hello" });
  const result = await executeLocalOperation(write, { rootDirectory: root, approved: true });
  assert.equal(result.output.kind, "file_written");
  assert.equal(result.output.sizeBytes, 5);
  assert.equal(result.output.backupPath, undefined);
  const { readFile } = await import("node:fs/promises");
  assert.equal(await readFile(join(root, "new.txt"), "utf8"), "hello");
}));

test("preserves an overwritten file in a backup", async () => withRoot(async (root) => {
  await writeFile(join(root, "existing.txt"), "original");
  const write = createPlannedOperation({ id: "write-existing", kind: "write_file", description: "Write", risk: "moderate", target: "existing.txt", content: "replacement" });
  const result = await executeLocalOperation(write, { rootDirectory: root, approved: true });
  assert.ok(result.output.backupPath);
  const { readFile } = await import("node:fs/promises");
  assert.equal(await readFile(join(root, "existing.txt"), "utf8"), "replacement");
  assert.equal(await readFile(join(root, result.output.backupPath), "utf8"), "original");
}));

test("rejects write targets that are symbolic links", async () => withRoot(async (root) => {
  await writeFile(join(root, "real.txt"), "safe");
  await symlink(join(root, "real.txt"), join(root, "alias.txt"));
  const write = createPlannedOperation({ id: "write-link", kind: "write_file", description: "Write", risk: "moderate", target: "alias.txt", content: "unsafe" });
  await assert.rejects(executeLocalOperation(write, { rootDirectory: root, approved: true }), /Symbolic links/);
}));

test("enforces the write content size limit", async () => withRoot(async (root) => {
  const write = createPlannedOperation({ id: "write-large", kind: "write_file", description: "Write", risk: "moderate", target: "large.txt", content: "123456" });
  await assert.rejects(executeLocalOperation(write, { rootDirectory: root, approved: true, maxReadBytes: 5 }), /write limit/);
}));


test("rejects symlinked parent directories even when they point inside the root", async () => withRoot(async (root) => {
  await mkdir(join(root, "real-folder"));
  await symlink(join(root, "real-folder"), join(root, "alias-folder"));
  const write = createPlannedOperation({ id: "write-parent-link", kind: "write_file", description: "Write", risk: "moderate", target: "alias-folder/file.txt", content: "unsafe" });
  await assert.rejects(executeLocalOperation(write, { rootDirectory: root, approved: true }), /Symbolic links/);
}));

test("can inspect the authorized root itself", async () => withRoot(async (root) => {
  const result = await executeLocalOperation(operation("inspect", "."), { rootDirectory: root });
  assert.equal(result.output.isDirectory, true);
}));

test("rejects invalid UTF-8 instead of returning corrupted text", async () => withRoot(async (root) => {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(root, "binary.dat"), Buffer.from([0xff, 0xfe, 0xfd]));
  await assert.rejects(executeLocalOperation(operation("read_file", "binary.dat"), { rootDirectory: root }), /encoded data|encoded|decode/i);
}));

test("does not overwrite an existing file without explicit approval", async () => withRoot(async (root) => {
  await writeFile(join(root, "existing.txt"), "keep me");
  const write = createPlannedOperation({ id: "write-no-approval", kind: "write_file", description: "Write", risk: "moderate", target: "existing.txt", content: "replace me" });
  await assert.rejects(executeLocalOperation(write, { rootDirectory: root }), /explicit user approval/);
  const { readFile } = await import("node:fs/promises");
  assert.equal(await readFile(join(root, "existing.txt"), "utf8"), "keep me");
}));

test("restores a backup through the same approved write policy", async () => withRoot(async (root) => {
  await writeFile(join(root, "note.txt"), "original");
  const replace = createPlannedOperation({ id: "replace-for-restore", kind: "write_file", description: "Replace", risk: "moderate", target: "note.txt", content: "new value" });
  const replaced = await executeLocalOperation(replace, { rootDirectory: root, approved: true });
  assert.ok(replaced.output.backupPath);
  const backupRead = await executeLocalOperation(operation("read_file", replaced.output.backupPath), { rootDirectory: root });
  const restore = createPlannedOperation({ id: "restore-note", kind: "write_file", description: "Restore backup", risk: "moderate", target: "note.txt", content: backupRead.output.content });
  const restored = await executeLocalOperation(restore, { rootDirectory: root, approved: true });
  const { readFile, stat } = await import("node:fs/promises");
  assert.equal(await readFile(join(root, "note.txt"), "utf8"), "original");
  assert.ok(restored.output.backupPath, "the replaced version should itself be preserved");
  if (process.platform !== "win32") {
    assert.equal((await stat(join(root, replaced.output.backupPath))).mode & 0o777, 0o600);
  }
}));

test("runs the explicitly approved Node version command without a shell", async () => withRoot(async (root) => {
  const command = createPlannedOperation({
    id: "node-version",
    kind: "run_command",
    description: "Check Node.js version",
    risk: "moderate",
    command: "node",
    args: ["--version"],
    target: ".",
  });
  await assert.rejects(executeLocalOperation(command, { rootDirectory: root }), /explicit user approval/);
  const result = await executeLocalOperation(command, { rootDirectory: root, approved: true });
  assert.equal(result.output.kind, "command_result");
  assert.equal(result.output.exitCode, 0);
  assert.equal(result.verified, true);
  assert.match(result.output.stdout ?? "", /^v\d+\./);
  assert.equal(result.audit.kind, "run_command");
  assert.equal(result.audit.outcome, "succeeded");
}));

test("rejects arbitrary shell-like commands and unsafe arguments", async () => withRoot(async (root) => {
  const unsafe = createPlannedOperation({
    id: "unsafe-command",
    kind: "run_command",
    description: "Try arbitrary command",
    risk: "moderate",
    command: "node",
    args: ["-e", "process.exit(0)"],
    target: ".",
  });
  await assert.rejects(executeLocalOperation(unsafe, { rootDirectory: root, approved: true }), /not allowlisted/);
  const shell = createPlannedOperation({
    id: "shell-command",
    kind: "run_command",
    description: "Try shell",
    risk: "moderate",
    command: "sh",
    args: ["-c", "echo unsafe"],
    target: ".",
  });
  await assert.rejects(executeLocalOperation(shell, { rootDirectory: root, approved: true }), /not allowlisted/);
}));

test("rejects command execution in a file instead of a directory", async () => withRoot(async (root) => {
  await writeFile(join(root, "file.txt"), "x");
  const command = createPlannedOperation({
    id: "bad-cwd",
    kind: "run_command",
    description: "Check version",
    risk: "moderate",
    command: "node",
    args: ["--version"],
    target: "file.txt",
  });
  await assert.rejects(executeLocalOperation(command, { rootDirectory: root, approved: true }), /working directory must be an existing directory/);
}));

test("does not pass NODE_OPTIONS preload hooks to diagnostic subprocesses", async () => withRoot(async (root) => {
  const marker = join(root, "preload-ran.txt");
  const preload = join(root, "preload.cjs");
  await writeFile(preload, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed")`);
  const previous = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = `--require=${preload}`;
  try {
    const command = createPlannedOperation({
      id: "safe-node-env",
      kind: "run_command",
      description: "Check Node version",
      risk: "moderate",
      command: "node",
      args: ["--version"],
      target: ".",
    });
    const result = await executeLocalOperation(command, { rootDirectory: root, approved: true });
    assert.equal(result.output.exitCode, 0);
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
  }
  const { access } = await import("node:fs/promises");
  await assert.rejects(access(marker));
}));

test("ignores inherited Git directory overrides and runs only inside the authorized workspace", async () => withRoot(async (root) => {
  const outside = join(root, "..", `gulz-external-git-${Date.now()}`);
  await mkdir(outside, { recursive: true });
  try {
    execFileSync("git", ["init", root], { stdio: "ignore" });
    execFileSync("git", ["init", outside], { stdio: "ignore" });
    await writeFile(join(root, "workspace-file.txt"), "inside");
    const previous = process.env.GIT_DIR;
    process.env.GIT_DIR = join(outside, ".git");
    try {
      const command = createPlannedOperation({
        id: "git-status-scope",
        kind: "run_command",
        description: "Inspect workspace status",
        risk: "moderate",
        command: "git",
        args: ["status", "--short"],
        target: ".",
      });
      const result = await executeLocalOperation(command, { rootDirectory: root, approved: true });
      assert.match(result.output.stdout ?? "", /workspace-file\.txt/);
      assert.equal(result.output.exitCode, 0);
    } finally {
      if (previous === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previous;
    }
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
}));

test("rejects diagnostic command operations that are not moderate-risk", async () => withRoot(async (root) => {
  const command = createPlannedOperation({
    id: "low-risk-command",
    kind: "run_command",
    description: "Check Node version",
    risk: "low",
    command: "node",
    args: ["--version"],
    target: ".",
  });
  await assert.rejects(executeLocalOperation(command, { rootDirectory: root }), /must be moderate-risk/);
}));


test("lists bounded directory entry names and reports symlinks without following them", async () => withRoot(async (root) => {
  await mkdir(join(root, "folder"));
  await writeFile(join(root, "note.txt"), "hello");
  await symlink(join(root, "note.txt"), join(root, "linked.txt"));
  const result = await executeLocalOperation(operation("list_directory", "."), { rootDirectory: root });
  assert.equal(result.verified, true);
  assert.equal(result.output.kind, "directory_listing");
  assert.deepEqual(result.output.entries, [
    { name: "folder", type: "directory" },
    { name: "linked.txt", type: "symlink" },
    { name: "note.txt", type: "file" },
  ]);
  assert.equal(result.output.hasMore, false);
  assert.equal(result.audit.kind, "list_directory");
}));

test("rejects listing a file as a directory", async () => withRoot(async (root) => {
  await writeFile(join(root, "note.txt"), "hello");
  await assert.rejects(
    executeLocalOperation(operation("list_directory", "note.txt"), { rootDirectory: root }),
    /requires an existing directory/,
  );
}));


test("runs an explicitly approved npm version check without a shell", async () => withRoot(async (root) => {
  if (process.platform === "win32") return;
  const command = createPlannedOperation({
    id: "npm-version",
    kind: "run_command",
    description: "Check npm version",
    risk: "moderate",
    command: "npm",
    args: ["--version"],
    target: ".",
  });
  const result = await executeLocalOperation(command, { rootDirectory: root, approved: true });
  assert.equal(result.output.exitCode, 0);
  assert.match(result.output.stdout ?? "", /^\d+\./);
  assert.equal(result.verified, true);
}));


test("creates nested directories only after explicit approval", async () => withRoot(async (root) => {
  const create = createPlannedOperation({
    id: "mkdir-approved",
    kind: "create_directory",
    description: "Create nested workspace folder",
    risk: "moderate",
    target: "new/project/assets",
  });
  await assert.rejects(executeLocalOperation(create, { rootDirectory: root }), /explicit user approval/);
  const result = await executeLocalOperation(create, { rootDirectory: root, approved: true });
  assert.equal(result.output.kind, "directory_created");
  assert.equal(result.output.isDirectory, true);
  const { stat } = await import("node:fs/promises");
  assert.equal((await stat(join(root, "new/project/assets"))).isDirectory(), true);
}));

test("rejects directory creation through symlinked parent components", async () => withRoot(async (root) => {
  const outside = join(root, "outside");
  await mkdir(outside);
  await symlink(outside, join(root, "linked"));
  const create = createPlannedOperation({
    id: "mkdir-link",
    kind: "create_directory",
    description: "Try linked path",
    risk: "moderate",
    target: "linked/unsafe",
  });
  await assert.rejects(executeLocalOperation(create, { rootDirectory: root, approved: true }), /Symbolic links/);
  await assert.rejects(import("node:fs/promises").then(({ access }) => access(join(outside, "unsafe"))));
}));


test("moves deleted files into private verified backups that can be restored", async () => withRoot(async (root) => {
  await writeFile(join(root, "important.txt"), "keep this recoverable");
  const deletion = createPlannedOperation({
    id: "delete-reversible",
    kind: "delete_file",
    description: "Move a file into backup storage",
    risk: "high",
    target: "important.txt",
  });
  await assert.rejects(executeLocalOperation(deletion, { rootDirectory: root, approved: false }), /explicit user approval/);
  const removed = await executeLocalOperation(deletion, { rootDirectory: root, approved: true });
  assert.equal(removed.output.kind, "file_deleted");
  assert.equal(removed.verified, true);
  assert.equal(removed.output.backupPath?.startsWith(".gulz-deleted-"), true);
  await assert.rejects(import("node:fs/promises").then(({ access }) => access(join(root, "important.txt"))));
  const { stat } = await import("node:fs/promises");
  if (process.platform !== "win32") assert.equal((await stat(join(root, removed.output.backupPath))).mode & 0o777, 0o600);
  const backup = await executeLocalOperation(operation("read_file", removed.output.backupPath), { rootDirectory: root });
  const restore = createPlannedOperation({
    id: "restore-reversible",
    kind: "write_file",
    description: "Restore the deleted file",
    risk: "moderate",
    target: "important.txt",
    content: backup.output.content,
  });
  await executeLocalOperation(restore, { rootDirectory: root, approved: true });
  const restored = await executeLocalOperation(operation("read_file", "important.txt"), { rootDirectory: root });
  assert.equal(restored.output.content, "keep this recoverable");
}));

test("refuses to delete directories or symbolic links", async () => withRoot(async (root) => {
  await mkdir(join(root, "folder"));
  await writeFile(join(root, "note.txt"), "hello");
  await symlink(join(root, "note.txt"), join(root, "linked.txt"));
  const removeDirectory = createPlannedOperation({ id: "delete-dir", kind: "delete_file", description: "Delete directory", risk: "high", target: "folder" });
  const removeLink = createPlannedOperation({ id: "delete-link", kind: "delete_file", description: "Delete symlink", risk: "high", target: "linked.txt" });
  await assert.rejects(executeLocalOperation(removeDirectory, { rootDirectory: root, approved: true }), /regular file/);
  await assert.rejects(executeLocalOperation(removeLink, { rootDirectory: root, approved: true }), /Symbolic links/);
}));
