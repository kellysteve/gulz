# GULZ architecture

## Product direction

GULZ is an open-source supervised goal-execution and machine-operations platform. Its three intended interfaces share one policy and state model:

1. **Terminal:** direct commands and local machine control.
2. **AI assistant:** natural-language goal capture and structured planning.
3. **Task workspace:** goals, plans, approvals, execution activity, results and resumable work.

No interface may bypass the shared execution policy. AI output is untrusted input, never authorization.

## Package boundaries

- **CLI (`apps/cli`):** terminal UX, local goal storage, provider setup, plan review, approvals, execution orchestration, recovery, update/repair/uninstall.
- **Core (`packages/core`):** goal/task records, typed operation contracts, lifecycle transitions and risk-derived approval requirements. No network or machine side effects.
- **Execution (`packages/execution`):** the only current machine-operation adapter. It validates operations again, enforces authorized-root path rules, symlink protection, approvals, timeouts, output limits and verification.
- **Providers (`packages/providers`):** OpenAI-compatible structured planning adapter. It returns proposals only; local policy validates every path, command, risk and operation before anything is saved or executed.
- **Local state:** currently stored under `~/.gulz` (or `GULZ_HOME`) as validated JSON/JSONL files with owner-only permissions where supported. SQLite, encrypted secret storage and backup/restore policy remain future hardening work.
- **Website/API:** Cloudflare Workers and static assets. The website is not yet the source of truth for local machine execution.
- **Remote adapters:** SSH/VPS and connected-service adapters are not yet implemented.

## Current CLI lifecycle

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

The current provider adapter uses OpenAI-compatible chat-completions APIs. Provider configuration is stored in `~/.gulz/provider.json` with owner-only permissions where supported, or supplied via `GULZ_AI_BASE_URL`, `GULZ_AI_MODEL` and `GULZ_AI_API_KEY`. The key is stored as plaintext protected by filesystem permissions, not encrypted.

Before a planning request, the user confirms that the goal title and description may be sent to the selected provider. Local workspace files and SSH credentials are not uploaded. The provider response is size-bounded and schema-validated. Risk levels are derived locally; the model cannot lower risk or authorize an operation.

## Execution and recovery

1. Capture a goal and optional description.
2. Ask the configured provider for a structured plan after explicit data-sharing confirmation.
3. Validate task/operation count, paths, operation kinds and command allowlists.
4. Save the plan for user review.
5. On explicit execute, run low-risk reads/inspection and request typed approval for moderate/high-risk operations.
6. Verify each result and persist its operation ID as a checkpoint.
7. On restart, skip saved checkpoints; verify a write's expected content or a deterministic delete backup before recovering a checkpoint.
8. Persist task/goal status and local audit events. A process-wide execution lock prevents concurrent runs.

No operation is reported as successful without a verified result. Local execution is not a hardened sandbox against a hostile process racing filesystem changes; do not run GULZ with elevated privileges.

## Distribution and updates

The supported current install route is a source checkout with an interactive installer. CLI installation excludes the website's Wrangler/Workerd dependency to support Android Termux. `gulz update` requires a clean fast-forwardable checkout; `gulz repair` rebuilds/relinks without pulling; `gulz uninstall` removes the source checkout and command link while preserving `~/.gulz`.

Stable signed binaries, checksums, published npm packages, rollback, remote execution and native desktop/mobile installers are release work, not current capabilities.
