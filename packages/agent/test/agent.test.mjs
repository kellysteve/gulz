import test from "node:test";
import assert from "node:assert/strict";
import { createLocalAgentTools, createRemoteAgentTools, runAgent } from "../dist/index.js";

test("local tool catalogue exposes only bounded workspace capabilities", () => {
  const tools = createLocalAgentTools(process.cwd());
  assert.deepEqual(tools.map((tool) => tool.definition.name), ["inspect_environment", "inspect_path", "list_directory", "read_file", "create_directory", "write_file", "run_command"]);
  assert.equal(tools.find((tool) => tool.definition.name === "write_file")?.requiresApproval({ path: "x", content: "y" }), true);
  assert.equal(tools.find((tool) => tool.definition.name === "read_file")?.requiresApproval({ path: "README.md" }), false);
});

test("agent does not execute a proposed write when approval is denied", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const body = JSON.parse(String(options?.body));
    if (calls === 1) return new Response(JSON.stringify({ choices: [{ message: { content: "", tool_calls: [{ id: "call_write", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "agent-test.txt", content: "not written" }) } }] } }] }), { status: 200 });
    assert.equal(body.messages.some((message) => message.role === "tool" && message.content.includes("approval_denied")), true);
    return new Response(JSON.stringify({ choices: [{ message: { content: "I did not make the change because approval was declined." } }] }), { status: 200 });
  };
  try {
    const result = await runAgent({ provider: { baseUrl: "https://provider.example/v1", apiKey: "test", model: "tool-model" }, messages: [{ role: "user", content: "Create a file." }], tools: createLocalAgentTools(process.cwd()), approve: async () => false });
    assert.match(result.reply, /approval was declined/);
    assert.equal(result.toolCallsExecuted, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("mutating tool implementation cannot be called without approval context", async () => {
  const tools = createLocalAgentTools(process.cwd());
  const writeTool = tools.find((tool) => tool.definition.name === "write_file");
  assert.ok(writeTool);
  await assert.rejects(
    writeTool.execute({ path: "agent-should-not-write.txt", content: "blocked" }, {}),
    /explicit user approval/,
  );
});

test("remote tools preserve namespacing and forward approval decisions to the remote policy", async () => {
  const requests = [];
  const tools = createRemoteAgentTools({ invoke: async (request) => { requests.push(request); return { verified: true }; } }, "production");
  const write = tools.find((tool) => tool.definition.name === "remote_production_write_file");
  assert.ok(write);
  assert.equal(write.requiresApproval({ path: "README.md", content: "x" }), true);
  await write.execute({ path: "README.md", content: "x" }, { approved: true });
  assert.equal(requests[0].environmentId, "production");
  assert.equal(requests[0].toolName, "write_file");
  assert.equal(requests[0].approved, true);
});

test("classifies privileged commands as high impact and blocks critical disk commands", async () => {
  const originalFetch = globalThis.fetch;
  let approvalRisk;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ choices: [{ message: {
      content: "",
      tool_calls: [{ id: "call_sudo", type: "function", function: { name: "run_command", arguments: JSON.stringify({ command: "sudo", args: ["-n", "apt-get", "install", "-y", "nginx"] }) } }],
    } }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { content: "I will wait for approval." } }] }), { status: 200 });
  };
  try {
    const tools = createLocalAgentTools(process.cwd());
    await runAgent({
      provider: { baseUrl: "https://provider.example/v1", apiKey: "test", model: "tool-model" },
      messages: [{ role: "user", content: "Install nginx." }],
      tools,
      approve: async (request) => { approvalRisk = request.risk; return false; },
    });
    assert.equal(approvalRisk, "high");
  } finally { globalThis.fetch = originalFetch; }
});

test("blocks recursive deletion of the root filesystem before requesting approval", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: {
    content: "",
    tool_calls: [{ id: "call_rm", type: "function", function: { name: "run_command", arguments: JSON.stringify({ command: "rm", args: ["-rf", "/"] }) } }],
  } }] }), { status: 200 });
  try {
    await assert.rejects(runAgent({
      provider: { baseUrl: "https://provider.example/v1", apiKey: "test", model: "tool-model" },
      messages: [{ role: "user", content: "Delete everything." }],
      tools: createLocalAgentTools(process.cwd()),
      approve: async () => true,
    }), /blocks this critical disk or root-filesystem command/);
  } finally { globalThis.fetch = originalFetch; }
});

test("blocks known secret files and credential directories from provider context", async () => {
  const tools = createLocalAgentTools(process.cwd());
  const read = tools.find((tool) => tool.definition.name === "read_file");
  assert.ok(read);
  await assert.rejects(read.execute({ path: ".env.production" }, {}), /likely secret or credential file/);
  await assert.rejects(read.execute({ path: ".ssh/id_ed25519" }, {}), /known credential directories/);
  await assert.rejects(read.execute({ path: ".docker/config.json" }, {}), /known credential directories/);
});

