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

The current CLI does not execute shell commands, connect to remote hosts, synchronize cloud data, or call AI providers.

## Install

After the package and its `@gulz/core` dependency have been published:

```sh
npm install --global @gulz/cli
gulz --help
```

Requires Node.js 20 or newer. Run the full repository checks with `npm test` from the repository root.

Licensed under Apache-2.0. See [LICENSE](./LICENSE).
