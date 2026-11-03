# @gulz/execution

The first local execution adapter for GULZ. This initial version deliberately supports only bounded, read-only filesystem operations:

- `inspect`: retrieve metadata for a path inside an explicitly authorized root.
- `read_file`: read a regular file inside that root, with a configurable byte cap and SHA-256 verification.

Every operation is reconstructed through the shared core validator. Approval metadata is checked rather than trusted. This first adapter only permits low-risk filesystem operations; it does not execute shell commands or write, delete, install, change permissions, access networks, or connect over SSH.

## Safety boundaries

- Callers must provide an absolute authorized root directory.
- Absolute paths, traversal outside the root and symbolic-link components are rejected.
- File reads have a maximum size (256 KiB by default, 1 MiB hard maximum).
- Operations have a timeout (5 seconds by default, 30 seconds hard maximum) and accept an AbortSignal.
- Successful results include a structured audit event and verification status.

The adapter is an initial local safety boundary, not a hardened sandbox against a hostile process concurrently modifying the filesystem. Do not run it with elevated privileges or treat it as a substitute for OS-level isolation.

## Development

```sh
npm run build --workspace @gulz/execution
npm run test --workspace @gulz/execution
```
