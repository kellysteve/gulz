# GULZ architecture

## Product experience: hybrid

GULZ has three first-class interfaces backed by one shared core:

1. **Terminal** — direct commands, system information and explicit power-user control.
2. **AI assistant** — natural-language goal capture, planning and guided operations.
3. **Task workspace** — goals, plans, approvals, execution activity, results and resumable work.

These are not separate products or separate execution paths. Each interface reads and updates the same goal/task state through the core domain layer. No interface may bypass execution policy.

## System boundaries

- **CLI:** owns the terminal experience and routes user intent into the shared core.
- **Core:** owns goal/task records, lifecycle transitions, planning contracts and orchestration. It contains no provider-specific or shell side effects.
- **Execution:** typed tools, permission checks, approval gates, timeouts and audit events. It is the only layer allowed to perform machine operations.
- **Provider adapters:** translate between GULZ's internal AI interface and external providers. Provider-specific credentials must never be exposed in client logs.
- **Local storage:** persistent local state. SQLite is the initial direction; encryption and backup policy must be designed before storing sensitive material.
- **Website/API:** Cloudflare Workers. Static website assets are deployed with the Worker; API routes execute in the Worker.
- **Supabase:** release artifact storage and selected backend data. The browser must never receive the service-role key. Public release objects should be immutable and verified by signed metadata.
- **Updater:** verifies signatures and checksums before installing. Failed updates must preserve user data and support recovery.

## Core lifecycle

Goal states:

`draft -> planned -> awaiting_approval -> running -> paused -> running -> completed`

Goals may also fail or be cancelled. Failed goals may be replanned; completed and cancelled goals are terminal. Transitions are validated by the core package and invalid transitions fail closed.

Task states are independently tracked so a goal can resume from unfinished work. Completion is only allowed when every task is completed or explicitly skipped.

## Execution lifecycle

1. Capture the goal from the terminal or AI interface.
2. Clarify missing details and inspect only resources the user authorized.
3. Produce a structured plan with explicit operations and risk classifications.
4. Validate every operation against policy.
5. Request approval for moderate, high, critical, destructive or sensitive operations.
6. Execute through a real adapter with bounded permissions and timeouts.
7. Verify the resulting system state independently.
8. Persist task state, output and audit events so the task workspace can resume work.

AI output is untrusted input. It is never itself authorization to execute a command. Terminal commands and AI-proposed operations use the same execution policy.

## Initial core package

`packages/core` is the shared domain foundation. It currently defines goal/task types, guarded lifecycle transitions, approval-risk classification and approval summaries. It deliberately does not execute commands, call AI providers or persist data. Those responsibilities belong to later packages and must not be simulated in the core.

## Installation strategy

Installation methods are platform-specific. Termux uses Android-compatible builds (Bionic environment), not assumed-compatible generic Linux binaries. Linux, macOS and Windows artifacts must be built and tested for their supported architectures. npm may be offered as a developer route, but must not be represented as equivalent source protection to a signed native artifact.

## Release flow

Build -> test -> generate SBOM -> sign artifacts -> calculate checksums -> upload immutable artifacts to Supabase Storage -> publish signed release manifest -> website and updater consume the manifest.

No installation command or download link should be shown as live until an artifact has been published and tested.

## Delivery sequence

1. Secure release infrastructure and Supabase integration.
2. Local persistence and resumable goal/task orchestration.
3. Permission-aware execution adapters and independent verification.
4. AI provider adapters and supervised planning.
5. SSH and remote environment support.
6. Platform-specific installers, signed updates and rollback.
7. End-to-end security and platform testing before public releases.
