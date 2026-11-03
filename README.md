# GULZ

**Goals. Executed.**

GULZ is an open-source, AI-assisted goal-execution and machine-operations platform for local devices and authorized remote environments.

**A Gaxity product.**

GULZ is licensed under the **Apache License 2.0**. You can use, study, modify and redistribute the software under the terms of that license. The GULZ name and branding are not granted for unrestricted use; see [TRADEMARKS.md](TRADEMARKS.md).

## Project status

GULZ is in early development. An interactive Bash source installer is available for Termux, Linux, macOS and VPS hosts, alongside a PowerShell source-build guide for Windows. These install the developer-preview CLI; they are not stable binary releases. Native installers, desktop and Android apps, npm package releases, AI integrations, SSH orchestration and release downloads are not available until implemented and tested.

## Try the CLI preview

On Termux, Linux, macOS or a Linux VPS, install Node.js 20.19+ (Termux can install Node.js LTS through its package manager), then download and run the interactive installer:

~~~sh
curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh -o gulz-install.sh
sed -n '1,260p' gulz-install.sh
bash gulz-install.sh
~~~

The installer detects the platform, asks where to install the source checkout and requests confirmation before installing only the CLI workspace dependencies, building the CLI and linking the `gulz` command. It deliberately skips the website's Wrangler/Workerd dependency, which does not support Android's Termux environment. Run it as your normal user, not with `sudo`. Windows users should follow the PowerShell instructions in [docs/INSTALLATION.md](docs/INSTALLATION.md). This installs a developer preview, not a stable production release.

## Product experience

GULZ is being built around three connected interfaces backed by one shared core:

- **Terminal:** direct commands and power-user control.
- **AI assistant:** natural-language goals, planning and guided operations.
- **Task workspace:** plans, approvals, activity, results and resumable work.

All interfaces must use the same execution policy. No interface may bypass permission checks.

## Product principles

- Supervised autonomy: low-risk work can proceed; sensitive or destructive actions require explicit approval.
- Real execution and verification: never simulate tool results or claim an operation succeeded without checking.
- Least privilege: operate only on resources the user has authorized.
- Durable work: save goals, plans, task state, logs and recoverable progress.
- Provider flexibility: the core product remains useful when an AI provider is unavailable.
- Platform-aware installation: separate, tested paths for Termux, Linux, macOS, Windows, VPS environments and developers.
- Open development: source code, design discussions and contributions are intended to be public.

## Current implementation status

- **Core:** goal/task types, guarded lifecycle transitions and risk-derived approval decisions.
- **Execution:** bounded filesystem inspection and reading; explicitly approved text writes with backups/restore; a small fixed allowlist of read-only diagnostic commands. The command runner uses no shell, a sanitized environment, bounded output and interactive approval.
- **CLI:** local goal management, diagnostics, file operations and supervised diagnostic commands are implemented in source. Runtime verification is still pending.
- **Distribution:** npm package metadata and platform-specific source-build instructions are prepared. Packages have not been published and native installers are not available.
- **Website:** installation centre and platform roadmap are in the source repository; deployment of the latest changes is still required.
- **Not yet implemented:** interactive AI goal execution, arbitrary shell operations, SSH orchestration, desktop app, native installers, signed release downloads and automatic updates.

## Repository layout

~~~text
apps/
  cli/       GULZ terminal application
  website/   Public website and installation centre
packages/
  core/      Goal and task orchestration
  execution/ Permission-aware local execution engine
  providers/ AI provider adapters (planned)
  storage/   Local persistence and remote storage adapters (planned)
  updater/   Verified update client (planned)
docs/        Product, architecture and platform documentation
supabase/    Database migrations for release infrastructure
~~~

## Platform direction

- **Android:** CLI through Termux in the developer preview; native Android app planned.
- **Linux:** CLI source build now; AppImage, .deb, .rpm and desktop app planned.
- **macOS:** CLI source build now; signed .dmg and Homebrew route planned.
- **Windows:** PowerShell source build now; signed desktop installer and WinGet route planned.
- **VPS:** headless CLI source build; SSH-based remote orchestration planned.
- **Desktop:** one task workspace using the same local execution policy as the CLI. No desktop binary is available yet.

See [docs/INSTALLATION.md](docs/INSTALLATION.md) for the interactive Bash installer, platform-specific setup and exact release status. Public release gates are tracked in [docs/PUBLIC_RELEASE_CHECKLIST.md](docs/PUBLIC_RELEASE_CHECKLIST.md). The desktop product direction and release requirements are in [docs/DESKTOP_APP.md](docs/DESKTOP_APP.md).

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
