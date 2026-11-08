# GULZ agent architecture

## Product model

GULZ is a provider-independent AI agent. The selected model supplies reasoning; GULZ owns resource access, tool execution, authorization, persistence and verification. A model never receives direct machine credentials and never authorizes its own proposed actions.
The user experience is conversation-first. Internal plans, operation records and checkpoints are implementation details, not required concepts for everyday users.

## Coding-agent workspace model

GULZ supports three distinct workspace types:

- **Local workspace:** the current CLI operates on an explicitly selected local directory. Source files remain on the user's device.
- **Remote VPS workspace:** the current initial SSH transport operates on an explicitly paired host and selected directory.
- **GitHub-backed local workspace:** clone or open a repository on the user's machine, then launch GULZ from that project directory. The agent edits the local checkout; Git and the user's existing GitHub authentication handle branches, commits, pushes and pull requests. Signing in to the optional hosted GULZ AI service is a separate account-authentication flow and does not grant repository access or upload project contents.\n- **Optional cloud workspace:** a future feature may allow a user to explicitly authorize a repository for an isolated hosted run. It is not the default coding-agent workflow.

A cloud workspace must be isolated per user/job, resource-limited, network-restricted by default, ephemeral, and destroyed after retention expires. Repository content is untrusted input: instructions found in project files must never override the platform's safety policy or reveal credentials.

## Runtime components

1. **AI Assistant** — conversation history, user intent and final explanations.
2. **Agent Engine** — bounded tool-calling loop, tool registry, cancellation and result handoff.
3. **Tools & Integrations** — typed capabilities with schemas, input validation and audit events.
4. **Environment Manager** — local device workspaces and separately authorized remote environments.
5. **Provider System** — user-selected model endpoint and credentials; supports OpenAI-compatible chat-completions and the built-in GULZ AI adapter.

The CLI persists bounded assistant tool-call and sanitized tool-result messages alongside ordinary conversation turns. History trimming starts at a user-message boundary so providers are not sent orphaned tool results. Saved tool transcripts are context only; they never grant permission to repeat an operation.

## Request lifecycle

1. The user sends a message to the configured provider with bounded conversation context and available tool schemas.
2. The model responds normally or proposes one or more tool calls.
3. GULZ validates tool names and bounded JSON arguments against the registered catalogue.
4. The tool implementation validates inputs again and derives risk locally.
5. Low-risk reads may run within the authorized environment. Mutating, privileged, public-network and destructive operations require explicit approval; no approval means deny.
6. The execution adapter performs the operation within its capability boundary and returns structured results.
7. Results are sent back to the model. The model explains the outcome; GULZ records audit data and reports only verified results.

Provider tool calls are proposals, not trusted instructions. The engine limits each run to at most 12 model rounds, at most 8 tool calls in one provider response and at most 8 total tool actions per user turn, bounded message sizes and AbortSignal cancellation.

## Current implementation

- packages/providers adds OpenAI-compatible function/tool calling and a JSON tool-call fallback for the built-in provider. Actual tool calling depends on the selected model's capabilities; a model that does not follow the built-in JSON protocol may answer conversationally without invoking tools.
- packages/agent contains the shared bounded orchestration loop and the initial local tool catalogue.
- packages/execution remains the enforcement boundary for local operations. The current catalogue offers workspace inspection, directory listing, bounded UTF-8 file reads, approved directory creation, approved file writes with backups, and approved commands from the fixed diagnostic allowlist.
- apps/cli connects continuous chat to the local agent engine. It asks for approval only when a proposed tool is mutating or otherwise classified as requiring approval. Provider configuration remains a one-time user choice.

The current local catalogue can run approved direct programs without a shell, so it can invoke detected package managers and system tools when the user approves the exact program and arguments. It has no dedicated package-manager, HTTP, firewall, service-management or hosting adapters yet. A paired OpenSSH remote agent can expose the same bounded tools on a selected VPS workspace, but this source implementation still needs real-host integration tests. GULZ is not a hardened sandbox.

## Local and remote environment separation

The local agent runs as the ordinary user and is confined to an explicitly selected workspace root. It should not be run with administrator/root privileges.

The remote agent is installed on the user's VPS or other remote host as the GULZ CLI. The local controller pairs with it using the system OpenSSH client and sends scoped tool requests over an on-demand stdio session. The remote CLI must be available in the non-interactive SSH PATH. The remote agent revalidates the registered tool, configured workspace root and controller-provided approval flag, and records its own audit event. This is a second policy check, not an independent authentication of the human approval. The AI provider must never receive SSH private keys, passwords, host tokens or unrestricted server access.

Remote connection requirements before release:

- A stronger pairing handshake with short-lived, revocable pairing credentials; current source pairing relies on the user's SSH authentication and known_hosts database.
- Verified server identity and encrypted transport; no silent host-key acceptance.
- Per-environment, revocable, least-privilege credentials.
- No public unauthenticated control port.
- Per-host capability and path scopes, rate limits, operation timeouts and output limits.
- Independent remote-side verification of human approval for privileged, destructive, package, firewall, service, user and public-network changes; the current implementation only checks the approval flag sent over authenticated SSH.
- Auditable command and file operations with cancellation and recovery.
- Safe bootstrap, update, rollback and removal procedures.

The current OpenSSH transport and remote stdio protocol are implemented in source. They are not a long-running public daemon: each tool call opens a fresh SSH process. Host-key verification, workspace scoping and a second remote-side approval check are implemented; full remote provisioning workflows and real VPS integration tests remain outstanding.

## Hosted AI gateway boundary

A future GULZ-hosted model service is a separate server-side product, planned for `ai.gaxity.com.ng`. It must not be implemented as a shared API key embedded in the open-source CLI. The gateway will authenticate users/devices, issue revocable short-lived tokens, enforce quotas and model access policy, and keep upstream provider credentials in server-side secret storage. Public client IDs and endpoint URLs are identifiers, not secrets. The client must remain usable with a user-supplied provider key or local model if the hosted service is unavailable.

## Provider and secret boundary

Provider keys are used only by the provider adapter. SSH credentials and future remote pairing tokens belong in a dedicated local secret store and are never included in prompts, tool schemas or tool results. Current provider configuration is still a local JSON file protected by owner-only filesystem permissions; encryption or OS-backed secret storage remains a hardening requirement.

## Security limitations

The current file execution layer applies path containment, symlink checks, bounded UTF-8 I/O, backups for replacements/deletes, command allowlists and output/time limits. It is not a hardened sandbox against a hostile process racing filesystem changes. Do not run GULZ with elevated privileges or point it at directories containing data the user has not authorized.

## Accounts and Places

The optional website account uses Supabase Auth with GitHub as the identity provider. Account sign-in is not repository authorization. A user creates a short-lived one-time pairing code on the website; a CLI installation exchanges it for a unique per-Place credential. The Worker stores only a hash of that credential and uses it to accept heartbeats and update non-secret metadata. Users can revoke a Place from the dashboard. Provider API keys and project files remain local to each Place.

The website/Worker implementation requires the Places SQL migration, Supabase GitHub provider configuration, public website Supabase URL/anon build variables, and server-only Worker secrets. Until these are configured and end-to-end tested, the dashboard must not be described as live production functionality. Place heartbeat is currently foreground-only rather than a background service.
