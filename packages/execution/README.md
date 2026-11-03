# @gulz/execution

The local execution adapter for GULZ supports bounded filesystem operations:

- `inspect`: retrieve metadata for a path inside an explicitly authorized root.
- `read_file`: read a regular UTF-8 text file inside that root, with a configurable byte cap and SHA-256 verification. Invalid UTF-8 is rejected rather than silently corrupted.
- `write_file`: write UTF-8 text after explicit approval. Writes use a same-directory temporary file and atomic rename; an overwritten regular file is copied to a uniquely named, owner-only backup beside the target. New files and temporary files are also owner-only.
- `run_command`: run only the fixed, read-only diagnostic allowlist documented below, with explicit approval and no shell.

Every operation is reconstructed through the shared core validator. Approval metadata is checked rather than trusted. Inspection and reads are low-risk. Writes are moderate-risk and require an explicit approval signal from the caller. The executor rejects symlink targets, limits content to the configured byte cap, and verifies the saved bytes. It does not invoke a shell. Process execution is limited to the fixed diagnostic allowlist documented below; arbitrary commands, scripts, delete, install, permission changes, network access and SSH are not exposed.

## Safety boundaries

- Callers must provide an absolute authorized root directory.
- Absolute paths, traversal outside the root and symbolic-link components are rejected.
- File reads and writes have a maximum size (256 KiB by default, 1 MiB hard maximum).
- Replaced files are preserved as backup files. The CLI provides a separately confirmed restore command; restoring a backup also preserves the currently replaced file as another backup.
- Operations use a 5-second default timeout (30-second hard maximum) and accept an AbortSignal. Filesystem metadata calls are not forcibly interruptible; cancellation is checked between stages and file reads honor the signal.
- Successful results include a structured audit event and verification status. Audit events are returned to the caller; they are not yet persisted as a durable audit log.

The adapter is an initial local safety boundary, not a hardened sandbox against a hostile process concurrently modifying the filesystem. Do not run it with elevated privileges or treat it as a substitute for OS-level isolation.

## Development

```sh
npm run build --workspace @gulz/execution
npm run test --workspace @gulz/execution
```

## Supervised diagnostic commands

`run_command` is restricted to a fixed argument allowlist and always requires explicit caller approval. Git diagnostics override the system/global Git config and disable the fsmonitor and pager helpers before execution. It launches processes with `shell: false`, uses the authorized working directory, enforces a 5-second default / 30-second maximum deadline, and caps combined stdout/stderr at 64 KiB. The initial allowlist is deliberately small:

- `node --version`
- `git status --short` and `git status --short --branch`
- `git branch --show-current`
- `git log -1 --oneline`
- `git diff --stat`
- `git rev-parse --show-toplevel`

Arguments are matched as exact token arrays. Arbitrary commands, shell operators, scripts, package installation, network tools and destructive commands are rejected. A non-zero exit code is returned as a failed audit outcome; it is not reported as a successful operation.