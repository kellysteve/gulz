# Contributing to GULZ

Thanks for considering a contribution.

## Before you start

- Read the project README and [architecture](docs/ARCHITECTURE.md).
- Check existing issues and pull requests before starting substantial work.
- For large changes, open an issue or discussion first so the design can be agreed before implementation.
- Be clear about what is implemented, what is planned, and what has actually been tested.

## Development principles

- Keep the terminal, AI assistant and task workspace on the same shared core and execution policy.
- Never let AI output act as authorization.
- Require explicit approval for sensitive, destructive or high-impact operations.
- Use least privilege, bounded operations and independent verification.
- Do not fake tool results or claim success without evidence.
- Do not add secrets, credentials, personal data or production environment files.
- Keep platform-specific behavior explicit; Android Termux is not interchangeable with glibc-based Linux.
- Add tests for new behavior and regressions.

## Pull requests

1. Describe the problem and the intended behavior.
2. Explain any security, permission or data-migration impact.
3. Include tests or reproducible verification steps.
4. Update documentation when behavior or installation steps change.
5. Keep changes focused and avoid bundling unrelated refactors.

## License

By intentionally submitting a contribution for inclusion in GULZ, you agree that it is submitted under the Apache License 2.0, unless you and the project maintainers have agreed otherwise in writing. You retain copyright in your contributions.
