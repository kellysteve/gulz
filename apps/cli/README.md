# @gulz/cli

The GULZ command-line interface.

## Local storage safety

Goal creation and initialization use an exclusive lock so concurrent GULZ processes cannot overwrite one another's updates. If a process is forcibly terminated while holding the lock, later writes fail closed after a short wait; inspect running GULZ processes before removing the stale goals.lock file from the configured data directory. Do not remove the lock while another GULZ process is active.

The goals file is written atomically, and the data directory and goals file are restricted to the current user's permissions where the platform supports POSIX permissions.

## Interactive session

After the developer-preview installation is linked, run `gulz` with no arguments to open the interactive terminal session. You can create a goal, browse saved goals, open a goal's details, run the local system check, and view command help. Choose `0` (or type `q`) to exit. Saved goals remain on this device between sessions.

This preview is a local goal workspace, not yet an AI agent: AI planning, task execution, pause/resume, and background recovery are not connected. The interface does not pretend those features are running.

Install/link the CLI once. To update this source preview later, run `gulz update` from an interactive terminal. Review the displayed repository path and type `UPDATE GULZ` to approve. It fast-forwards the checkout, installs only the CLI workspace dependencies (including TypeScript), rebuilds and refreshes the global link. Close the current session and run `gulz` again. Published package updates are not available yet.

## Current capabilities

- Initialize local GULZ data storage and run a local environment diagnostic.
- Create, list and inspect saved goals.
- Validate saved data before using it, refusing malformed or inconsistent records without overwriting them.
- Inspect and read bounded local files through the shared execution policy.
- Write UTF-8 text only after interactive, path-specific approval; preserve overwritten files as owner-only backups.
- Restore a backup after a separate interactive confirmation.
- Run a fixed allowlist of read-only diagnostic commands after explicit interactive approval.

The CLI does **not** execute arbitrary shell commands, connect to remote hosts, synchronize cloud data, or call AI providers.

## Install

The npm packages have not yet been published. For now, use the repository's developer-preview instructions in [the installation guide](../../docs/INSTALLATION.md). Once @gulz/core and @gulz/cli are published, the intended global install is:

~~~sh
npm install --global @gulz/cli
gulz --help
~~~

Requires Node.js 20.19 or newer. Run CLI-only checks with `npm run test:cli` from the repository root. This avoids requiring the website's Wrangler/Workerd dependency on Termux.

## Command reference

~~~sh
gulz --help
gulz --version
gulz doctor
gulz init
gulz goal create "Prepare my project"
gulz goals
gulz goal show <goal-id>
gulz inspect .
gulz read README.md
gulz write notes.txt
gulz restore <backup-path> <target-path>
gulz run node --version
gulz run git status --short
gulz run git status --short --branch
gulz run git branch --show-current
gulz run git log -1 --oneline
gulz run git diff --stat
gulz run git rev-parse --show-toplevel
~~~

## Filesystem boundaries

Filesystem operations are confined to the current working directory. Absolute paths, traversal outside that directory and symbolic links are rejected. Reads and writes are capped at 256 KiB by default. Reads accept UTF-8 text only; binary files are rejected.

The write command asks for one line of text, displays a preview and byte count, and requires the user to type WRITE followed by the exact path at an interactive terminal. Non-interactive writes fail closed. Replaced files are retained as uniquely named .gulz-backup-* files beside the target.

The restore command restores a backup after the user types RESTORE followed by the exact target path. If the target exists, its current contents are preserved as another backup.

## Command execution boundaries

The run command supports only these exact argument sequences:

- node --version and node -v
- git status --short
- git status --short --branch
- git branch --show-current
- git log -1 --oneline
- git diff --stat
- git rev-parse --show-toplevel

Commands require an interactive terminal and the user must type RUN followed by the command and arguments. Processes are started with shell disabled, a sanitized environment, a bounded execution deadline and a combined 64 KiB stdout/stderr limit. The working directory is the current authorized directory. Arbitrary commands, shell syntax, scripts, package installation, deletion, permission changes and remote execution are rejected.

This allowlist is deliberately narrow. It is a supervised diagnostic facility, not a general-purpose shell and not an AI execution agent.

Licensed under Apache-2.0. See LICENSE.
