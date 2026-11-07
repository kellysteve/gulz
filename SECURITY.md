# Security policy

## Reporting a vulnerability

Please do not report exploitable vulnerabilities in public issues.

Until a dedicated private security contact is published, contact the repository owner through GitHub's private vulnerability reporting feature (if enabled) or another private channel already listed on the official GULZ website. Include:

- A clear description of the affected component and impact.
- Reproduction steps or a proof of concept that does not access other people's data.
- The versions, platforms and configurations affected.
- Any suggested mitigation, if known.

Do not include real credentials, tokens, private keys, personal data or production user data in a report.

## Security expectations

GULZ is an early-development project. Do not assume source-level safeguards have received a production security audit. Do not use early builds for production machine administration or grant them root/administrator privileges.

Current source safeguards include:

- File tools scoped to an explicitly selected local or remote workspace, with path traversal and symlink checks.
- Known credential directories and likely secret files blocked from file-read tool context sent to the AI provider; common API-key, token, bearer, private-key and credential patterns are redacted from tool output before provider context.
- Mutating file operations and all direct program execution require explicit approval.
- Direct programs are launched without a shell, with bounded arguments, output and execution time; shell interpreters, inline interpreter-code flags and several command wrappers are blocked.
- Critical root-filesystem deletion and disk-format/write commands are blocked at the execution boundary.
- High-impact system/service/permission commands are identified in the approval prompt.
- Remote connections use the system OpenSSH client, strict host-key verification, disabled agent forwarding and port forwarding, and fixed remote command entry points.
- SSH private keys and passwords remain in the user's OpenSSH configuration/agent; GULZ stores only a remote destination and selected workspace path.
- Remote agent requests are checked again on the remote host and recorded in its local audit log.
- Provider/tool results and command output may still contain sensitive information; users must review approvals carefully.

Known limitations:

- The remote approval flag is supplied by the authenticated local controller; the remote host does not independently authenticate the human approval.
- Provider API keys are stored in a local configuration file with filesystem permissions, not encryption or OS-backed secret storage.
- Approved programs can still have broad side effects beyond the workspace. GULZ is not a hardened sandbox.
- Secret-file name filtering and pattern redaction are not complete secret scanners. Unknown formats and command output can still expose secrets if approved.
- The remote agent and transport have not yet completed real-host integration testing or an independent security review.
- Full VPS provisioning, hosting, service-management workflows, signed updates and production release verification are still in development.

The project aims to enforce least privilege, explicit approval for sensitive operations, secure secret handling, auditability, signed releases and independent verification. Report gaps responsibly.
