# GULZ installation and platform guide

## Release status

GULZ is in early development. The interactive Bash installer and repository source-build route install the same developer-preview CLI; neither is a stable end-user release. No official binary downloads, desktop application, Android APK, npm package release, Homebrew formula or WinGet package is published yet.

### Interactive Bash installer (Termux, Linux, macOS and VPS)

The installer detects the environment, asks where to place the source checkout, explains each change and asks for confirmation before cloning/updating the repository, installing npm dependencies, building the CLI and linking the `gulz` command. It does not run as root by default, edit shell startup files or install arbitrary system packages without asking. Download it first, inspect it if you wish, then run it:

~~~sh
curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh | bash
~~~

On Termux, install `curl` first with `pkg install curl`. The installer can offer to install Git and Node.js LTS through Termux package manager if they are missing. On Linux/macOS/VPS, install Node.js 20.19+ first; the installer will not silently change the system Node.js installation. The script is public at `scripts/install.sh`; review it before running. Its prompts read from `/dev/tty`, so the `curl | bash` form remains interactive. Do not use `sudo bash` or run it as root.

Use Node.js **20.19 or newer** and Git for the source-build route. Install Node.js from the official [Node.js downloads page](https://nodejs.org/en/download).

## Android phones and tablets — Termux

The current Android route is the CLI inside Termux. It is not a standalone Android app.

1. Install Termux from [F-Droid](https://f-droid.org/packages/com.termux/) or the [official Termux GitHub releases](https://github.com/termux/termux-app/releases).
2. Open Termux and run:

~~~sh
pkg update && pkg upgrade -y
pkg install nodejs-lts git curl
node --version
~~~

3. Use the interactive installer (recommended):

~~~sh
curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh | bash
~~~

The installer asks for the install folder and confirmation. You can still build manually from the source repository if preferred.

Termux uses Android's Bionic environment. Do not install generic Linux desktop binaries into Termux. A native Android app is planned separately.

## Linux — Ubuntu, Debian and other distributions

1. Install Node.js 20.19+ from the official Node.js download page.
2. Open a new terminal and run the interactive installer:

~~~sh
curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh -o gulz-install.sh
bash gulz-install.sh
~~~

Or use the manual source-build route. First confirm prerequisites:
~~~sh
node --version
npm --version
sudo apt update && sudo apt install -y git
git clone https://github.com/kellysteve/gulz.git
cd gulz
npm install
npm run install:local
gulz --version
gulz doctor
~~~

The apt command above is suitable for Debian/Ubuntu. On other distributions, use the equivalent package manager to install Git. Native .deb, .rpm, AppImage and desktop packages are planned but not available.

## macOS — Apple Silicon and Intel

With Node.js 20.19+ and Git available, run the installer:

~~~sh
curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh -o gulz-install.sh
bash gulz-install.sh
~~~

Or install prerequisites with Homebrew and follow the manual source steps:

~~~sh
brew install node git
node --version
git clone https://github.com/kellysteve/gulz.git
cd gulz
npm install
npm run install:local
gulz --help
gulz doctor
~~~

Confirm Node.js is 20.19 or newer. A signed .dmg desktop app and Homebrew distribution are planned; neither is published yet.

## Windows 10 and 11 — PowerShell

Open PowerShell and install the prerequisites:

~~~powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
~~~

Close and reopen PowerShell so the PATH changes apply. Then:

~~~powershell
node --version
git clone https://github.com/kellysteve/gulz.git
cd gulz
npm install
npm run install:local
gulz --help
gulz doctor
~~~

Confirm Node.js is 20.19 or newer. A signed Windows desktop installer and WinGet package are planned, not published.

## VPS and headless servers

Connect to a Linux VPS with your own SSH account. Install Node.js 20.19+ and curl, then run the interactive installer as your normal user:

~~~sh
curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh -o gulz-install.sh
bash gulz-install.sh
~~~

The installer detects Linux, asks for an install folder and confirmation, then builds and links the CLI. It does not set up SSH access or configure a service daemon.

The current CLI runs on the server where it is installed. GULZ does not yet provide remote SSH orchestration or manage other machines automatically. Do not run the CLI as root unless a future, explicitly documented operation requires it.

## First local workflow

After building and linking the CLI:

~~~sh
gulz --version
gulz doctor
gulz init
gulz goal create "Prepare my first development environment"
gulz goals
gulz goal show <goal-id>
~~~

Run `gulz` with no arguments whenever you want to open the interactive terminal session. You do not need to repeat the installation commands each time; once linked, the `gulz` command is available from your terminal. Close the session with option 0.

To update this developer-preview installation later, run `gulz update` from an interactive terminal. Review the repository path and type `UPDATE GULZ` to approve. GULZ then runs a fast-forward-only Git update, installs the repository's declared dependencies, rebuilds the CLI and refreshes the global link. Close the current session and run `gulz` again. This updater is for source-checkout installations; published package updates are not available yet.

Goals are stored locally in ~/.gulz/goals.json. Set GULZ_HOME to choose another data directory. The CLI validates stored records before use and refuses malformed data instead of silently overwriting it.

## Filesystem and diagnostic commands

~~~sh
gulz inspect .
gulz read README.md
gulz write notes.txt
gulz restore <backup-path> <target-path>
gulz run node --version
gulz run git status --short
gulz run git branch --show-current
gulz run git log -1 --oneline
gulz run git diff --stat
~~~

File paths are confined to the current working directory; absolute paths, traversal and symbolic links are rejected. Reads and writes are limited to 256 KiB by default. Writes and restores require a typed, path-specific confirmation. Replaced files are preserved as owner-only backups.

The run command is not a general shell. It accepts only the fixed diagnostic allowlist documented in the CLI reference, starts processes without a shell, strips inherited command-override environment variables, caps combined output at 64 KiB and requires typed approval. Package installs, arbitrary shell commands, deletes, permission changes and remote execution are not available.

## Run the automated checks

From the repository root:

~~~sh
npm test
~~~

This builds and tests the core, execution and CLI packages and typechecks the workspaces. These checks are present in the repository; they must be run in a clean environment before a public release. Do not treat a source build as production-ready machine administration software.

## Planned desktop and package distribution

- **Windows:** signed desktop installer (.msi or .exe) and later WinGet distribution.
- **macOS:** signed and notarized .dmg for Apple Silicon and Intel; Homebrew distribution may follow.
- **Linux:** AppImage, .deb and .rpm, plus a desktop application.
- **Android:** Termux CLI first; native Android app is a separate planned deliverable.
- **VPS:** headless CLI installation; remote SSH orchestration is a later capability.
- **Node.js developers:** global npm installation after @gulz/core and @gulz/cli are published.

All release artifacts must be built for their target platform, tested, checksummed and cryptographically signed. Download buttons and package commands will be enabled only after those artifacts actually exist.

## Remove the linked developer CLI

From the repository root:

~~~sh
npm unlink --workspace @gulz/cli
~~~

This removes the global development link. It does not delete the repository or local GULZ data.
