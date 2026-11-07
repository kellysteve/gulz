# GULZ development roadmap

This roadmap separates source implementation from tested/released capability. A feature is not complete until builds, platform behavior, security review and user-facing documentation are verified.

## Product direction

GULZ is a provider-independent AI agent with a conversation-first experience. Users describe outcomes naturally. The AI provider supplies reasoning; GULZ supplies the Agent Engine, Tools & Integrations, Environment Manager, execution policy and verification. Goals and task records are internal implementation details.

## Implemented in source — initial local agent foundation

- [x] Add OpenAI-compatible model tool/function calling and structured JSON tool-call fallback for the built-in provider.
- [x] Add a shared bounded agent loop with a registered tool catalogue, cancellation support, context limits and tool-result handoff.
- [x] Connect continuous CLI chat to the local agent engine.
- [x] Add read-only local environment detection for Termux, Linux, macOS, Windows, package managers and developer tools.
- [x] Add local workspace inspection, directory listing and bounded UTF-8 file reading.
- [x] Add approved directory creation and file writes with backup behavior.
- [x] Add an explicitly approved direct-program runner with no shell, bounded output/time and restrictions on shell interpreters and inline interpreter code.
- [x] Require approval for every mutating operation and direct program invocation; deny when no approval callback exists.
- [x] Add agent, provider and environment package tests in source.
- [x] Add the new packages to CLI installation and build scripts.
- [x] Remove goal-management controls from the everyday interactive menu and help output; retain legacy records/commands internally for compatibility.

## Required verification for the current source

- [ ] Run the complete workspace test and typecheck suite on a supported development host.
- [ ] Build and test the latest CLI on Android Termux.
- [ ] Verify tool calling with at least one OpenAI-compatible model that supports function calling.
- [ ] Verify the built-in provider's structured tool-call behavior against the live provider.
- [ ] Verify read-only inspection, approved file writes/backups and denied approvals on a disposable workspace.
- [ ] Verify Termux pkg and Linux package-manager commands with explicit approval, including failure handling.
- [ ] Review command-runner threat model, timeouts, cancellation, output caps and privilege boundaries.

## Remote VPS agent — initial source implementation

- [x] Implement the remote agent stdio protocol and capabilities handshake.
- [x] Add an OpenSSH transport using the system client, strict host-key checking and fixed remote command entry points.
- [x] Require the user to install/update GULZ explicitly on each VPS before pairing.
- [x] Pair named remote environments using the user's SSH config/agent; GULZ does not store private keys or passwords.
- [x] Add remote-side tool registry, explicit approval flag checks, workspace-root validation, audit events and bounded protocol output.
- [x] Add remote environment inspection and per-connection workspace scopes.
- [ ] Test the full pairing and tool lifecycle against real Termux/Linux/VPS hosts.
- [ ] Add remote-specific package-manager adapters and service-management policy.
- [ ] Add VPS diagnostics, package setup, service management and deployment verification.
- [ ] Add secure templates for API hosting, website hosting, databases, reverse proxies, TLS and backups.
- [ ] Add health checks for deployed websites/APIs and never equate process exit code zero with service health.

## Local environment and developer workflows

- [x] Detect available package managers and developer tools without executing them.
- [ ] Add platform-specific package-manager adapters and package-name validation.
- [ ] Add project setup and scaffolding for Node.js, Python and common web stacks.
- [ ] Add dependency installation, build/test, process management and recovery workflows.
- [ ] Add explicit workspace selection and multiple authorized local roots.
- [ ] Add safe configuration editing, backup and rollback for service setup.
- [ ] Add cancellation and resumable execution for long-running jobs.

## Tools and integrations

- [ ] Add GitHub repository/issue/PR workflows with scoped OAuth permissions.
- [ ] Add database and cloud-provider integrations with least-privilege credentials.
- [ ] Add HTTP/API client tools with domain scopes, request limits and secret redaction.
- [ ] Add file transfer and deployment adapters with checksums and rollback.
- [ ] Add a plugin/capability manifest so new tools can be installed and reviewed safely.

## Provider system

- [ ] Add model capability discovery and clear tool-calling compatibility checks.
- [ ] Add streaming responses and tool progress events.
- [ ] Add provider switching without losing conversation history.
- [ ] Add safe fallback when a model lacks function calling.
- [ ] Move API keys to encrypted or OS-backed secret storage.
- [ ] Add user-controlled memory with inspect, edit and delete controls.

## Workspace and interface

- [ ] Build the actual GULZ workspace UI; the current website remains an installation/marketing site.
- [ ] Add responsive conversation layout, sidebar, message composer and attachments.
- [ ] Add environment/connection manager for local devices and paired VPSs.
- [ ] Add live activity, approvals, tool output and verification status.
- [ ] Add provider/model settings, theme controls and accessibility.
- [ ] Share the same Agent Engine and execution policy between CLI and workspace.
- [ ] Add authenticated backend/session sync only after the remote trust model is ready.

## Reliability, security and distribution

- [ ] Add integration tests for provider/tool lifecycles and partial failures.
- [ ] Verify Termux, Linux, macOS and Windows compatibility.
- [ ] Complete threat-model review for command execution, credentials, remote hosts and malicious projects.
- [ ] Add storage migrations, encrypted secrets, backups and recovery.
- [ ] Add signed update metadata, checksums and rollback.
- [ ] Publish packages and signed installers only after reproducible builds and release verification.
- [ ] Build desktop and native Android applications after the shared workspace stabilizes.

## Current limitations

The local agent and an initial paired OpenSSH remote agent are implemented in source, but real-host integration testing remains. GULZ can run approved direct programs on a paired host; dedicated end-to-end workflows for public API/website hosting, TLS, reverse proxies, databases and service monitoring are not yet implemented. Direct commands require user approval and are not a hardened sandbox. The built-in provider's ability to issue tool calls still needs live verification.

Do not advertise full remote hosting automation, native apps or signed installers as available. The initial remote execution foundation is implemented in source but still requires real-host testing.