# GULZ

**Tell it. Get it done.**

GULZ is an open-source AI assistant and supervised agent designed to help people get work done on local devices and authorized remote environments.

**A Gaxity product.**

GULZ is licensed under the **Apache License 2.0**. You can use, study, modify and redistribute the software under the terms of that license. The GULZ name and branding are not granted for unrestricted use; see [TRADEMARKS.md](TRADEMARKS.md).

## Project status

GULZ is in active development. The CLI currently supports local work/task management, a continuous AI chat mode with locally saved conversation history, OpenAI-compatible AI planning, supervised local execution, recovery and source updates. An interactive Bash source installer is available for Termux, Linux, macOS and VPS hosts, alongside a PowerShell source-build guide for Windows. These install the CLI from source; they are not packaged binary releases. Remote SSH orchestration, connected services, native installers, desktop/Android apps, published npm packages and signed release downloads remain outstanding.

## Install the GULZ CLI

On Termux, Linux, macOS or a Linux VPS, install Node.js 20.19+ (Termux can install Node.js LTS through its package manager), then run the interactive installer:

~~~sh
curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh | bash
~~~

The installer detects the platform, asks where to install the source checkout, requests confirmation, then offers built-in GULZ AI, your own provider, or AI setup later. It tests the selected provider with a generic sample request (no saved goals or workspace files) before finishing. It installs only the CLI workspace dependencies, builds the CLI and links the `gulz` command. It installs only the CLI workspaces and their development dependencies (including TypeScript), deliberately skipping the website's Wrangler/Workerd dependency, which does not support Android's Termux environment. Run it as your normal user, not with `sudo`. Windows users should follow the PowerShell instructions in [docs/INSTALLATION.md](docs/INSTALLATION.md). This installs the GULZ command-line application from its source repository.

## Start chatting with GULZ

After installation and AI provider setup, run `gulz chat` to open a continuous conversation. Send multiple messages without restarting the command; recent conversation history is saved privately under `~/.gulz/conversation.json` (or your configured `GULZ_HOME`). Use `/clear` to clear the saved conversation or `/exit` to return. Chat history is sent to the selected AI provider as context when you send a new message. Provider setup is the one-time choice to connect an AI service. After that, messages go straight to the selected provider; GULZ does not ask for permission again on every chat launch or message. Chat is currently conversational only and does not execute machine operations directly. Use `gulz do \"...\"` for the existing supervised task-planning and execution workflow.

## Product experience

GULZ is being built around three connected interfaces backed by one shared core:

- **Terminal:** direct commands and power-user control.
- **AI assistant:** continuous natural-language conversations, planning and guided operations. Recent chat history is saved locally; chat responses do not themselves execute machine operations.
- **Task workspace:** plans, approvals, activity, results and resumable work.

All interfaces must use the same execution policy. No interface may bypass permission checks.

## Product principles

- Supervised autonomy: low-risk work can proceed; sensitive or destructive actions require explicit approval.
- Real execution and verification: never simulate tool results or claim an operation succeeded without checking.
- Least privilege: operate only on resources the user has authorized.
- Durable work: internal plans, task state, logs and recoverable progress are managed behind the scenes.
- Provider flexibility: the core product remains useful when an AI provider is unavailable.
- Platform-aware installation: separate, tested paths for Termux, Linux, macOS, Windows, VPS environments and developers.
- Open development: source code, design discussions and contributions are intended to be public.

## Current implementation status

- **Core:** internal work/task records, guarded lifecycle transitions and risk-derived approval decisions.
- **Execution:** bounded path inspection, directory listing/creation, UTF-8 reads/writes, high-risk reversible file deletion with private backups/restore, and a fixed allowlist of diagnostics plus approved CLI build/test workflows. The command runner uses no shell, a sanitized environment, bounded output/time and interactive approval.
- **CLI:** local goal/task management, private activity history, provider configuration, continuous AI chat with local conversation persistence, AI-assisted planning, supervised execution, per-operation approval, durable checkpoints, pause/resume/cancel, repair, update and uninstall are implemented in source. Runtime verification is still pending.
- **Distribution:** npm package metadata and platform-specific source-build instructions are prepared. Packages have not been published and native installers are not available.
- **Website:** installation centre and platform roadmap are in the source repository; deployment of the latest changes is still required.
- **Not yet implemented:** remote SSH orchestration, connected-service adapters, arbitrary shell/package installation, desktop app, native installers, signed release downloads and signed automatic updates. Permanent/recursive deletion remains unavailable; the only delete operation moves a small regular file into a recoverable backup.

## Repository layout

~~~text
apps/
  cli/       GULZ terminal application
  website/   Public website and installation centre
packages/
  core/      Goal and task orchestration
  execution/ Permission-aware local execution engine
  providers/  OpenAI-compatible chat and structured planning adapter
  storage/   Local persistence and remote storage adapters (planned)
  updater/   Verified update client (planned)
docs/        Product, architecture and platform documentation
supabase/    Database migrations for release infrastructure
~~~

## Platform direction

- **Android:** CLI through Termux; native Android app planned.
- **Linux:** CLI source build now; AppImage, .deb, .rpm and desktop app planned.
- **macOS:** CLI source build now; signed .dmg and Homebrew route planned.
- **Windows:** PowerShell source build now; signed desktop installer and WinGet route planned.
- **VPS:** headless CLI source build; SSH-based remote orchestration planned.
- **Desktop:** one task workspace using the same local execution policy as the CLI. No desktop binary is available yet.

See [docs/ROADMAP.md](docs/ROADMAP.md) for remaining development and verification work. See [docs/INSTALLATION.md](docs/INSTALLATION.md) for the interactive Bash installer, platform-specific setup and exact release status. Public release gates are tracked in [docs/PUBLIC_RELEASE_CHECKLIST.md](docs/PUBLIC_RELEASE_CHECKLIST.md). The desktop product direction and release requirements are in [docs/DESKTOP_APP.md](docs/DESKTOP_APP.md).

## Architecture direction

- TypeScript and Node.js LTS for the initial CLI runtime.
- Cloudflare Workers with Workers Static Assets for the public website and API.
- Supabase for release artifact storage and database-backed services.
- Public GitHub repository for source and community development.
- Signed release metadata, checksums and platform-specific artifacts before public downloads.

## Security

Never commit API keys, Supabase service-role keys, signing keys, SSH credentials, access tokens or user data. Secrets belong in deployment secrets or the user's local secure configuration. AI-proposed operations must pass policy validation and explicit approval checks before execution. See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. By submitting a contribution, you agree that it is provided under the Apache License 2.0, subject to any separate written agreement.

## License

Copyright © 2026 GULZ contributors.

Licensed under the [Apache License, Version 2.0](LICENSE).

The license grants broad rights to use, modify and redistribute the software under its conditions. It does **not** grant rights to use GULZ trademarks, logos or branding as though an unofficial fork were the official GULZ project. See [TRADEMARKS.md](TRADEMARKS.md).
