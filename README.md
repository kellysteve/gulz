# GULZ

**Tell it. Get it done.**

GULZ is an open-source, provider-independent AI agent for helping people build, install, configure, host and manage technology through natural conversation.

**A Gaxity product.**

GULZ is licensed under the **Apache License 2.0**. The GULZ name and branding remain subject to [TRADEMARKS.md](TRADEMARKS.md).

## Project status

GULZ is in active development. The CLI connects continuous AI chat to a shared agent runtime. Compatible tool-calling models can inspect a local workspace, read files, create directories, write files with backups and run approved programs directly without a shell. The environment detector identifies Termux, operating systems, package managers and developer tools without executing commands or exposing environment secrets. This is an early local-agent foundation, not yet the complete VPS/hosting platform.

A source-level SSH-paired remote agent is now implemented. Full VPS provisioning and hosting workflows, connected services, a web workspace, desktop/mobile apps, published packages, signed installers and release verification remain outstanding; the remote transport and Termux runtime still need integration testing. Source changes are not considered platform-verified until builds and runtime tests pass.

## Install the GULZ CLI

On Termux, Linux, macOS or a Linux VPS, install Node.js 20.19+ and run the interactive source installer:

~~~sh
curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh | bash
~~~

The installer offers built-in GULZ AI, your own OpenAI-compatible provider, or provider setup later. It installs the CLI workspaces and their build dependencies while skipping the website's Wrangler/Workerd dependency for Termux compatibility. Run it as your normal user, not with sudo. Windows users should follow [docs/INSTALLATION.md](docs/INSTALLATION.md). This is a source installation, not a signed binary release.

## Start chatting

Run `gulz chat`. Send natural-language requests without restarting the session. Recent conversation history is saved privately under `~/.gulz/conversation.json` (or `GULZ_HOME`). Use `/clear` to clear it and `/exit` to leave. Once configured, messages are sent directly to the selected provider without repeated consent prompts.

When the selected model supports tool calling, GULZ can use its registered local tools. Read-only workspace inspection can proceed automatically. File changes, directory creation and program execution require explicit approval. Approved programs are launched directly with `shell: false`; shell interpreters and inline interpreter code are blocked. Package managers such as Termux pkg or Linux apt can be invoked as approved programs. Privileged commands must use non-interactive sudo; GULZ never collects administrator passwords.

Tool availability depends on the selected model and provider. If a model cannot produce tool calls, it can still answer conversationally. The built-in provider uses a structured JSON tool-call convention; compatibility must be verified against the live service and model.

## Product architecture

- **AI Assistant:** natural conversation, context and final explanations.
- **Agent Engine:** bounded model/tool loop, tool registry, cancellation and result handoff.
- **Tools & Integrations:** typed local capabilities, file operations, commands and future service adapters.
- **Environment Manager:** Termux, Linux, macOS, Windows detection and available package-manager/tool discovery.
- **Provider System:** user-selected AI provider and model; GULZ is not tied to one model vendor.

The selected model provides reasoning. GULZ owns environment access, credentials, approvals, execution and verification. The model never receives SSH credentials and cannot authorize its own tool calls.

## Current implementation

- **Providers:** OpenAI-compatible chat-completions and function/tool calling, with a structured JSON fallback for the built-in provider.
- **Agent:** bounded tool orchestration, maximum round/tool-call limits, cancellation support, local tool registry and namespaced remote tools.
- **Environments:** read-only detection of Termux, OS, architecture, package managers and developer tools.
- **Execution:** path-scoped inspection, listing and bounded UTF-8 reads; approved directory creation and file writes with backups; fixed diagnostic command runner; and a separate approved direct-program runner with no shell, bounded output/time and interpreter-inline-code restrictions.
- **Remote:** an on-demand stdio agent protocol and OpenSSH transport with strict host-key checking, SSH-agent/config reuse, named remote connections and explicit remote workspace roots. No SSH keys or passwords are stored by GULZ.

Command completion is not proof that a website, API or service is healthy. GULZ must perform an appropriate follow-up check before reporting deployment or hosting as successful.

## Not yet implemented

- Dedicated, tested workflows for VPS provisioning, API hosting, website hosting, databases, reverse proxies, TLS and backups.
- Dedicated package-manager adapters and richer environment-specific recovery.
- Connected GitHub/cloud/database integrations.
- Multi-conversation workspace UI, authenticated sync, desktop and native Android apps.
- Encrypted/OS-backed provider and remote credential storage, signed updates and release artifacts.

See [docs/AGENT_ARCHITECTURE.md](docs/AGENT_ARCHITECTURE.md) for the local/remote trust model, [docs/ROADMAP.md](docs/ROADMAP.md) for development status, and [docs/INSTALLATION.md](docs/INSTALLATION.md) for supported source-install routes.

## Repository layout

~~~text
apps/
  cli/          Terminal assistant
  website/      Public website and installation centre
packages/
  core/         Shared domain and approval policy
  execution/    Local file and approved program execution
  providers/    Provider adapters and model tool calling
  environments/OS, Termux and package-manager detection
  agent/        Shared tool-calling agent engine
  remote/       Strict-host-key OpenSSH transport and remote agent protocol
docs/           Product, architecture and platform documentation
supabase/       Release infrastructure migrations
~~~

## Security

Run GULZ without administrator privileges. Never commit API keys, signing keys, SSH credentials, access tokens or user data. Provider keys remain local and must not be included in model prompts or tool results. Mutating commands require the user's approval. Remote operations require a separately paired VPS agent with independent workspace and approval checks. See [SECURITY.md](SECURITY.md).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [TRADEMARKS.md](TRADEMARKS.md).
