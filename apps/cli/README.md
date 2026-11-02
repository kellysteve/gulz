# @gulz/cli

The GULZ command-line interface.

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
