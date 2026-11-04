/**
 * GULZ Core — shared domain model for terminal, AI and task workspace.
 *
 * This package deliberately contains no shell execution or provider calls.
 * It defines validated state transitions and approval decisions that every
 * interface must use before an operation can be executed.
 */

export type GoalStatus =
  | "draft"
  | "planned"
  | "awaiting_approval"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskStatus =
  | "pending"
  | "awaiting_approval"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export type RiskLevel = "low" | "moderate" | "high" | "critical";

export type OperationKind =
  | "inspect"
  | "list_directory"
  | "create_directory"
  | "read_file"
  | "write_file"
  | "run_command"
  | "network"
  | "install"
  | "delete"
  | "permission_change"
  | "remote_operation";

export interface PlannedOperation {
  id: string;
  kind: OperationKind;
  description: string;
  risk: RiskLevel;
  target?: string;
  content?: string;
  command?: string;
  args?: string[];
  commandPreview?: string;
  requiresApproval: boolean;
}

export interface GoalTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  operations: PlannedOperation[];
  /** Operation IDs whose verified effects were durably recorded. */
  completedOperationIds?: string[];
  createdAt: string;
  updatedAt: string;
  result?: string;
  error?: string;
}

export interface GoalRecord {
  id: string;
  title: string;
  description: string;
  status: GoalStatus;
  tasks: GoalTask[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  failureReason?: string;
}

export interface CreateGoalInput {
  id: string;
  title: string;
  description?: string;
  now?: string;
}

export class GoalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoalStateError";
  }
}

const goalTransitions: Record<GoalStatus, readonly GoalStatus[]> = {
  draft: ["planned", "cancelled"],
  planned: ["awaiting_approval", "running", "cancelled"],
  awaiting_approval: ["planned", "running", "cancelled"],
  running: ["paused", "completed", "failed", "cancelled"],
  paused: ["running", "cancelled", "failed"],
  completed: [],
  failed: ["planned", "cancelled"],
  cancelled: [],
};

const taskTransitions: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ["awaiting_approval", "running", "skipped", "cancelled"],
  awaiting_approval: ["pending", "running", "cancelled"],
  running: ["paused", "completed", "failed", "cancelled"],
  paused: ["running", "failed", "cancelled"],
  completed: [],
  failed: ["pending", "cancelled"],
  skipped: [],
  cancelled: [],
};

const approvalRiskThreshold: RiskLevel = "moderate";
const operationKinds = new Set<OperationKind>([
  "inspect", "list_directory", "create_directory", "read_file", "write_file", "run_command", "network",
  "install", "delete", "permission_change", "remote_operation",
]);
const riskOrder: Record<RiskLevel, number> = {
  low: 0,
  moderate: 1,
  high: 2,
  critical: 3,
};

/** Low-risk operations may proceed automatically; all others need approval. */
export function operationRequiresApproval(risk: RiskLevel): boolean {
  if (!Object.hasOwn(riskOrder, risk)) {
    throw new GoalStateError("A valid operation risk level is required.");
  }
  return riskOrder[risk] >= riskOrder[approvalRiskThreshold];
}


export interface CreatePlannedOperationInput {
  id: string;
  kind: OperationKind;
  description: string;
  risk: RiskLevel;
  target?: string;
  content?: string;
  command?: string;
  args?: string[];
  commandPreview?: string;
}

/**
 * Create an operation with its approval requirement derived from its risk.
 * Callers (including AI planners) cannot choose or override this decision.
 */
