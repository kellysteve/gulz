import test from "node:test";
import assert from "node:assert/strict";
import { generateGoalPlan, ProviderError } from "../dist/index.js";

test("rejects insecure remote provider URLs", async () => {
  await assert.rejects(
    generateGoalPlan({ baseUrl: "http://example.com/v1", apiKey: "secret", model: "model" }, { title: "Goal", description: "" }),
    /HTTPS/,
  );
});

test("rejects provider URL credentials and query parameters", async () => {
  await assert.rejects(
    generateGoalPlan({ baseUrl: "https://user:pass@example.com/v1?x=1", apiKey: "secret", model: "model" }, { title: "Goal", description: "" }),
    /must not contain credentials/,
  );
});

test("rejects missing credentials before making a network request", async () => {
  await assert.rejects(
    generateGoalPlan({ baseUrl: "https://api.example.com/v1", apiKey: "", model: "model" }, { title: "Goal", description: "" }),
    /API key/,
  );
});

test("validates structured provider plans and rejects destructive operations", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      summary: "Inspect the project safely",
      tasks: [{
        title: "Inspect",
        description: "Read basic project information",
        operations: [{ kind: "inspect", description: "Inspect the workspace root", target: "." }],
      }],
    }) } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    const plan = await generateGoalPlan(
      { baseUrl: "https://api.example.com/v1", apiKey: "test-key", model: "test-model" },
      { title: "Understand this project", description: "Inspect the current folder." },
    );
    assert.equal(plan.tasks.length, 1);
    assert.equal(plan.tasks[0]?.operations[0]?.kind, "inspect");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects malformed JSON and unsupported AI operations", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      summary: "Unsafe",
      tasks: [{ title: "Delete", description: "Remove files", operations: [{ kind: "delete", description: "Delete everything", target: "." }] }],
    }) } }],
  }), { status: 200 });
  try {
    await assert.rejects(
      generateGoalPlan({ baseUrl: "https://api.example.com/v1", apiKey: "test", model: "test" }, { title: "Unsafe goal", description: "" }),
      /unsupported operation/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("supports local HTTP provider endpoints for local model servers", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "http://localhost:11434/v1/chat/completions");
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        summary: "Check runtime",
        tasks: [{ title: "Check", description: "Check Node", operations: [{ kind: "run_command", description: "Read Node version", command: "node", args: ["--version"], target: "." }] }],
      }) } }],
    }), { status: 200 });
  };
  try {
    const plan = await generateGoalPlan(
      { baseUrl: "http://localhost:11434/v1", apiKey: "local", model: "local-model" },
      { title: "Check Node", description: "" },
    );
    assert.equal(plan.tasks[0]?.operations[0]?.command, "node");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
