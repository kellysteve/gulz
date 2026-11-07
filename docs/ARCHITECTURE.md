# GULZ architecture

## Product direction

GULZ is a provider-independent AI agent. The selected model supplies reasoning; GULZ owns tool access, execution policy, environments and verification. Its interfaces share one policy and state model:

1. **Terminal:** direct commands and local machine control.
2. **AI assistant:** natural-language conversation connected to a bounded tool-calling agent.
3. **Agent activity:** internal approvals, operations, results and resumable work without requiring users to manage goals.

No interface may bypass the shared execution policy. AI output is untrusted input, never authorization.

## Package boundaries

- **CLI (`apps/cli`):** terminal UX, local goal storage, provider setup, plan review, approvals, execution orchestration, recovery, update/repair/uninstall.
- **Core (`packages/core`):** internal work/task records, typed operation contracts, lifecycle transitions and risk-derived approval requirements. No network or machine side effects.
- **Execution (`packages/execution`):** the only current machine-operation adapter. It validates operations again, enforces authorized-root path rules, symlink protection, approvals, timeouts, output limits and verification.
- **Providers (`packages/providers`):** OpenAI-compatible chat, structured planning and function/tool-calling adapter. Tool calls are untrusted proposals and are validated by the agent/tool implementations.
- **Local state:** currently stored under `~/.gulz` (or `GULZ_HOME`) as validated JSON/JSONL files with owner-only permissions where supported. SQLite, encrypted secret storage and backup/restore policy remain future hardening work.
- **Website/API:** Cloudflare Workers and static assets. The website is not yet the source of truth for local machine execution.
- **Agent (`packages/agent`):** bounded provider/tool loop, tool registry, approval callback and initial local workspace tools. A remote transport interface exists, but no SSH transport or remote daemon is shipped.

## Continuous chat lifecycle

`gulz chat` opens a persistent interactive conversation. Recent user and assistant messages are stored in `~/.gulz/conversation.json` (owner-only permissions where supported), bounded to 40 messages and 8,000 characters per message. Provider configuration is the user's one-time choice to connect an AI service. Once configured, chat messages are sent directly to that provider without a repeated per-session or per-message consent prompt. The user can change or remove the provider in settings. `/clear` requires a yes/no confirmation; `/exit` returns to the shell. Conversation history is sent to the configured provider as context. Chat is connected to the agent runtime. When the selected model supports tool calling, it may inspect the authorized workspace and propose registered tools. Mutating actions and diagnostic commands require approval. Unsupported capabilities are not simulated.

## Current CLI lifecycle

The primary experience is continuous chat. The agent sends the bounded conversation and registered tool schemas to the selected provider. Model tool calls are checked against the local registry, then local tool implementations derive risk and require approval before mutating operations. Verified tool results return to the same model conversation. The older goal/task workflow remains available as an advanced compatibility path.

Goal states are validated by core. The primary CLI workflow is `gulz do <request>`: the user describes the outcome in natural language, the selected AI proposes tasks and operations, GULZ creates an internal goal automatically, and the user can start execution without manually creating or selecting a goal. Manual goal and plan commands remain available as advanced controls. Execution moves the internal goal to running and persists task/operation checkpoints. Ctrl+C safely pauses work; `gulz resume` recovers interrupted runs from saved checkpoints; `gulz cancel` uses a yes/no confirmation. Completed and cancelled goals are terminal.

Task states are independent. Executable tasks cannot be manually marked completed. They become completed only after all planned operations return verified results. Manual checklist tasks without operations remain user-managed.

## Current local operation policy

| Operation | Risk | Policy |
|---|---|---|
| Inspect path | Low | Authorized root only; symlinks rejected |
| List directory | Low | Maximum 200 entry names/types; child symlinks never followed |
| Read file | Low | UTF-8, bounded size, SHA-256 verified |
| Create directory | Moderate | Explicit yes/no approval; recursive path-component checks |
| Write file | Moderate | Explicit yes/no approval; atomic write; replaced file backed up |
| Delete file | High | Explicit yes/no approval; regular files only, 256 KiB max, moved to private recoverable backup |
| Run command | Moderate | Exact argument allowlist, no shell; npm build/test workflows require approval |

Arbitrary shell, package installation, permanent deletion, permission changes, general network access and SSH are not available through the current execution adapter.

## AI provider boundary

The provider adapter uses OpenAI-compatible chat-completions APIs, including function/tool calling where supported by the selected model. Provider configuration is stored in `~/.gulz/provider.json` with owner-only permissions where supported, or supplied via `GULZ_AI_BASE_URL`, `GULZ_AI_MODEL` and `GULZ_AI_API_KEY`. The key is stored as plaintext protected by filesystem permissions, not encrypted.

The user chooses the provider during setup; chat messages and bounded conversation context are sent directly to that provider. Tool schemas are also sent when using agent mode. Local workspace files are read only through local tools and their returned content may be included in model context. SSH credentials are not uploaded. The provider response is size-bounded and schema-validated. Risk levels are derived locally; the model cannot lower risk or authorize an operation.

## Agent execution and recovery

1. Send the user message, bounded history and tool schemas to the configured provider.
2. Validate returned tool names and JSON arguments.
3. Derive operation risk locally; never trust model-provided risk or approval claims.
4. Ask for approval before mutating operations. Deny by default if no approval callback is available.
5. Execute through the shared local execution adapter and return bounded results to the provider.
6. Stop on cancellation or the bounded agent-round limit. Record tool outcomes in local audit history.
7. The legacy goal/task workflow continues to checkpoint multi-step operations separately.

No operation is reported as successful without a verified result. Local execution is not a hardened sandbox against a hostile process racing filesystem changes; do not run GULZ with elevated privileges.

## Distribution and updates

The supported current install route is a source checkout with an interactive installer. CLI installation excludes the website's Wrangler/Workerd dependency to support Android Termux. `gulz update` requires a clean fast-forwardable checkout; `gulz repair` rebuilds/relinks without pulling; `gulz uninstall` removes the source checkout and command link while preserving `~/.gulz`.

Stable signed binaries, checksums, published npm packages, rollback, remote execution and native desktop/mobile installers are release work, not current capabilities. See [AGENT_ARCHITECTURE.md](AGENT_ARCHITECTURE.md) for the local/remote agent trust model.
