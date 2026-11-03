# @gulz/execution

The local execution adapter for GULZ supports bounded filesystem operations:

- `inspect`: retrieve metadata for a path inside an explicitly authorized root.
- `read_file`: read a regular file inside that root, with a configurable byte cap and SHA-256 verification.
- `write_file`: write UTF-8 text after explicit approval. Writes use a same-directory temporary file and atomic rename; an overwritten regular file is copied to a uniquely named backup beside the target.

Every operation is reconstructed through the shared core validator. Approval metadata is checked rather than trusted. Inspection and reads are low-risk. Writes are moderate-risk and require an explicit approval signal from the caller. The executor rejects symlink targets, limits content to the configured byte cap, and verifies the saved bytes. It does not execute shell commands, delete, install, change permissions, access networks, or connect over SSH.

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
