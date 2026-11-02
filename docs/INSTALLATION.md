# GULZ installation and testing

## First developer build

The first runnable build targets Node.js 20 or newer. Android users can run it inside
Termux; the same CLI package is intended for Linux, macOS, Windows and Node-capable VPS
environments. Native standalone installers are not published yet.

### Android / Termux

1. Install Termux from a trusted source and open it.
2. Install Git and Node.js: `pkg update && pkg install git nodejs`.
3. Clone the private GULZ repository using an authenticated GitHub method.
4. From the repository root, install workspace dependencies: `npm install`.
5. Build and link the CLI: `npm run install:local`.
6. Check it: `gulz --version` and `gulz doctor`.

### Try the first local workflow

```sh
gulz init
gulz goal create "Prepare my first development environment"
gulz goals
```

The CLI stores goals on the device in `~/.gulz/goals.json`. Set `GULZ_HOME` to use a
different data directory. The data directory and goal file are created with owner-only
permissions where the operating system supports them.

### Current limitations

This is an early developer build. It can initialize local storage, run diagnostics and
create/list/show saved goals. It does not yet execute shell commands, connect to SSH,
call an AI provider, synchronize cloud data, or install as a standalone native binary.
Do not use it for production machine administration.

### Remove the linked developer CLI

From the repository root, run `npm unlink --workspace @gulz/cli`. This removes the
global development link; it does not delete the repository or local goal data.
