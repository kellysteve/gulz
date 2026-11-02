# GULZ architecture

## System boundaries

- **CLI:** runs on the user's device and owns the interactive terminal experience.
- **Core:** goal lifecycle, plans, task state, resumability and orchestration.
- **Execution:** typed tools, permission checks, approval gates, timeouts and audit events.
- **Provider adapters:** translate between GULZ's internal AI interface and external providers. Provider-specific credentials must never be exposed in client logs.
- **Local storage:** persistent local state. SQLite is the initial direction; encryption and backup policy must be designed before storing sensitive material.
- **Website/API:** Cloudflare Workers. Static website assets are deployed with the Worker; API routes execute in the Worker.
- **Supabase:** release artifact storage and selected backend data. The browser must never receive the service-role key. Public release objects should be immutable and verified by signed metadata.
- **Updater:** verifies signatures and checksums before installing. Failed updates must preserve user data and support recovery.

## Execution lifecycle

1. Parse and clarify the user's goal.
2. Inspect only resources the user authorized.
3. Produce a plan with explicit operations and risk classifications.
4. Validate every proposed operation against policy.
5. Request approval for sensitive, destructive or high-impact actions.
6. Execute through a real adapter with bounded permissions and timeouts.
7. Verify the resulting system state independently.
8. Persist task state, output and audit events.

AI output is untrusted input. It is never itself authorization to execute a command.

## Installation strategy

Installation methods are platform-specific. Termux uses Android-compatible builds (Bionic environment), not assumed-compatible generic Linux binaries. Linux, macOS and Windows artifacts must be built and tested for their supported architectures. npm may be offered as a developer route, but must not be represented as equivalent source protection to a signed native artifact.

## Release flow

Build -> test -> generate SBOM -> sign artifacts -> calculate checksums -> upload immutable artifacts to Supabase Storage -> publish signed release manifest -> website and updater consume the manifest.

No installation command or download link should be shown as live until an artifact has been published and tested.
