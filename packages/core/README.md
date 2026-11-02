# @gulz/core

The shared, side-effect-free domain layer for GULZ.

## What it provides

- Goal and task data types.
- Guarded goal/task lifecycle transitions.
- Risk-derived approval decisions through `createPlannedOperation`.
- Approval summaries for plans.

This package does not execute commands, access the network, call AI providers, or persist data. Machine operations belong in the separate permission-aware execution layer.

## Install

```sh
npm install @gulz/core
```

Licensed under Apache-2.0. See [LICENSE](./LICENSE).
