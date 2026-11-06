# GULZ CLI

**GULZ — Goals. Executed.**  
A local command-line workspace for goals, tasks, supervised file operations and activity history.

## Install

Use the interactive installer on Termux, Linux, macOS or a Linux VPS:

~~~sh
curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh | bash
~~~

It installs only the CLI workspaces and their build dependencies, avoiding the website's Wrangler/Workerd dependency on Termux. During installation, choose built-in GULZ AI, your own provider, or configure AI later. The installer tests the connection after setup; the test sends only a generic sample request and never sends your saved goals or workspace files. Repeat installs and updates reuse the existing dependency installation when the CLI package manifests have not changed, so they skip the slow npm dependency-resolution step. Run it as your normal user. Windows users should follow the PowerShell source-build instructions in [the installation guide](../../docs/INSTALLATION.md).

Requires Node.js 20.19+ and Git. The npm packages are not published yet; this source installation is the supported installation route.

## First commands

~~~sh
gulz
gulz --help
gulz doctor
gulz init
gulz do "Inspect my project and help me fix the failing tests"
gulz goals
gulz audit
gulz provider status
gulz provider test
gulz plan <goal-id>
gulz execute <goal-id>
gulz resume <goal-id>
gulz cancel <goal-id>
~~~

Run `gulz repair` to reinstall dependencies, rebuild and relink without changing local data. Run `gulz update` from an interactive terminal; confirm with a simple `y` or `n`. After updating, GULZ offers to configure or change your AI provider and model. You can skip this and change it later. Run `gulz uninstall` to remove the global command link and source checkout; it preserves your local goals, provider settings and audit history in `~/.gulz`. Your local data in `~/.gulz` is separate from the source installation.

## Goal and task management

~~~sh
gulz goal create "Prepare a release"
gulz goals
gulz goal show <goal-id>
gulz goal show <goal-id> --json
gulz goal edit <goal-id>
gulz goal task add <goal-id> "Review the release checklist"
gulz goal task edit <goal-id> <task-id>
gulz goal task delete <goal-id> <task-id>
gulz goal task status <goal-id> <task-id> running
gulz goal task status <goal-id> <task-id> completed
gulz goal delete <goal-id>
~~~

Goal and manual checklist task editing is interactive. Destructive actions use a clear yes/no confirmation with No as the default. Goal and task lifecycle transitions are checked by the shared core; invalid transitions are rejected. Task status changes are user-managed checklist state only for tasks without executable operations. Tasks in an AI-generated plan cannot be manually marked completed; GULZ controls those statuses through verified execution.

## AI provider and planning

Choose the built-in AI during installation, or configure your own OpenAI-compatible chat-completions endpoint at any time:

~~~sh
gulz provider builtin
gulz provider configure
gulz provider status
gulz provider test
gulz plan <goal-id>
~~~

The installer asks whether to use built-in GULZ AI, enter your own provider settings, or do this later. The built-in setup requires no provider URL or API key from you; the installer does not display its connection details. Choosing your own provider asks for its HTTPS base URL, model name and API key (the key is entered without echo). After either setup, the installer runs a connection test using a generic sample request. The test validates a structured plan, discards it, and does not execute anything or transmit saved goals/workspace files. You can rerun it with `gulz provider test`.

The built-in option configures GULZ AI automatically. The installer does not display provider connection details. To use your own provider, its API key is entered without echo and stored in `~/.gulz/provider.json` with owner-only permissions where supported. It is stored as plaintext protected by filesystem permissions, not encrypted. Alternatively set `GULZ_AI_BASE_URL`, `GULZ_AI_MODEL` and `GULZ_AI_API_KEY` in the process environment. Remote providers must use HTTPS; HTTP is accepted only for localhost model servers. Before a plan request, GULZ asks for confirmation and sends only the goal title and description; it does not upload workspace files. The provider adapter accepts only bounded JSON plans containing inspect, directory listing/creation, read, write, reversible file deletion and a fixed command allowlist. Every operation is revalidated locally and risk is derived by GULZ, not trusted from the model.

For the simplest workflow, use `gulz do "describe what you need done"`. GULZ sends your request to the selected AI provider, creates an internal goal and task plan automatically, shows you what it intends to do, and asks whether to start. You do not need to create a goal or look up an ID first. You can still inspect or manage saved plans manually when you want. AI planning can also be used with `gulz plan <goal-id>`. A saved plan can be started with `gulz execute <goal-id>`. Moderate-, high- and critical-risk operations show what will happen and use a simple `y`/`n` approval. High-risk file deletion creates a private recoverable backup. Low-risk inspection, directory listing and reads run only after you explicitly start execution. Press Ctrl+C to pause safely; `gulz resume <goal-id>` continues from saved operation checkpoints. Use `gulz cancel <goal-id>` to cancel a goal after confirmation. A local execution lock prevents simultaneous GULZ runs, and a write whose expected content already exists is checkpointed rather than written a second time after recovery.

## Activity history

~~~sh
gulz audit
gulz audit --limit 10
~~~

Goal and task changes are recorded in a local JSONL audit file under `~/.gulz`. The audit file is restricted to the current user's permissions where supported. It stores action metadata, not file contents or credentials.

## Supervised local operations

~~~sh
gulz inspect .
gulz list .
gulz mkdir "src/assets"
gulz read README.md
gulz delete old-notes.txt
gulz write notes.txt
gulz restore <backup-path> <target-path>
gulz run node --version
gulz run git status --short
~~~

Filesystem operations are confined to the current working directory. Absolute paths, traversal and symbolic links are rejected. Directory listings show at most 200 entry names/types and never follow child symlinks. Directory creation is recursively bounded to the workspace, requires explicit yes/no approval, and rejects symlinked path components. Reads and writes are limited to 256 KiB by default; reads accept UTF-8 text only. Directory creation and writes require interactive approval. Writes preserve replaced files as backups. File deletion is high-risk: GULZ moves the file into a same-directory owner-only backup (limited to 256 KiB) instead of permanently erasing it; use `gulz restore <backup> <target>` to recover it.

The command runner uses no shell and accepts only a fixed allowlist: Node.js version, selected read-only Git status/branch/log/diff commands, npm version, and the CLI-only npm build/test workflows. The npm workflows execute repository scripts and therefore require typed approval; they have a bounded three-minute timeout. It sanitizes inherited environment variables, bounds execution time and caps combined output at 64 KiB. Arbitrary shell commands, scripts, package installation, permanent deletion, permission changes and remote execution are not exposed.

## Important capability boundaries

This CLI provides local goal/task management, OpenAI-compatible AI-assisted planning and supervised execution of a narrow set of local operations. It does not provide arbitrary shell access, package installation, permanent deletion, permission changes, remote SSH orchestration or background services. A task manually marked completed by a user is not a verified execution result; execution-managed tasks are completed only after their planned operations return verified outcomes.

## Development checks

From the repository root:

~~~sh
npm run test:cli
npm run build:cli
~~~

The CLI-only commands avoid requiring the website's Wrangler/Workerd dependency on Termux. Automated checks and real Termux/Linux/macOS/VPS installation testing must pass before a stable public release.

Licensed under Apache-2.0. See LICENSE.
