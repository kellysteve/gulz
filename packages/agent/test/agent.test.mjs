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
