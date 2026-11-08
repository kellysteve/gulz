import test from "node:test";
import assert from "node:assert/strict";
import { generateAgentTurn, generateChatReply, generateGoalPlan, ProviderError } from "../dist/index.js";

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


test("accepts bounded directory-listing operations in structured plans", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      summary: "Map the workspace",
      tasks: [{ title: "List files", description: "Discover project entries", operations: [{ kind: "list_directory", description: "List the workspace root", target: "." }] }],
    }) } }],
  }), { status: 200 });
  try {
    const plan = await generateGoalPlan(
      { baseUrl: "https://api.example.com/v1", apiKey: "test", model: "test" },
      { title: "Understand the workspace", description: "" },
    );
    assert.equal(plan.tasks[0]?.operations[0]?.kind, "list_directory");
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("accepts explicit directory creation proposals in structured plans", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      summary: "Prepare the workspace",
      tasks: [{ title: "Create assets folder", description: "Prepare a project directory", operations: [{ kind: "create_directory", description: "Create the assets folder", target: "assets" }] }],
    }) } }],
  }), { status: 200 });
  try {
    const plan = await generateGoalPlan(
      { baseUrl: "https://api.example.com/v1", apiKey: "test", model: "test" },
      { title: "Prepare a project", description: "" },
    );
    assert.equal(plan.tasks[0]?.operations[0]?.kind, "create_directory");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses the built-in GULZ AI request format", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, "https://apis.nabeestech.com");
    assert.equal(parsed.pathname, "/api/v1/ai/gpt5-luna");
    assert.ok(parsed.searchParams.get("apikey"));
    assert.match(parsed.searchParams.get("q") ?? "", /GULZ task planner/);
    assert.match(parsed.searchParams.get("q") ?? "", /Inspect this project/);
    assert.equal(options?.method, "GET");
    assert.equal(options?.body, undefined);
    return new Response(JSON.stringify({
      status: "success",
      success: true,
      response: JSON.stringify({
        summary: "Inspect the workspace",
        tasks: [{ title: "Inspect", description: "Check the workspace", operations: [{ kind: "inspect", description: "Inspect the current directory", target: "." }] }],
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const plan = await generateGoalPlan(
      { baseUrl: "https://apis.nabeestech.com/api/v1/ai/gpt5-luna", apiKey: "test-key", model: "gpt5-luna" },
      { title: "Inspect this project", description: "" },
    );
    assert.equal(plan.tasks.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("sends bounded conversational history to an OpenAI-compatible provider", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.equal(body.messages.at(-1).content, "Can you explain that again?");
    assert.equal(body.messages.at(-2).content, "Scalar means magnitude only.");
    return new Response(JSON.stringify({ choices: [{ message: { content: "Of course. A scalar has size but no direction." } }] }), { status: 200 });
  };
  try {
    const answer = await generateChatReply(
      { baseUrl: "https://api.example.com/v1", apiKey: "test-key", model: "test-model" },
      [
        { role: "assistant", content: "Scalar means magnitude only." },
        { role: "user", content: "Can you explain that again?" },
      ],
    );
    assert.match(answer, /no direction/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects invalid or oversized conversational history before network access", async () => {
  await assert.rejects(
    generateChatReply(
      { baseUrl: "https://api.example.com/v1", apiKey: "test-key", model: "test-model" },
      [{ role: "system", content: "not allowed" }],
    ),
    /message is invalid/,
  );
  await assert.rejects(
    generateChatReply(
      { baseUrl: "https://api.example.com/v1", apiKey: "test-key", model: "test-model" },
      Array.from({ length: 41 }, () => ({ role: "user", content: "hello" })),
    ),
    /between 1 and 40/,
  );
});

test("uses the built-in GULZ AI request format for conversational turns", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, "/api/v1/ai/gpt5-luna");
    assert.match(parsed.searchParams.get("q") ?? "", /CONTINUOUS|capable, honest and practical AI assistant/);
    assert.match(parsed.searchParams.get("q") ?? "", /USER: Hello GULZ/);
    assert.equal(options?.method, "GET");
    return new Response(JSON.stringify({ success: true, response: "Hello! What can I help you with?" }), { status: 200 });
  };
  try {
    const answer = await generateChatReply(
      { baseUrl: "https://apis.nabeestech.com/api/v1/ai/gpt5-luna", apiKey: "test-key", model: "gpt5-luna" },
      [{ role: "user", content: "Hello GULZ" }],
    );
    assert.match(answer, /What can I help/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("preserves assistant tool calls and tool results in built-in provider conversation context", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const query = new URL(String(url)).searchParams.get("q") ?? "";
    assert.match(query, /ASSISTANT TOOL CALLS/);
    assert.match(query, /inspect_environment/);
    assert.match(query, /TOOL RESULT \(call_previous\)/);
    assert.match(query, /workspace checked/);
    return new Response(JSON.stringify({ success: true, response: "I remember the workspace inspection." }), { status: 200 });
  };
  try {
    const turn = await generateAgentTurn(
      { baseUrl: "https://apis.nabeestech.com/api/v1/ai/gpt5-luna", apiKey: "test-key", model: "gpt5-luna" },
      [
        { role: "user", content: "Inspect the workspace." },
        { role: "assistant", content: "", toolCalls: [{ id: "call_previous", name: "inspect_environment", arguments: {} }] },
        { role: "tool", toolCallId: "call_previous", content: "workspace checked" },
        { role: "assistant", content: "The workspace was checked." },
      ],
      [{ name: "inspect_environment", description: "Inspect environment", parameters: { type: "object", properties: {}, additionalProperties: false } }],
    );
    assert.match(turn.content, /remember the workspace inspection/);
    assert.equal(turn.toolCalls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
