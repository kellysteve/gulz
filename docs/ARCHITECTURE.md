# GULZ architecture

## Product direction

GULZ is a provider-independent AI agent. The selected model supplies reasoning; GULZ owns tools, environment access, authorization, execution, persistence and verification. The user experience is conversation-first. Internal goals, plans and task records are not concepts users need to manage.

## Five components

1. **AI Assistant** — natural conversation, bounded context and final explanations.
2. **Agent Engine** — bounded tool-calling loop, registry, cancellation and result handoff.
3. **Tools & Integrations** — typed local and future connected-service capabilities.
4. **Environment Manager** — Termux, Linux, macOS, Windows and future remote environments.
5. **Provider System** — selected AI provider/model; reasoning is separate from machine access.

## Package boundaries

- **CLI (apps/cli):** terminal experience, provider setup, conversation persistence, user approvals, audit history and source updates.
- **Core (packages/core):** internal work/task records, operation contracts, lifecycle transitions and risk-derived approval requirements. No machine side effects.
- **Providers (packages/providers):** OpenAI-compatible chat-completions, structured planning and function/tool-calling. The built-in provider receives a structured JSON tool-call convention; actual compliance must be verified against the live service.
- **Agent (packages/agent):** bounded model/tool loop, registered tools, approval callback, local workspace tools and remote transport interface.
- **Environments (packages/environments):** read-only OS, Termux, package-manager and developer-tool detection. It does not execute commands or return environment variable values.
- **Execution (packages/execution):** local filesystem enforcement and shell-free command execution. This is the enforcement boundary, not a general-purpose sandbox.
- **Local state:** currently stored under ~/.gulz (or GULZ_HOME) with owner-only file permissions where supported. Provider keys are not encrypted yet.
- **Remote (`packages/remote` + CLI stdio mode):** an on-demand OpenSSH transport and remote stdio agent protocol are implemented in source. The controller reuses the user's SSH config/agent, requires strict host-key verification, disables agent forwarding and port forwarding, and sends bounded JSON to fixed remote command entry points. Remote workspace roots are explicitly selected and checked on the host.

## Agent request lifecycle

1. The user sends a message; bounded conversation history and registered tool schemas are sent to the selected provider.
2. The model returns a natural-language response or proposes tool calls.
3. GULZ validates tool names and bounded JSON arguments.
4. Tool implementations validate inputs again and derive risk locally; model-supplied risk is ignored.
5. Low-risk reads can run in the authorized workspace. File changes, directory creation and all direct program execution require explicit approval. Missing approval means deny.
6. The execution adapter performs the operation and returns bounded structured results.
7. Results return to the model for a natural-language explanation. Audit records are kept locally.

The agent loop is bounded to at most 12 model rounds, 8 tool calls per response, bounded message/argument sizes and AbortSignal cancellation. The model cannot authorize its own proposed tool calls.

## Current local capabilities

| Capability | Current boundary |
|---|---|
| Inspect/list/read | Current workspace only; bounded UTF-8 reads; symlinks rejected by the filesystem adapter |
| Create directory/write file | Explicit approval; writes preserve replaced files as backups |
| Diagnostic command | Existing exact allowlist, no shell |
| Direct program execution | Explicit approval every time; executable name only; shell interpreters and inline interpreter-code flags blocked; bounded output and timeout |
| Environment detection | Read-only PATH inspection; reports OS, Termux, available package managers and developer tools |

Approved direct programs allow users to request package-manager and developer-tool commands such as Termux pkg, apt, npm or pip. They are not a dedicated package-management workflow yet. Programs run without a shell, with stdin disconnected and a reduced environment. A command may still have side effects beyond the workspace; the approval prompt must show the exact program and arguments. Privileged sudo use is restricted to non-interactive mode, and GULZ never collects administrator passwords.

Command exit code zero means the process exited successfully; it does not prove a deployed API, website, database or service is healthy. The agent must perform appropriate follow-up checks before claiming the requested outcome is complete.

Arbitrary shell interpreters, inline interpreter code and direct SSH/SCP commands are blocked. The current command runner is not a hardened sandbox against malicious programs, filesystem races or privilege escalation. Do not run GULZ as root or administrator.

## Local and remote environment separation

The local agent runs as the ordinary user and confines file tools to the current authorized workspace. System-level package managers and service tools may affect broader system state, so every direct program requires explicit approval and an exact command preview.

A future remote agent will be installed on the user's VPS or remote host. The local controller will pair with it and send scoped tool requests. The remote process must independently enforce workspace roots, operation policy, approvals, host identity, audit logs, timeouts and cancellation. SSH credentials and remote pairing tokens must never be included in prompts, tool schemas or tool results.

Remote release requirements:

- Explicit user-initiated pairing with short-lived, one-time pairing credentials.
- Verified host identity and encrypted transport; never silently accept unknown host keys.
- Per-environment, revocable, least-privilege credentials and scopes.
- No public unauthenticated control port.
- Independent remote-side policy and approval for privileged, destructive, package, firewall, service, user and public-network changes.
- Rate limits, bounded output, operation timeouts, cancellation, audit records and recovery.
- Safe bootstrap, update, rollback and removal procedures.

Remote tool execution is implemented as an on-demand SSH process rather than a long-running public daemon. The remote host must have the updated GULZ CLI installed and reachable in its non-interactive SSH PATH. The user must verify the host key before pairing. The remote transport and VPS workflows still require real-host integration tests.

## Provider and secret boundary

Provider credentials are used only by the provider adapter. Remote credentials must remain in a dedicated local secret store and must never be sent to the model. Current provider configuration is stored in a local JSON file protected by owner-only filesystem permissions, not encryption. OS-backed or encrypted secret storage remains required hardening.

## Verification and release status

Source changes are not equivalent to tested capabilities. Provider tool calling, Android Termux build/runtime, Windows compatibility and actual local command workflows must be verified. The initial remote agent protocol and SSH transport exist in source. Dedicated VPS provisioning, website/API hosting workflows, connected services and the workspace UI are not yet implemented.

See [AGENT_ARCHITECTURE.md](AGENT_ARCHITECTURE.md) for the remote trust model and [ROADMAP.md](ROADMAP.md) for remaining work.