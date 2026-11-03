# GULZ

**Goals. Executed.**

GULZ is an open-source, AI-assisted goal-execution and machine-operations platform for local devices and authorized remote environments.

**A Gaxity product.**

GULZ is licensed under the **Apache License 2.0**. You can use, study, modify and redistribute the software under the terms of that license. The GULZ name and branding are not granted for unrestricted use; see the trademark note below.

## Project status

GULZ is in early development. Native installation packages, release downloads, update services, AI integrations and the desktop application are not available until implemented and tested. A source-build developer preview of the CLI is being prepared; it is not a stable end-user installer. Documentation must never describe planned functionality as already working.

## Product experience

GULZ uses a hybrid experience backed by one shared core:

- **Terminal:** direct commands and power-user control.
- **AI assistant:** natural-language goals, planning and guided operations.
- **Task workspace:** plans, approvals, activity, results and resumable work.

All three interfaces share the same goal/task state and execution policy. No interface bypasses permission checks.

## Product principles

- Supervised autonomy: low-risk work can proceed; sensitive or destructive actions require explicit approval.
- Real execution and verification: never simulate tool results or claim an operation succeeded without checking.
- Least privilege: operate only on resources the user has authorized.
- Durable work: save goals, plans, task state, logs, and recoverable progress.
- Provider flexibility: the core product remains useful when an AI provider is unavailable.
- Platform-aware installation: publish separate, tested installation paths for Termux, Linux, macOS, Windows, VPS environments, and developers.
- Open development: source code, design discussions and contributions are intended to be public.

## Current implementation status

- Shared core domain package: initial goal/task types, guarded lifecycle transitions, risk-derived approval decisions and automated domain tests added.
- CLI: local goal management, bounded file inspection/reading, approved text writes with backups/restore, and a small approved diagnostic-command allowlist are implemented in source; runtime verification is still pending.
- Package distribution: core and CLI metadata prepared for public npm publication; packages have not yet been published. The full test suite still needs to be run in a clean environment.
- Public website: deployed; public-facing content is being prepared for launch.
- AI orchestration, arbitrary shell execution, SSH execution, desktop app, native installers and release downloads: not yet implemented or published.

## Repository layout

```text
apps/
  cli/       GULZ terminal application
  website/   Public website and installation centre
packages/
  core/      Goal and task orchestration
  execution/ Permission-aware local execution engine (early implementation)
  providers/ AI provider adapters (planned)
  storage/   Local persistence and remote storage adapters (planned)
  updater/   Verified update client (planned)
docs/        Product and contributor documentation
supabase/    Database migrations for release infrastructure
```

Only modules with implemented functionality should be presented as production-ready.

## Architecture direction

- TypeScript and Node.js LTS for the initial CLI runtime.
- Cloudflare Workers with Workers Static Assets for the public website and API.
- Supabase for release artifact storage and database-backed services.
- Public GitHub repository for source and community development.
- Signed release metadata, checksums, and platform-specific artifacts.

## Security

Never commit API keys, Supabase service-role keys, signing keys, SSH credentials, access tokens, or user data. Secrets belong in deployment secrets or the user's local secure configuration. AI-proposed operations must pass policy validation and approval checks before execution. See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. By submitting a contribution, you agree that it is provided under the Apache License 2.0, subject to any separate written agreement.

## License

Copyright © 2026 GULZ contributors.

Licensed under the [Apache License, Version 2.0](LICENSE).

The license grants broad rights to use, modify and redistribute the software under its conditions. It does **not** grant rights to use GULZ trademarks, logos or branding as though an unofficial fork were the official GULZ project. See [TRADEMARKS.md](TRADEMARKS.md).
