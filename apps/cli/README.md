# @gulz/cli

The GULZ command-line interface.

## Current capabilities

- Initialize local GULZ data storage.
- Run a local environment diagnostic.
- Create, list and inspect saved goals.

The current CLI does not execute shell commands, connect to remote hosts, synchronize cloud data, or call AI providers.

## Install

After the package and its `@gulz/core` dependency have been published:

```sh
npm install --global @gulz/cli
gulz --help
```

Requires Node.js 20 or newer.

Licensed under Apache-2.0. See [LICENSE](./LICENSE).