test("caps a single user turn at eight-or-fewer total tool actions and returns a continuation message", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ choices: [{ message: {
      content: "",
      tool_calls: [{ id: "call_env_" + calls, type: "function", function: { name: "inspect_environment", arguments: "{}" } }],
    } }] }), { status: 200 });
  };
  try {
    const result = await runAgent({
      provider: { baseUrl: "https://provider.example/v1", apiKey: "test", model: "tool-model" },
      messages: [{ role: "user", content: "Check my environment." }],
      tools: createLocalAgentTools(process.cwd()),
      maxToolCalls: 1,
    });
    assert.equal(result.toolCallsExecuted, 1);
    assert.match(result.reply, /safe action limit/);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test("redacts common credentials from tool output before sending it back to the provider", async () => {
  const originalFetch = globalThis.fetch;
  let providerToolResult = "";
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const body = JSON.parse(String(options?.body));
    if (calls === 1) return new Response(JSON.stringify({ choices: [{ message: {
      content: "",
      tool_calls: [{ id: "call_sensitive", type: "function", function: { name: "emit_sensitive", arguments: "{}" } }],
    } }] }), { status: 200 });
    providerToolResult = body.messages.find((message) => message.role === "tool")?.content ?? "";
    return new Response(JSON.stringify({ choices: [{ message: { content: "I checked the output and redacted credential-like values." } }] }), { status: 200 });
  };
  try {
    const result = await runAgent({
      provider: { baseUrl: "https://provider.example/v1", apiKey: "test", model: "tool-model" },
      messages: [{ role: "user", content: "Inspect this result." }],
      tools: [{
        definition: { name: "emit_sensitive", description: "Test-only output source", parameters: { type: "object", properties: {}, additionalProperties: false } },
        requiresApproval: () => false,
        execute: async () => ({ output: { content: ["API_KEY=super-secret-value", "Authorization: Bearer abcdefghijklmnop", "DATABASE_URL=postgres://user:db-password@db.example/app", "sk-abcdefghijklmnopqrstuvwx1234"].join(String.fromCharCode(10)) } }),
      }],
    });
    assert.match(result.reply, /redacted/);
    assert.ok(providerToolResult.includes("[REDACTED]"));
    assert.doesNotMatch(providerToolResult, /super-secret-value|abcdefghijklmnop|db-password|sk-abcdefghijklmnopqrstuvwx1234/);
  } finally { globalThis.fetch = originalFetch; }
});

test("does not ask again for the same operation after the user declines it", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let approvals = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls <= 2) return new Response(JSON.stringify({ choices: [{ message: {
      content: "",
      tool_calls: [{ id: "call_repeat_" + calls, type: "function", function: { name: "run_command", arguments: JSON.stringify({ command: "sudo", args: ["-n", "apt-get", "install", "-y", "nginx"] }) } }],
    } }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { content: "I will not retry the declined install." } }] }), { status: 200 });
  };
  try {
    const result = await runAgent({
      provider: { baseUrl: "https://provider.example/v1", apiKey: "test", model: "tool-model" },
      messages: [{ role: "user", content: "Install nginx." }],
      tools: createLocalAgentTools(process.cwd()),
      approve: async () => { approvals += 1; return false; },
    });
    assert.equal(approvals, 1);
    assert.equal(result.stoppedForApproval, true);
  } finally { globalThis.fetch = originalFetch; }
});


test("returns a reusable, redacted tool transcript for the next chat turn", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let secondTurnMessages = [];
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const body = JSON.parse(String(options?.body));
    if (calls === 1) return new Response(JSON.stringify({ choices: [{ message: {
      content: "",
      tool_calls: [{ id: "call_history", type: "function", function: { name: "history_probe", arguments: "{}" } }],
    } }] }), { status: 200 });
    if (calls === 2) return new Response(JSON.stringify({ choices: [{ message: { content: "The inspection is complete." } }] }), { status: 200 });
    secondTurnMessages = body.messages;
    return new Response(JSON.stringify({ choices: [{ message: { content: "I remember the earlier inspection." } }] }), { status: 200 });
  };
  try {
    const tools = [{
      definition: { name: "history_probe", description: "Test-only tool", parameters: { type: "object", properties: {}, additionalProperties: false } },
      requiresApproval: () => false,
      execute: async () => ({ output: { content: "workspace checked" } }),
    }];
    const first = await runAgent({
      provider: { baseUrl: "https://provider.example/v1", apiKey: "test", model: "tool-model" },
      messages: [{ role: "user", content: "Inspect the workspace." }],
      tools,
    });
    assert.ok(first.messages.some((message) => message.role === "assistant" && message.toolCalls?.some((call) => call.id === "call_history")));
    assert.ok(first.messages.some((message) => message.role === "tool" && message.toolCallId === "call_history"));
    await runAgent({
      provider: { baseUrl: "https://provider.example/v1", apiKey: "test", model: "tool-model" },
      messages: [...first.messages, { role: "user", content: "What did you find?" }],
      tools,
    });
    assert.ok(secondTurnMessages.some((message) => message.role === "assistant" && message.tool_calls?.some((call) => call.id === "call_history")));
    assert.ok(secondTurnMessages.some((message) => message.role === "tool" && message.tool_call_id === "call_history"));
  } finally { globalThis.fetch = originalFetch; }
});

test("history trimming starts at a user message instead of an orphaned tool result", async () => {
  const originalFetch = globalThis.fetch;
  let sentMessages = [];
  globalThis.fetch = async (_url, options) => {
    sentMessages = JSON.parse(String(options?.body)).messages;
    return new Response(JSON.stringify({ choices: [{ message: { content: "Ready." } }] }), { status: 200 });
  };
  try {
    const history = [
      { role: "user", content: "Old request." },
      { role: "assistant", content: "", toolCalls: [{ id: "old_call", name: "inspect_environment", arguments: {} }] },
      { role: "tool", toolCallId: "old_call", content: "{}" },
      { role: "assistant", content: "Old result." },
      { role: "user", content: "Recent request." },
      ...Array.from({ length: 8 }, (_, index) => ({ role: "assistant", content: "Context " + index })),
    ];
    await runAgent({
      provider: { baseUrl: "https://provider.example/v1", apiKey: "test", model: "tool-model" },
      messages: history,
      tools: createLocalAgentTools(process.cwd()),
    });
    const conversationMessages = sentMessages.filter((message) => message.role !== "system");
    assert.equal(conversationMessages[0]?.role, "user");
    assert.equal(conversationMessages[0]?.content, "Recent request.");
  } finally { globalThis.fetch = originalFetch; }
});
