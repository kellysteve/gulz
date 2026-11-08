import test from "node:test";
import assert from "node:assert/strict";
import { generateAgentTurn } from "../dist/index.js";

test("sends function tools and parses a provider tool call", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.equal(body.tool_choice, "auto");
    assert.equal(body.tools[0].function.name, "inspect_path");
    return new Response(JSON.stringify({ choices: [{ message: {
      content: "",
      tool_calls: [{ id: "call_123", type: "function", function: { name: "inspect_path", arguments: JSON.stringify({ path: "." }) } }],
    } }] }), { status: 200 });
  };
  try {
    const turn = await generateAgentTurn(
      { baseUrl: "https://provider.example/v1", apiKey: "test", model: "tool-model" },
      [{ role: "user", content: "Inspect this folder." }],
      [{ name: "inspect_path", description: "Inspect a path", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
    );
    assert.equal(turn.toolCalls.length, 1);
    assert.equal(turn.toolCalls[0]?.name, "inspect_path");
    assert.equal(turn.toolCalls[0]?.arguments.path, ".");
  } finally { globalThis.fetch = originalFetch; }
});

test("rejects tool calls that are not in the registered catalogue", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: {
    content: "",
    tool_calls: [{ id: "call_bad", type: "function", function: { name: "delete_everything", arguments: "{}" } }],
  } }] }), { status: 200 });
  try {
    await assert.rejects(
      generateAgentTurn({ baseUrl: "https://provider.example/v1", apiKey: "test", model: "tool-model" },
        [{ role: "user", content: "Do something." }],
        [{ name: "inspect_path", description: "Inspect", parameters: { type: "object" } }]),
      /unavailable tool/,
    );
  } finally { globalThis.fetch = originalFetch; }
});


test("streams assistant text deltas from an OpenAI-compatible SSE response", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(String(options?.body));
    const events = [
      { choices: [{ delta: { content: "Hello" } }] },
      { choices: [{ delta: { content: " there." } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ];
    const body = events.map((event) => "data: " + JSON.stringify(event)).join("\n") + "\ndata: [DONE]\n";
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
  const chunks = [];
  try {
    const turn = await generateAgentTurn(
      { baseUrl: "https://provider.example/v1", apiKey: "test", model: "tool-model" },
      [{ role: "user", content: "Say hello." }],
      [{ name: "inspect_path", description: "Inspect a path", parameters: { type: "object", properties: { path: { type: "string" } } } }],
      (delta) => chunks.push(delta),
    );
    assert.equal(requestBody.stream, true);
    assert.deepEqual(chunks, ["Hello", " there."]);
    assert.equal(turn.content, "Hello there.");
    assert.equal(turn.toolCalls.length, 0);
  } finally { globalThis.fetch = originalFetch; }
});


test("streams built-in GULZ AI text when its endpoint supports SSE", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(String(url)).pathname, "/api/v1/ai/gpt5-luna");
    assert.match(options?.headers?.Accept ?? "", /text\/event-stream/);
    const events = [
      { delta: "Built-in " },
      { delta: "streaming works." },
    ];
    return new Response(events.map((event) => "data: " + JSON.stringify(event)).join("\n") + "\ndata: [DONE]\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };
  const chunks = [];
  try {
    const turn = await generateAgentTurn(
      { baseUrl: "https://apis.nabeestech.com/api/v1/ai/gpt5-luna", apiKey: "test", model: "gpt5-luna" },
      [{ role: "user", content: "Say hello." }],
      [{ name: "inspect_environment", description: "Inspect environment", parameters: { type: "object", properties: {}, additionalProperties: false } }],
      (delta) => chunks.push(delta),
    );
    assert.deepEqual(chunks, ["Built-in ", "streaming works."]);
    assert.equal(turn.content, "Built-in streaming works.");
  } finally { globalThis.fetch = originalFetch; }
});
