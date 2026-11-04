# GULZ CLI

**GULZ — Goals. Executed.**  
A local command-line workspace for goals, tasks, supervised file operations and activity history.

## Install

Use the interactive installer on Termux, Linux, macOS or a Linux VPS:

~~~sh
curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh | bash
~~~

It installs only the CLI workspaces and their build dependencies, avoiding the website's Wrangler/Workerd dependency on Termux. Run it as your normal user. Windows users should follow the PowerShell source-build instructions in [the installation guide](../../docs/INSTALLATION.md).

Requires Node.js 20.19+ and Git. The npm packages are not published yet; this source installation is the supported installation route.

## First commands

~~~sh
gulz
gulz --help
gulz doctor
gulz init
gulz goal create "Prepare my project"
gulz goals
gulz audit
gulz provider status
gulz plan <goal-id>
~~~

Run `gulz update` from an interactive terminal to fast-forward the source checkout, rebuild the CLI and refresh its command link. It requires a clean fast-forwardable checkout and the exact confirmation `UPDATE GULZ`. Your local data in `~/.gulz` is separate from the source installation.

## Goal and task management

~~~sh
gulz goal create "Prepare a release"
gulz goals
gulz goal show <goal-id>
gulz goal edit <goal-id>
gulz goal task add <goal-id> "Review the release checklist"
gulz goal task status <goal-id> <task-id> running
gulz goal task status <goal-id> <task-id> completed
gulz goal status <goal-id> planned
gulz goal delete <goal-id>
~~~

Editing is interactive. Deletion requires typing the exact goal ID. Goal and task lifecycle transitions are checked by the shared core; invalid transitions are rejected. Task status changes are user-managed checklist state, not proof that GULZ executed the task.

## AI provider and planning

Configure any OpenAI-compatible chat-completions endpoint:

~~~sh
gulz provider configure
gulz provider status
gulz plan <goal-id>
~~~

The API key is entered without echo and stored in `~/.gulz/provider.json` with owner-only permissions where supported. It is stored as plaintext protected by filesystem permissions, not encrypted. Alternatively set `GULZ_AI_BASE_URL`, `GULZ_AI_MODEL` and `GULZ_AI_API_KEY` in the process environment. Remote providers must use HTTPS; HTTP is accepted only for localhost model servers. Before a plan request, GULZ asks for confirmation and sends only the goal title and description; it does not upload workspace files. The provider adapter accepts only bounded JSON plans containing inspect, read, write and a fixed read-only command allowlist. Every operation is revalidated locally and risk is derived by GULZ, not trusted from the model.

AI planning saves a plan for review. It does not execute the plan yet.

## Activity history

~~~sh
gulz audit
gulz audit --limit 10
~~~

Goal and task changes are recorded in a local JSONL audit file under `~/.gulz`. The audit file is restricted to the current user's permissions where supported. It stores action metadata, not file contents or credentials.

## Supervised local operations

~~~sh
gulz inspect .
gulz read README.md
gulz write notes.txt
gulz restore <backup-path> <target-path>
gulz run node --version
gulz run git status --short
~~~

Filesystem operations are confined to the current working directory. Absolute paths, traversal and symbolic links are rejected. Reads and writes are limited to 256 KiB by default; reads accept UTF-8 text only. Writes and restores require interactive, path-specific confirmation and preserve replaced files as owner-only backups.

The command runner uses no shell and accepts only a small fixed allowlist of read-only diagnostics: Node.js version and selected Git status/branch/log/diff commands. It sanitizes inherited environment variables, bounds execution time and caps combined output at 64 KiB. Arbitrary shell commands, scripts, package installation, deletion, permission changes and remote execution are not exposed.

## Important capability boundaries

This CLI provides local goal/task management, OpenAI-compatible AI-assisted planning and supervised local workspace operations. It does not yet autonomously execute AI-generated task lists, orchestrate remote SSH hosts, or run background services. A task marked completed in the checklist is a user-entered status, not a verified execution result. These boundaries are intentional; the CLI never pretends a feature ran when it did not.

## Development checks

From the repository root:

~~~sh
npm run test:cli
npm run build:cli
~~~

The CLI-only commands avoid requiring the website's Wrangler/Workerd dependency on Termux. Automated checks and real Termux/Linux/macOS/VPS installation testing must pass before a stable public release.

Licensed under Apache-2.0. See LICENSE.
