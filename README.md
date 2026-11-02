# GULZ

**Goals. Executed.**

GULZ is a proprietary, AI-assisted goal-execution and machine-operations platform for local devices and authorized remote environments.

**A Gaxity product.**

## Project status

GULZ is in early development. Installation commands, release downloads, update services, AI integrations, and operational capabilities are not available until implemented and tested. Documentation must never describe planned functionality as already working.

## Product principles

- Supervised autonomy: low-risk work can proceed; sensitive or destructive actions require explicit approval.
- Real execution and verification: never simulate tool results or claim an operation succeeded without checking.
- Least privilege: operate only on resources the user has authorized.
- Durable work: save goals, plans, task state, logs, and recoverable progress.
- Provider flexibility: the core product remains useful when an AI provider is unavailable.
- Platform-aware installation: publish separate, tested installation paths for Termux, Linux, macOS, Windows, VPS environments, and developers.
- Proprietary software: source code and internal implementation are not open source.

## Planned repository layout

```text
apps/
  cli/       GULZ terminal application
  website/   Public website and installation centre
packages/
  core/      Goal and task orchestration
  execution/ Permission-aware execution engine
  providers/ AI provider adapters
  storage/   Local persistence and remote storage adapters
  updater/   Verified update client
docs/        Product and contributor documentation
```

Only modules with implemented functionality should be presented as production-ready.

## Architecture direction

- TypeScript and Node.js LTS for the initial CLI runtime.
- Cloudflare Workers with Workers Static Assets for the public website and API.
- Supabase for release artifact storage and database-backed services.
- Private GitHub repository for source and development.
- Signed release metadata, checksums, and platform-specific artifacts.

## Security

Never commit API keys, Supabase service-role keys, signing keys, SSH credentials, access tokens, or user data. Secrets belong in deployment secrets or the user's local secure configuration. AI-proposed operations must pass policy validation and approval checks before execution.

## License

Proprietary. All rights reserved. No permission is granted to copy, modify, redistribute, sublicense, or sell this software without written authorization.
