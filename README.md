# GULZ

**Goals. Executed.**

GULZ is an open-source, provider-independent AI coding agent for understanding projects, editing code, running tests and helping users build, configure, host and manage software through natural conversation.

**A Gaxity product.**

GULZ is licensed under the **Apache License 2.0**. The GULZ name and branding remain subject to [TRADEMARKS.md](TRADEMARKS.md).

## Project status

GULZ is in active development. The CLI connects continuous AI chat to a shared agent runtime. Compatible tool-calling models can inspect a local workspace, read files, create directories, write files with backups and run approved programs directly without a shell. The environment detector identifies Termux, operating systems, package managers and developer tools without executing commands or exposing environment secrets. This is an early local-agent foundation, not yet the complete VPS/hosting platform.

A source-level SSH-paired remote agent is now implemented. Full VPS provisioning and hosting workflows, connected services, a web workspace, desktop/mobile apps, published packages, signed installers and release verification remain outstanding; the remote transport and Termux runtime still need integration testing. Source changes are not considered platform-verified until builds and runtime tests pass.

## Install the GULZ CLI

On Termux, Linux, macOS or a Linux VPS, install Node.js 20.19+ and run the interactive source installer. The first-party installer URL becomes available after the GULZ Cloudflare Worker is deployed and the custom domain is connected:

~~~sh
curl -fsSL https://gulz.gaxity.com.ng/install | bash
~~~

The installer can connect an AI provider now or leave setup for later. Use `/provider` inside chat to add and switch among up to 50 saved provider profiles, including hosted GULZ AI, OpenRouter, DeepSeek, OpenAI, Gemini, Groq, Mistral, Together AI, Fireworks, Cerebras, DeepInfra, Perplexity, xAI, NVIDIA NIM, Ollama, LM Studio and custom OpenAI-compatible endpoints. The `/provider models` action attempts live model discovery and falls back to suggestions when a provider does not expose a compatible model list. It installs the CLI workspaces and their build dependencies while skipping the website's Wrangler/Workerd dependency for Termux compatibility. Run it as your normal user, not with sudo. Windows users should follow [docs/INSTALLATION.md](docs/INSTALLATION.md). The first-party route securely serves the installer script from the official repository. This is a source installation, not a signed binary release.

## Start chatting

Run `gulz` or `gulz chat`. Send natural-language requests without restarting the session. Use `/provider` inside chat to open the interactive provider manager, or `/provider add`, `/provider use <id>`, `/provider models`, `/provider test` and `/provider remove` to manage providers without leaving the conversation. Recent conversation history, including sanitized agent tool-call/result context needed for follow-up requests, is saved privately under `~/.gulz/conversation.json` (or `GULZ_HOME`). Tool transcripts are size-bounded and validated when loaded. Use `/clear` to clear history and `/exit` to leave. Once configured, messages are sent directly to the selected provider without repeated consent prompts.

When the selected model supports tool calling, GULZ can use its registered local tools. Read-only workspace inspection can proceed automatically. File changes, directory creation and program execution require explicit approval. Approved programs are launched directly with `shell: false`; shell interpreters and inline interpreter code are blocked. Package managers such as Termux pkg or Linux apt can be invoked as approved programs. Privileged commands must use non-interactive sudo; GULZ never collects administrator passwords.

Tool availability depends on the selected model and provider. If a model cannot produce tool calls, it can still answer conversationally. The built-in provider uses a structured JSON tool-call convention; compatibility must be verified against the live service and model.

## Pair a VPS

Install or update the GULZ CLI on the VPS as the normal SSH user. From the local device, connect once with OpenSSH and verify the server fingerprint yourself:

~~~sh
ssh user@host
gulz update
gulz agent --capabilities
exit
~~~

Then pair it locally (the workspace must already exist):

~~~sh
gulz remote add production user@host /var/www/my-project
gulz remote test production
gulz chat
~~~

Omit the workspace argument to use the remote SSH user's starting directory. You can also use an SSH config alias instead of user@host. GULZ requires strict host-key verification, reuses your SSH config/agent and does not store private keys or passwords. The remote agent is invoked on demand for each tool call. The current remote tool set can inspect the selected workspace, read non-secret files, make approved changes and run approved programs. Full API/website hosting workflows and real-host integration tests are still in development. See [docs/INSTALLATION.md](docs/INSTALLATION.md) for the complete procedure.

## Coding-agent direction

GULZ is being upgraded around a project-first coding-agent workflow inspired by the usability of modern terminal coding agents, while retaining local-first Termux and VPS execution. Local folders remain first-class; GitHub-connected repositories will be an optional cloud workspace, not a requirement to upload source code. Optional GitHub sign-in and account-linked Places pairing are implemented in source on the development branch. See [docs/PLACES_AND_AUTH.md](docs/PLACES_AND_AUTH.md) for Supabase and Cloudflare setup. GitHub repository access remains separate from account sign-in. Isolated cloud workspaces and automated pull-request workflows are not yet implemented.

The hosted GULZ AI proxy is implemented in the website Worker at `gulz.gaxity.com.ng/api/ai/v1`, with request-count quotas for guests and paired Places. The upstream model key remains a Cloudflare Worker secret; the public CLI contains no shared provider key. The service is not live until both Supabase migrations and the Worker secrets are configured. See [docs/PLACES_AND_AUTH.md](docs/PLACES_AND_AUTH.md).

## Product architecture

- **AI Assistant:** natural conversation, context and final explanations.
- **Agent Engine:** bounded model/tool loop, tool registry, cancellation and result handoff.
- **Tools & Integrations:** typed local capabilities, file operations, commands and future service adapters.
- **Environment Manager:** Termux, Linux, macOS, Windows detection and available package-manager/tool discovery.
- **Provider System:** multiple saved provider profiles per Place, interactive `/provider` management, provider switching, model selection and custom OpenAI-compatible endpoints. The current preset catalogue is not a claim that every provider/model combination has passed live integration tests.

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
