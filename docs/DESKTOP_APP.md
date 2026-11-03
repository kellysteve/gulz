# GULZ desktop application direction

## Status

The desktop application is planned and has not been implemented or released. There are no desktop installers or download links yet. The current runnable product surface is the Node.js CLI developer preview.

## Product goal

The desktop app should make GULZ's task workspace usable without requiring users to live in a terminal. It should provide:

- A natural-language goal composer and structured plan view.
- A workspace/project selector with explicit local-folder access.
- Task progress, current activity and execution history.
- A review screen that explains each operation, target, risk and expected effect.
- Clear approval, deny, pause and cancel controls.
- Results with verification evidence, logs and recovery/restore actions.
- Settings for local storage, provider configuration and privacy.

It must not become a second execution engine. The desktop UI and CLI must call the same core validation and execution policy.

## Security and process boundary

- The application may access only folders the user explicitly selects or authorizes.
- AI-generated plans are untrusted input and never count as approval.
- The UI must show the exact operation and target before requesting approval.
- High-impact, destructive, credential-related and remote operations require separate, explicit confirmation.
- The app must not expose an unauthenticated local HTTP control port.
- Prefer private process IPC over a listening network service.
- Do not pass arbitrary text from the UI directly to a shell.
- Keep provider secrets in the operating system's secure credential store where available; never put them in logs or frontend storage.
- Pause and cancellation must reach the running operation and leave a recoverable task state.
- The app must display verified outcomes only; a timeout or interrupted operation is not a success.

## Desktop technology evaluation

A lightweight native shell such as Tauri 2 is a candidate for a prototype. Before committing to it, test how the TypeScript core and execution package will be packaged on Windows, macOS and Linux. The design must account for the Node.js runtime dependency, native sidecar signing, update delivery and filesystem permissions. Electron remains an alternative if sidecar portability or native integrations make the Tauri route unreliable.

Do not select a framework solely for installer size. The decisive requirements are reliable local execution, secure IPC, cross-platform packaging, accessibility and maintainability.

## Planned distribution targets

| Platform | Planned artifact | Notes |
| --- | --- | --- |
| Windows 10/11 | Signed .msi or .exe | Verified update path; x64 first, ARM64 only after testing. |
| macOS | Signed and notarized .dmg | Apple Silicon and Intel builds, tested separately. |
| Linux | AppImage, .deb and .rpm | Publish only for tested distributions and architectures. |
| Android | Native app is a separate roadmap item | Termux CLI remains the developer-preview route; desktop bundles do not apply. |
| VPS | Headless CLI, not a desktop installer | Remote SSH orchestration is a separate execution adapter. |

## Release requirements

Every platform artifact must have:

1. Reproducible build instructions and a recorded toolchain.
2. Unit, integration and platform smoke tests.
3. A software bill of materials.
4. A cryptographic signature and published checksum.
5. A signed release manifest and immutable artifact storage.
6. An update and rollback path that preserves user data.
7. Clear supported OS versions, CPU architectures and known limitations.

The website must label every item as Planned until its signed artifact is published and tested. Never show a fake download button or a command that installs a package that does not exist.
