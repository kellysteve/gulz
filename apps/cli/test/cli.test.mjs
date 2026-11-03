import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cliPath = resolve("dist/index.js");

async function withHome(run) {
  const home = await mkdtemp(join(tmpdir(), "gulz-cli-test-"));
  try {
    await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function invoke(home, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    cwd: home,
    env: { ...process.env, GULZ_HOME: home },
  });
}

test("initializes storage and creates, lists and shows a saved goal", async () => {
  await withHome(async (home) => {
    const initialized = invoke(home, "init");
    assert.equal(initialized.status, 0, initialized.stderr);
    assert.match(initialized.stdout, /GULZ is initialized/);

    const created = invoke(home, "goal", "create", "Build a test project");
    assert.equal(created.status, 0, created.stderr);
    assert.match(created.stdout, /Goal saved/);
    const id = created.stdout.match(/ID:\s+([a-f0-9-]+)/)?.[1];
    assert.ok(id, "CLI should print the generated goal ID");

    const listed = invoke(home, "goals");
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /Build a test project/);

    const shown = invoke(home, "goal", "show", id);
    assert.equal(shown.status, 0, shown.stderr);
    const goal = JSON.parse(shown.stdout);
    assert.equal(goal.id, id);
    assert.equal(goal.title, "Build a test project");

    const stored = JSON.parse(await readFile(join(home, "goals.json"), "utf8"));
    assert.equal(stored.length, 1);
    if (process.platform !== "win32") {
      const mode = (await stat(join(home, "goals.json"))).mode & 0o777;
      assert.equal(mode, 0o600);
    }
  });
});

test("refuses to overwrite malformed JSON and explains recovery", async () => {
  await withHome(async (home) => {
    const original = "{ this is not valid JSON";
    await writeFile(join(home, "goals.json"), original);
    const result = invoke(home, "goals");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid JSON/);
    assert.equal(await readFile(join(home, "goals.json"), "utf8"), original);
  });
});

test("rejects structurally invalid goal records instead of trusting a JSON array", async () => {
  await withHome(async (home) => {
    const original = JSON.stringify([{ id: "fake", title: "Not a valid goal" }]);
    await writeFile(join(home, "goals.json"), original);
    const result = invoke(home, "doctor");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /failed validation/);
    assert.equal(await readFile(join(home, "goals.json"), "utf8"), original);
  });
});

test("rejects duplicate goal identifiers in saved data", async () => {
  await withHome(async (home) => {
    const goal = {
      id: "duplicate",
      title: "A goal",
      description: "",
      status: "draft",
      tasks: [],
      createdAt: "2026-11-02T12:00:00.000Z",
      updatedAt: "2026-11-02T12:00:00.000Z",
    };
    await writeFile(join(home, "goals.json"), JSON.stringify([goal, goal]));
    const result = invoke(home, "goals");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /duplicate goal IDs/);
  });
});

test("tightens existing storage directory and goals file permissions", async () => {
  if (process.platform === "win32") return;
  await withHome(async (home) => {
    await chmod(home, 0o755);
    await writeFile(join(home, "goals.json"), "[]", { mode: 0o644 });
    const result = invoke(home, "goals");
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await stat(home)).mode & 0o777, 0o700);
    assert.equal((await stat(join(home, "goals.json"))).mode & 0o777, 0o600);
  });
});

test("refuses a symbolic link as the goals storage file", async () => {
  if (process.platform === "win32") return;
  await withHome(async (home) => {
    const outside = join(home, "outside.json");
    const linked = join(home, "goals.json");
    await writeFile(outside, "[]");
    await symlink(outside, linked);
    const result = invoke(home, "goals");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /regular file, not a symbolic link/);
    assert.equal(await readFile(outside, "utf8"), "[]");
  });
});

test("preserves every goal when multiple CLI processes create goals concurrently", async () => {
  await withHome(async (home) => {
    const run = (...args) => new Promise((resolveRun, rejectRun) => {
      const child = spawn(process.execPath, [cliPath, ...args], {
        encoding: "utf8",
        cwd: home,
        env: { ...process.env, GULZ_HOME: home },
      });
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", rejectRun);
      child.on("close", (status) => {
        if (status !== 0) rejectRun(new Error(stderr || `CLI exited with ${status}`));
        else resolveRun();
      });
    });
    await Promise.all(Array.from({ length: 8 }, (_, index) => run("goal", "create", `Concurrent goal ${index}`)));
    const saved = JSON.parse(await readFile(join(home, "goals.json"), "utf8"));
    assert.equal(saved.length, 8);
    assert.equal(new Set(saved.map((goal) => goal.id)).size, 8);
  });
});

test("inspects and reads files only inside the current working directory", async () => {
  await withHome(async (home) => {
    await writeFile(join(home, "hello.txt"), "Hello from GULZ");
    const inspected = invoke(home, "inspect", "hello.txt");
    assert.equal(inspected.status, 0, inspected.stderr);
    assert.match(inspected.stdout, /file_metadata/);
    const read = invoke(home, "read", "hello.txt");
    assert.equal(read.status, 0, read.stderr);
    assert.match(read.stdout, /Hello from GULZ/);
    const traversal = invoke(home, "read", "../outside.txt");
    assert.equal(traversal.status, 1);
    assert.match(traversal.stderr, /escapes/);
  });
});

test("requires a title when creating a goal", async () => {
  await withHome(async (home) => {
    const result = invoke(home, "goal", "create");
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage: gulz goal create/);
  });
});

test("shows the supervised run command and fails closed without an interactive terminal", async () => {
  const help = invoke(process.cwd(), "--help");
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /run <command>/);
  const attempt = invoke(process.cwd(), "run", "node", "--version");
  assert.equal(attempt.status, 1);
  assert.match(attempt.stderr, /interactive terminal/);
});
test("opens a helpful non-interactive fallback when no terminal is attached", async () => {
  await withHome(async (home) => {
    const result = invoke(home);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: gulz <command>/);
    assert.match(result.stdout, /run `gulz` in a terminal to open the interactive session/);
  });
});
