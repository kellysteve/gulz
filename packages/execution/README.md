# @gulz/execution

The local execution adapter for GULZ is the only package allowed to perform machine operations. Every input is reconstructed through the shared core validator; caller-supplied approval metadata is checked, never trusted.

## Supported local operations

- `inspect`: retrieve metadata for a path inside an explicitly authorized root.
- `list_directory`: list at most 200 entry names and types; child symlinks are reported but never followed.
- `create_directory`: recursively create missing directories inside the authorized root after moderate-risk approval. Every path component is checked and symlinks are rejected.
- `read_file`: read a regular UTF-8 text file with a configurable byte cap and SHA-256 verification. Invalid UTF-8 is rejected.
- `write_file`: write UTF-8 text after moderate-risk approval. Writes use a same-directory temporary file and atomic rename; replaced files are preserved as private backups.
- `delete_file`: high-risk, reversible removal of a regular file up to 256 KiB. GULZ moves it to a deterministic same-directory backup, restricts the backup to owner-only permissions where supported, and verifies its digest. It never recursively deletes directories or follows symlinks. The CLI can restore the backup.
- `run_command`: run a fixed argument allowlist with explicit approval and no shell.

The command allowlist includes Node.js version checks, selected read-only Git diagnostics, `npm --version`, `npm run build:cli` and `npm run test:cli`. The npm build/test workflows execute repository scripts and require typed approval. Arbitrary shell commands, scripts, package installation, permanent deletion, permission changes, general network access and SSH are not exposed.

## Safety boundaries

- Callers provide an absolute authorized root directory.
- Absolute paths, traversal outside the root and symbolic-link components are rejected.
- File reads, writes and reversible deletion default to a 256 KiB cap (1 MiB hard maximum for read/write configuration).
- Replaced files and deleted files are recoverable backups. Restoring a backup also preserves any currently replaced file as another backup.
- Operations use a 5-second default timeout; approved npm workflows may use up to 180 seconds. A caller AbortSignal can cancel process execution. Combined stdout/stderr is capped at 64 KiB.
- Successful results include a structured audit event and verification status. The CLI persists operation outcomes to its local JSONL audit history.
- Process execution uses `shell: false`, an authorized working directory and a sanitized environment. Provider credentials and unrelated inherited variables are not passed to child processes.

The adapter is a local safety boundary, not a hardened sandbox against a hostile process concurrently modifying the filesystem. Do not run it with elevated privileges or treat it as a substitute for OS-level isolation.

## Development

~~~sh
npm run build --workspace @gulz/execution
npm run test --workspace @gulz/execution
~~~

All command arguments are matched as exact token arrays. A non-zero exit code is returned as an unsuccessful verification result; it is never reported as a successful operation.
