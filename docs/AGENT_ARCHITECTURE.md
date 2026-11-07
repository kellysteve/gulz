# GULZ agent architecture

## Product model

GULZ is a provider-independent AI agent. The selected model supplies reasoning; GULZ owns resource access, tool execution, authorization, persistence and verification. A model never receives direct machine credentials and never authorizes its own proposed actions.
The user experience is conversation-first. Internal plans, operation records and checkpoints are implementation details, not required concepts for everyday users.

## Runtime components

1. **AI Assistant** — conversation history, user intent and final explanations.
2. **Agent Engine** — bounded tool-calling loop, tool registry, cancellation and result handoff.
3. **Tools & Integrations** — typed capabilities with schemas, input validation and audit events.
4. **Environment Manager** — local device workspaces and separately authorized remote environments.
5. **Provider System** — user-selected model endpoint and credentials; supports OpenAI-compatible chat-completions and the built-in GULZ AI adapter.

## Request lifecycle

1. The user sends a message to the configured provider with bounded conversation context and available tool schemas.
2. The model responds normally or proposes one or more tool calls.
3. GULZ validates tool names and bounded JSON arguments against the registered catalogue.
4. The tool implementation validates inputs again and derives risk locally.
5. Low-risk reads may run within the authorized environment. Mutating, privileged, public-network and destructive operations require explicit approval; no approval means deny.
6. The execution adapter performs the operation within its capability boundary and returns structured results.
7. Results are sent back to the model. The model explains the outcome; GULZ records audit data and reports only verified results.

Provider tool calls are proposals, not trusted instructions. The engine limits each run to at most 12 model rounds, at most 8 tool calls per response, bounded message sizes and AbortSignal cancellation.

## Current implementation

- packages/providers adds OpenAI-compatible function/tool calling and a JSON tool-call fallback for the built-in provider. Actual tool calling depends on the selected model's capabilities; a model that does not follow the built-in JSON protocol may answer conversationally without invoking tools.
- packages/agent contains the shared bounded orchestration loop and the initial local tool catalogue.
- packages/execution remains the enforcement boundary for local operations. The current catalogue offers workspace inspection, directory listing, bounded UTF-8 file reads, approved directory creation, approved file writes with backups, and approved commands from the fixed diagnostic allowlist.
- apps/cli connects continuous chat to the local agent engine. It asks for approval only when a proposed tool is mutating or otherwise classified as requiring approval. Provider configuration remains a one-time user choice.

The current local catalogue does not install packages, run arbitrary shell commands, access the general network, configure system services, create public hosting, or connect to remote VPSs. These require additional narrowly scoped adapters and security review.

## Local and remote environment separation

The local agent runs as the ordinary user and is confined to an explicitly selected workspace root. It should not be run with administrator/root privileges.

A future remote agent will be installed and started on the user's VPS or other remote host. The local GULZ controller will pair with that agent and send scoped tool requests. The remote agent must independently enforce its own operation policy, workspace roots, approvals, host identity, audit log, timeouts and cancellation. The AI provider must never receive SSH private keys, passwords, host tokens or unrestricted server access.

Remote connection requirements before release:

- Explicit pairing initiated by the user, with a short-lived one-time pairing secret.
- Verified server identity and encrypted transport; no silent host-key acceptance.
- Per-environment, revocable, least-privilege credentials.
- No public unauthenticated control port.
- Per-host capability and path scopes, rate limits, operation timeouts and output limits.
- Independent remote-side approval enforcement for privileged, destructive, package, firewall, service, user and public-network changes.
- Auditable command and file operations with cancellation and recovery.
- Safe bootstrap, update, rollback and removal procedures.

The current RemoteAgentTransport is an interface boundary only; it is not an SSH implementation or a running remote daemon.

## Provider and secret boundary

Provider keys are used only by the provider adapter. SSH credentials and future remote pairing tokens belong in a dedicated local secret store and are never included in prompts, tool schemas or tool results. Current provider configuration is still a local JSON file protected by owner-only filesystem permissions; encryption or OS-backed secret storage remains a hardening requirement.

## Security limitations

The current file execution layer applies path containment, symlink checks, bounded UTF-8 I/O, backups for replacements/deletes, command allowlists and output/time limits. It is not a hardened sandbox against a hostile process racing filesystem changes. Do not run GULZ with elevated privileges or point it at directories containing data the user has not authorized.