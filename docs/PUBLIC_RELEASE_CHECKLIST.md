# GULZ public release checklist

This checklist is the release gate. A public repository and a working source installer do not mean GULZ is production-ready.

## CLI release readiness

- [ ] Generate and commit a root npm lockfile, then verify `npm ci` from a clean clone on supported Node.js LTS. The repository currently has no committed lockfile.
- [ ] Run `npm run test:cli` and record the exact Node.js, npm and OS versions.
- [ ] Run provider adapter tests against mocked endpoints and manually validate at least one supported hosted or local provider.
- [ ] Exercise plan review, per-operation approval, Ctrl+C pause, resume, cancel, stale execution-lock recovery and duplicate-write checkpoint recovery.
- [ ] Run the Bash installer end-to-end on Termux, Ubuntu/Debian, macOS and a clean VPS.
- [ ] Verify cancellation at every confirmation prompt leaves the system unchanged.
- [ ] Verify an existing GULZ checkout updates only with a fast-forward pull.
- [ ] Verify a failed dependency install/build leaves the user's `~/.gulz` data untouched.
- [ ] Verify the CLI command is available in a fresh terminal after install and update.
- [ ] Verify `gulz update` from a clean source checkout and document recovery from a dirty checkout.
- [ ] Verify `gulz repair` restores a broken dependency/build/link without changing local data.
- [ ] Verify `gulz uninstall` removes only the source checkout and global link while preserving `~/.gulz`.
- [ ] Verify ANSI color output, `NO_COLOR`, and redirected/non-TTY output on each supported terminal.
- [ ] Check shell script syntax with `bash -n scripts/install.sh`.
- [ ] Check website installation instructions against the tested installer.
- [ ] Deploy the website to Cloudflare and verify all platform tabs and links.
- [ ] Publish a dated changelog and known-limitations list.

## Before publishing npm packages

Publish in dependency order: `@gulz/core`, `@gulz/execution`, then `@gulz/cli`.

- [ ] Confirm package names and npm ownership/2FA.
- [ ] Confirm each package has the correct public files, exports, license and repository metadata.
- [ ] Test installation from the public npm registry in a clean temporary project.
- [ ] Verify the CLI package resolves its published dependencies without workspace links.
- [ ] Add a tested `npm install -g @gulz/cli` route and a safe package-based updater.
- [ ] Never publish credentials, private configuration, test fixtures containing personal data or build artifacts outside the package allowlist.

## Before native platform downloads

- [ ] Build each artifact on its target platform or a documented reproducible builder.
- [ ] Test installation, upgrade, uninstall and rollback on clean supported systems.
- [ ] Generate SHA-256 checksums and signed release metadata.
- [ ] Sign Windows installers; sign and notarize macOS applications.
- [ ] Verify Linux package signatures and dependency declarations.
- [ ] Test Android APK permissions, signing, upgrades and data migration.
- [ ] Publish artifacts only after their checksums and signatures can be independently verified.

## Before production machine operations

- [ ] Complete threat modelling and independent security review.
- [ ] Test approval bypass resistance across CLI, AI and workspace interfaces.
- [ ] Test path traversal, symlinks, race conditions, process isolation and credential leakage.
- [ ] Complete crash-recovery testing for every operation boundary and independently review audit-log tamper resistance.
- [ ] Test least-privilege SSH credentials and host-key verification before remote execution.
- [ ] Verify every claimed result against the real target system.
- [ ] Document supported operations, risk levels, data handling and incident response.

## Current honest status

The CLI includes local goal/task management, an OpenAI-compatible AI planning adapter, supervised execution of a narrow local operation allowlist, per-operation approval, durable operation checkpoints, pause/resume/cancel and local audit history. Arbitrary shell execution, destructive operations, remote SSH orchestration, native desktop/mobile packages and published npm packages are not available. Automated checks have not yet been run in a clean environment, and the installer still requires real Termux/Linux/macOS/VPS validation. Do not claim production readiness until these gates pass.
