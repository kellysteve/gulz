# @gulz/cli

The GULZ command-line interface.

## Local storage safety

Goal creation and initialization use an exclusive lock so concurrent GULZ processes cannot overwrite one another's updates. If a process is forcibly terminated while holding the lock, later writes fail closed after a short wait; inspect running GULZ processes before removing the stale `goals.lock` file from the configured data directory. Do not remove the lock while another GULZ process is active.

The goals file is written atomically, and the data directory and goals file are restricted to the current user's permissions where the platform supports POSIX permissions.

## Current capabilities

- Initialize local GULZ data storage.
- Run a local environment diagnostic.
- Create, list and inspect saved goals.
- Validate saved data before using it, refusing malformed or inconsistent records without overwriting them.
- Write goal updates through a temporary file and atomic rename.
- Inspect and read bounded local files through the shared execution policy.
- Write UTF-8 text only after interactive, path-specific approval; preserve overwritten files as owner-only backups.
- Run a fixed set of read-only diagnostic commands after explicit interactive approval.

The current CLI does not execute shell commands, connect to remote hosts, synchronize cloud data, or call AI providers.

## Install

After the package and its `@gulz/core` dependency have been published:

```sh
npm install --global @gulz/cli
gulz --help
```

Requires Node.js 20.19 or newer. Run the full repository checks with `npm test` from the repository root.

Licensed under Apache-2.0. See [LICENSE](./LICENSE).

## Local filesystem commands

The CLI includes local execution commands:

```sh
gulz inspect ./relative/path
gulz read ./relative/file.txt
gulz write ./relative/file.txt
gulz restore ./.file.txt.gulz-backup-<id> ./relative/file.txt
```

All commands are confined to the current working directory. Absolute paths, traversal outside that directory and symbolic links are rejected. Reads and writes are capped at 256 KiB by default. Reads accept UTF-8 text only; binary files are rejected. `gulz write` asks for one line of text, displays a preview and byte count, and requires the user to type `WRITE <path>` at an interactive terminal; non-interactive writes fail closed. Replaced files are retained as uniquely named `.gulz-backup-*` files beside the target. Use `gulz restore <backup-path> <target-path>` to restore a backup; it asks for a separate typed confirmation and preserves the currently replaced file as another backup. The `gulz run` command supports only `node --version` and selected read-only Git status/branch/log/diff commands. It starts processes without a shell, limits output to 64 KiB and requires a typed `RUN <command>` confirmation. Arbitrary commands and shell syntax are rejected.


## Current CLI command reference

```sh
gulz --help
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
```

`gulz write` and `gulz restore` require an interactive terminal and a path-specific typed confirmation. `gulz run` also requires interactive approval. The command allowlist is intentionally small; it is not a general shell.