export function createPlannedOperation(input: CreatePlannedOperationInput): PlannedOperation {
  if (typeof input !== "object" || input === null) {
    throw new GoalStateError("A valid planned operation is required.");
  }
  if (typeof input.id !== "string" || !input.id.trim()) {
    throw new GoalStateError("An operation ID is required.");
  }
  if (typeof input.description !== "string" || !input.description.trim()) {
    throw new GoalStateError("An operation description is required.");
  }
  if (!operationKinds.has(input.kind)) {
    throw new GoalStateError("A valid operation kind is required.");
  }
  if (!Object.hasOwn(riskOrder, input.risk)) {
    throw new GoalStateError("A valid operation risk level is required.");
  }
  if (input.target !== undefined && typeof input.target !== "string") {
    throw new GoalStateError("An operation target must be a string.");
  }
  if (input.content !== undefined && typeof input.content !== "string") {
    throw new GoalStateError("Operation content must be a string.");
  }
  if (input.command !== undefined && typeof input.command !== "string") {
    throw new GoalStateError("An operation command must be a string.");
  }
  if (input.args !== undefined && (!Array.isArray(input.args) || !input.args.every((arg) => typeof arg === "string"))) {
    throw new GoalStateError("Operation arguments must be an array of strings.");
  }
  if (input.commandPreview !== undefined && typeof input.commandPreview !== "string") {
    throw new GoalStateError("An operation command preview must be a string.");
  }
  if (input.kind === "run_command") {
    if (typeof input.command !== "string" || !input.command.trim() || !Array.isArray(input.args)) {
      throw new GoalStateError("A command operation requires an executable and an argument array.");
    }
    const canonicalPreview = [input.command, ...input.args].join(" ");
    if (input.commandPreview !== undefined && input.commandPreview !== canonicalPreview) {
      throw new GoalStateError("A command preview must match its executable and arguments.");
    }
  }

  return {
    ...input,
    ...(input.kind === "run_command" ? { commandPreview: [input.command, ...(input.args ?? [])].join(" ") } : {}),
    id: input.id.trim(),
    description: input.description.trim(),
    requiresApproval: operationRequiresApproval(input.risk),
  };
}

/** Build a new goal record without performing any external side effects. */
export function createGoal(input: CreateGoalInput): GoalRecord {
  const title = input.title.trim();
  if (!input.id.trim()) throw new GoalStateError("A goal ID is required.");
  if (!title) throw new GoalStateError("A goal title is required.");

  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id,
    title,
    description: input.description?.trim() ?? "",
    status: "draft",
    tasks: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Add a task to a goal that has not started execution. */
export function addGoalTask(
  goal: GoalRecord,
  task: Omit<GoalTask, "status" | "createdAt" | "updatedAt">,
  now = new Date().toISOString(),
): GoalRecord {
  if (!["draft", "planned", "awaiting_approval"].includes(goal.status)) {
    throw new GoalStateError("Tasks cannot be added after goal execution has started.");
  }
  if (goal.tasks.some((existing) => existing.id === task.id)) {
    throw new GoalStateError(`Task ID "${task.id}" already exists in this goal.`);
  }

  return {
    ...goal,
    tasks: [...goal.tasks, { ...task, completedOperationIds: [], status: "pending", createdAt: now, updatedAt: now }],
    updatedAt: now,
  };
}

/** Enforce the goal lifecycle. Invalid transitions fail closed. */
export function transitionGoal(
  goal: GoalRecord,
  next: GoalStatus,
  now = new Date().toISOString(),
): GoalRecord {
  if (!goalTransitions[goal.status].includes(next)) {
    throw new GoalStateError(`Invalid goal transition: ${goal.status} -> ${next}.`);
  }
  if (next === "running" && goal.tasks.length === 0) {
    throw new GoalStateError("A goal needs at least one task before execution can start.");
  }
  if (next === "completed" && goal.tasks.some((task) => !["completed", "skipped"].includes(task.status))) {
    throw new GoalStateError("A goal cannot complete while tasks remain unfinished.");
  }

  return {
    ...goal,
    status: next,
    updatedAt: now,
    ...(next === "completed" ? { completedAt: now } : {}),
  };
}

/** Enforce task lifecycle transitions without mutating the original record. */
export function transitionTask(
  goal: GoalRecord,
  taskId: string,
  next: TaskStatus,
  now = new Date().toISOString(),
): GoalRecord {
  const index = goal.tasks.findIndex((task) => task.id === taskId);
  if (index < 0) throw new GoalStateError(`Task "${taskId}" was not found.`);

  const current = goal.tasks[index]!;
  if (!taskTransitions[current.status].includes(next)) {
    throw new GoalStateError(`Invalid task transition: ${current.status} -> ${next}.`);
  }

  const tasks = [...goal.tasks];
  tasks[index] = { ...current, status: next, updatedAt: now };
  return { ...goal, tasks, updatedAt: now };
}

/** Summarize approval requirements before any executor receives a plan. */
export function summarizeApprovals(operations: PlannedOperation[]): {
  total: number;
  requiringApproval: number;
  byRisk: Record<RiskLevel, number>;
} {
  const byRisk: Record<RiskLevel, number> = {
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
  };

  let requiringApproval = 0;
  for (const operation of operations) {
    byRisk[operation.risk] += 1;
    if (operationRequiresApproval(operation.risk)) requiringApproval += 1;
  }

  return { total: operations.length, requiringApproval, byRisk };
}
