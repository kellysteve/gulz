import test from "node:test";
import assert from "node:assert/strict";
import {
  addGoalTask,
  createGoal,
  createPlannedOperation,
  operationRequiresApproval,
  summarizeApprovals,
  transitionGoal,
  transitionTask,
} from "../dist/index.js";

const at = "2026-11-02T12:00:00.000Z";

test("creates normalized goals with deterministic timestamps", () => {
  const goal = createGoal({ id: "g-1", title: "  Ship GULZ  ", description: "  first release  ", now: at });
  assert.equal(goal.title, "Ship GULZ");
  assert.equal(goal.description, "first release");
  assert.equal(goal.status, "draft");
  assert.equal(goal.createdAt, at);
  assert.deepEqual(goal.tasks, []);
});

test("rejects empty goal identifiers and titles", () => {
  assert.throws(() => createGoal({ id: " ", title: "valid" }), /ID is required/);
  assert.throws(() => createGoal({ id: "g-1", title: "  " }), /title is required/);
});

test("derives approval from risk instead of accepting a caller decision", () => {
  const low = createPlannedOperation({ id: "op-1", kind: "inspect", description: "Inspect status", risk: "low" });
  const high = createPlannedOperation({ id: "op-2", kind: "delete", description: "Delete data", risk: "high" });
  assert.equal(low.requiresApproval, false);
  assert.equal(high.requiresApproval, true);
  assert.equal(operationRequiresApproval("moderate"), true);
  assert.equal(operationRequiresApproval("critical"), true);
});

test("rejects malformed planned operations", () => {
  assert.throws(() => createPlannedOperation({ id: " ", kind: "inspect", description: "x", risk: "low" }), /ID is required/);
  assert.throws(() => createPlannedOperation({ id: "op", kind: "inspect", description: " ", risk: "low" }), /description is required/);
});

test("rejects inherited object keys as invalid runtime risk values", () => {
  assert.throws(() => createPlannedOperation({ id: "op-x", kind: "inspect", description: "Inspect", risk: "__proto__" }), /valid operation risk/);
});

test("approval summary counts each risk and derives approvals", () => {
  const operations = [
    createPlannedOperation({ id: "1", kind: "inspect", description: "Inspect", risk: "low" }),
    createPlannedOperation({ id: "2", kind: "write_file", description: "Write", risk: "moderate" }),
    createPlannedOperation({ id: "3", kind: "delete", description: "Delete", risk: "critical" }),
  ];
  assert.deepEqual(summarizeApprovals(operations), {
    total: 3,
    requiringApproval: 2,
    byRisk: { low: 1, moderate: 1, high: 0, critical: 1 },
  });
});

test("adds tasks immutably and prevents duplicate task IDs", () => {
  const goal = createGoal({ id: "g-1", title: "Build" , now: at });
  const task = { id: "t-1", title: "Plan", description: "Plan work", operations: [] };
  const updated = addGoalTask(goal, task, at);
  assert.equal(goal.tasks.length, 0);
  assert.equal(updated.tasks.length, 1);
  assert.equal(updated.tasks[0].status, "pending");
  assert.throws(() => addGoalTask(updated, task, at), /already exists/);
});

test("rejects starting an empty goal and invalid transitions", () => {
  const goal = createGoal({ id: "g-1", title: "Build", now: at });
  assert.throws(() => transitionGoal(goal, "running", at), /at least one task/);
  assert.throws(() => transitionGoal(goal, "completed", at), /Invalid goal transition/);
});

test("goal cannot complete while any task is unfinished", () => {
  const goal = addGoalTask(createGoal({ id: "g-1", title: "Build", now: at }), {
    id: "t-1", title: "Compile", description: "Compile", operations: [],
  }, at);
  const planned = transitionGoal(goal, "planned", at);
  const running = transitionGoal(planned, "running", at);
  assert.throws(() => transitionGoal(running, "completed", at), /unfinished/);
  const finishedTask = transitionTask(running, "t-1", "running", at);
  const completedTask = transitionTask(finishedTask, "t-1", "completed", at);
  assert.equal(transitionGoal(completedTask, "completed", at).status, "completed");
});

test("task transitions reject unknown IDs and terminal-state changes", () => {
  const goal = addGoalTask(createGoal({ id: "g-1", title: "Build", now: at }), {
    id: "t-1", title: "Compile", description: "Compile", operations: [],
  }, at);
  assert.throws(() => transitionTask(goal, "missing", "running", at), /not found/);
  const skipped = transitionTask(goal, "t-1", "skipped", at);
  assert.throws(() => transitionTask(skipped, "t-1", "running", at), /Invalid task transition/);
});

test("rejects invalid operation kinds and direct invalid risk checks", () => {
  assert.throws(
    () => createPlannedOperation({ id: "op", kind: "execute_anything", description: "Run", risk: "low" }),
    /valid operation kind/,
  );
  assert.throws(() => operationRequiresApproval("__proto__"), /valid operation risk/);
});

test("requires structured command arguments and prevents misleading previews", () => {
  assert.throws(() => createPlannedOperation({ id: "run-1", kind: "run_command", description: "Run", risk: "moderate", command: "node" }), /executable and an argument array/);
  assert.throws(() => createPlannedOperation({ id: "run-2", kind: "run_command", description: "Run", risk: "moderate", command: "node", args: ["--version"], commandPreview: "node -e unsafe" }), /preview must match/);
  const command = createPlannedOperation({ id: "run-3", kind: "run_command", description: "Run", risk: "moderate", command: "node", args: ["--version"], commandPreview: "node --version" });
  assert.equal(command.requiresApproval, true);
  assert.equal(command.commandPreview, "node --version");
});