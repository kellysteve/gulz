import test from "node:test";
import assert from "node:assert/strict";
import { createLocalAgentTools, runAgent } from "../dist/index.js";

test("local tool catalogue exposes only bounded workspace capabilities", () => {
  const tools = createLocalAgentTools(process.cwd());
  assert.deepEqual(tools.map((tool) => tool.definition.name), ["inspect_path", "list_directory", "read_file", "create_directory", "write_file", "run_diagnostic"]);
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
