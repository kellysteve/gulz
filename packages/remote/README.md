# @gulz/remote

OpenSSH transport for a separately installed GULZ remote agent.

- Uses the user's system OpenSSH client, SSH config and SSH agent; GULZ does not store private keys.
- Requires BatchMode and StrictHostKeyChecking; unknown or changed host keys are never accepted automatically.
- Disables agent forwarding, local commands, X11/PTY and configured port forwards.
- Sends model tool arguments and the user-selected remote workspace root as bounded JSON over stdin to a fixed remote command; model text is never interpolated into the remote command string.
- Requires an existing absolute POSIX workspace path (or `.` for the SSH user's starting directory); the remote agent rejects missing, symlinked or traversal-based workspace roots.
- The remote host must already have a compatible GULZ installation with the stdio agent protocol.

Remote calls still require approval in the local agent engine and a second policy check on the remote agent. The SSH-authenticated account must be an ordinary, least-privilege user.