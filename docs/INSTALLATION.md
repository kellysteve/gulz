# GULZ installation and testing

## Current status

GULZ is open source under Apache 2.0. The source repository is the developer route, not the intended end-user installation experience. Native standalone installers and package-manager releases are not published yet.

## Build from source (developer preview)

The first runnable build targets Node.js 20 or newer. Android users can run it inside Termux; the same CLI package is intended for Linux, macOS, Windows and Node-capable VPS environments.

### Android / Termux

1. Install Termux from a trusted source and open it.
2. Install Git and Node.js: `pkg update && pkg install git nodejs`.
3. Clone the public GULZ repository: `git clone https://github.com/kellysteve/gulz.git`.
4. Enter the repository: `cd gulz`.
5. Install workspace dependencies: `npm install`.
6. Build and link the CLI: `npm run install:local`.

### Try the first local workflow

```sh
gulz --version
gulz doctor
gulz init
gulz goal create "Prepare my first development environment"
gulz goals
```

The CLI stores goals on the device in `~/.gulz/goals.json`. Set `GULZ_HOME` to use a different data directory. The data directory and goal file are created with owner-only permissions where the operating system supports them.

## Current limitations

This is an early developer build. It can initialize local storage, run diagnostics and create/list/show saved goals. It does not yet execute shell commands, connect to SSH, call an AI provider, synchronize cloud data, or install as a standalone native binary. Do not use it for production machine administration.

## Planned end-user distribution

The CLI and core packages are being prepared for public npm publication. Once both packages have been published in dependency order, the intended Node.js installation will be:

\`\`\`sh
npm install --global @gulz/cli
gulz --version
\`\`\`

This command is not available until publication is complete. Native platform-appropriate installers are still planned for Android/Termux, Linux, macOS, Windows and VPS environments. Each release must be built for its target platform, tested, checksummed and cryptographically signed before being listed as available. No official binary download is available yet.

## Remove the linked developer CLI

From the repository root, run `npm unlink --workspace @gulz/cli`. This removes the global development link; it does not delete the repository or local goal data.
