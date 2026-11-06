# GULZ development roadmap

This roadmap distinguishes source changes from verified, user-tested capabilities. A feature is not complete for release until its tests, platform behavior, security review and documentation are verified.

## Current milestone — continuous CLI assistant

- [x] Add `gulz chat` as a continuous interactive conversation.
- [x] Keep recent conversation context across turns.
- [x] Persist up to 40 recent messages in the private local GULZ data directory.
- [x] Add `/clear` and `/exit` controls.
- [x] Support built-in GULZ AI and OpenAI-compatible chat-completions providers.
- [x] Make chat the first interactive-menu action.
- [x] Keep conversational responses separate from machine-operation authorization.
- [x] Add provider and CLI help tests.
- [ ] Run provider, CLI and TypeScript tests on a supported development host.
- [ ] Build and test the latest source on Android Termux.
- [ ] Verify real built-in provider conversations, history restoration and clearing.

## Next milestone — one assistant for chat and execution

- [ ] Let the assistant recognize when a message is a question, a follow-up, or a request to perform work.
- [ ] For work requests, generate internal goals and task plans without asking users to manage IDs.
- [ ] Present concise action summaries and ask for approval only where policy requires it.
- [ ] Execute approved operations through the shared local execution engine.
- [ ] Return verified operation results to the same conversation.
- [ ] Support clarifying questions, cancellation, pause and resume from chat.
- [ ] Keep normal conversation free of unnecessary goal/task records.
- [ ] Add multiple named conversations, create/rename/archive/delete controls and per-conversation history.

## Execution capabilities

- [ ] Expand the allowlisted command catalogue with explicit operation contracts and risk levels.
- [ ] Add safe project dependency installation with package-manager detection, previews and approval.
- [ ] Add project scaffolding and common development workflows.
- [ ] Add test/build execution with bounded output, timeout, cancellation and verified results.
- [ ] Improve recovery from partial operations and interrupted processes.
- [ ] Add explicit workspace selection and authorized-root management.
- [ ] Add SSH/VPS adapter, host-key verification, scoped credentials and per-host approvals.
- [ ] Add connected-service adapters only when each integration has clear permissions and audit records.

## Provider and memory improvements

- [ ] Add provider/model discovery where APIs support it.
- [ ] Add model capability metadata and graceful fallback.
- [ ] Add safe provider switching without losing conversations.
- [ ] Add optional user-controlled memory with inspect, edit and delete controls.
- [ ] Move provider secrets to a stronger encrypted or OS-backed secret store.
- [ ] Add request cancellation and streaming where providers support it.

## Workspace and interface

- [ ] Build the actual GULZ workspace UI; the current website is an installation/marketing site, not an execution workspace.
- [ ] Add a responsive conversation layout, sidebar, message composer and attachment flow.
- [ ] Add conversation and project navigation.
- [ ] Add a live activity panel for plans, approvals, operations and verified results.
- [ ] Add provider/model settings, theme controls and accessibility improvements.
- [ ] Connect the workspace to the same core, storage and execution policy as the CLI.
- [ ] Add authenticated backend/session synchronization only after the trust and authorization model is designed.

## Reliability, security and distribution

- [ ] Add integration tests for real task lifecycles and provider failure cases.
- [ ] Add Termux, Linux, macOS and Windows compatibility checks.
- [ ] Add threat-model review for generated commands, filesystem races, credentials and remote hosts.
- [ ] Add robust storage migrations, backups and recovery.
- [ ] Add signed update metadata, checksums and rollback.
- [ ] Publish packages and signed installers only after reproducible builds and release verification.
- [ ] Build desktop and native Android applications after the shared workspace and execution APIs stabilize.

## User verification required now

1. Run `gulz update` in the existing source installation.
2. Keep the current provider settings when asked unless you intentionally want to change them.
3. Run `gulz chat`, approve sending messages to the configured provider, and send at least two related messages.
4. Exit with `/exit`, run `gulz chat` again, and confirm the recent conversation is restored.
5. Try `/clear` and confirm it removes the saved conversation.
6. Share any errors and the output of `gulz doctor`.

Do not treat the new chat mode as machine execution: it currently answers conversationally. Use `gulz do "..." ` for the existing supervised task-planning and execution path until chat-to-execution integration is completed.
