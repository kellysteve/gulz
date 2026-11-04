# @gulz/providers

Provider-neutral AI planning adapters for GULZ.

The initial adapter supports OpenAI-compatible chat-completions endpoints, including hosted APIs and local model servers. It sends only the goal title and description supplied by the caller; it does not inspect or upload local files.

Provider output is untrusted. The adapter enforces response-size, task-count, operation-count, field-size and operation-kind limits. It returns structured proposals only. The caller must derive risk, enforce local command allowlists, apply path policy, request approval and verify execution results.

Remote provider URLs must use HTTPS. HTTP is permitted only for localhost endpoints. API keys are supplied by the caller and are never logged by this package.

Licensed under Apache-2.0.
