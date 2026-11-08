# GULZ installation and platform guide

## Release status

GULZ is in early development. The interactive Bash installer and repository source-build route install the same GULZ CLI source build. Packaged binary releases are not available. No official binary downloads, desktop application, Android APK, npm package release, Homebrew formula or WinGet package is published yet.

### Interactive Bash installer (Termux, Linux, macOS and VPS)

The installer detects the environment, asks where to place the source checkout, explains each change and asks for confirmation before cloning/updating the repository, installing only the CLI workspace dependencies, building the CLI and linking the `gulz` command. It intentionally excludes the website workspace and Wrangler/Workerd from CLI installation. It runs as your normal user by default, asks before using a package manager to install missing prerequisites, and asks before adding its user-local command directory to your shell profile. For a direct interactive install, run this command (or download and inspect `scripts/install.sh` first if you prefer):

~~~sh
curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh | bash
~~~

On Termux, install `curl` first with `pkg install curl`. The installer can offer to install Git and Node.js LTS through Termux package manager if they are missing. The CLI-only install explicitly includes workspace development dependencies such as TypeScript while excluding the website workspace and Wrangler's unsupported `workerd` binary. On Linux/macOS/VPS, install Node.js 20.19+ first; the installer will not silently change the system Node.js installation. The script is public at `scripts/install.sh`; review it before running. The installer reads prompts from `/dev/tty`, so it remains interactive when piped from `curl`. Do not use `sudo bash` or run it as root.

Use Node.js **20.19 or newer** and Git for the source-build route. Install Node.js from the official [Node.js downloads page](https://nodejs.org/en/download).

## Android phones and tablets — Termux

The current Android route is the CLI inside Termux. It is not a standalone Android app. Do not run a full root `npm install` on Termux: the website's Wrangler dependency pulls in `workerd`, which currently does not support Android/Termux. Use `npm run install:cli` for the CLI-only build.

1. Install Termux from [F-Droid](https://f-droid.org/packages/com.termux/) or the [official Termux GitHub releases](https://github.com/termux/termux-app/releases).
2. Open Termux and run:

~~~sh
pkg update && pkg upgrade -y
pkg install curl
node --version
~~~

3. Use the interactive installer (recommended):

~~~sh
curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh | bash
~~~

The installer asks for the install folder and confirmation. If Git or Node.js LTS is missing, it offers to install them through Termux. You can still build manually from the source repository if preferred.

Termux uses Android's Bionic environment. Do not install generic Linux desktop binaries into Termux. A native Android app is planned separately.

## Linux — Ubuntu, Debian and other distributions

1. Install Node.js 20.19+ from the official Node.js download page.
2. Open a new terminal and run the interactive installer:

~~~sh
curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh | bash
~~~

Or use the manual source-build route. First confirm prerequisites:
~~~sh
node --version
npm --version
sudo apt update && sudo apt install -y git
git clone https://github.com/kellysteve/gulz.git
cd gulz
npm run install:cli
gulz --version
gulz doctor
~~~

The apt command above is suitable for Debian/Ubuntu. On other distributions, use the equivalent package manager to install Git. Native .deb, .rpm, AppImage and desktop packages are planned but not available.

## macOS — Apple Silicon and Intel

With Node.js 20.19+ and Git available, run the installer:

~~~sh
curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh | bash
~~~

Or install prerequisites with Homebrew and follow the manual source steps:

~~~sh
brew install node git
node --version
git clone https://github.com/kellysteve/gulz.git
cd gulz
npm run install:cli
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
npm run install:cli
gulz --help
gulz doctor
~~~

Confirm Node.js is 20.19 or newer. A signed Windows desktop installer and WinGet package are planned, not published.

## VPS and remote agent pairing

GULZ has an initial on-demand remote agent over the system OpenSSH client. Install the latest GULZ CLI on the VPS first, as the normal SSH user that will own the workspace:

~~~sh
curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh | bash
gulz update
~~~

From the local device where you run GULZ, connect manually once and verify the SSH host fingerprint yourself:

~~~sh
ssh user@host
# Verify the fingerprint against your VPS provider or trusted server record.
gulz --version
gulz agent --capabilities
exit
~~~

Make sure the `gulz` executable is available in non-interactive SSH sessions (the environment used by remote commands). Then pair the VPS from your local device:

~~~sh
gulz remote add production user@host /var/www/my-project
gulz remote test production
gulz chat
~~~

The last argument to `remote add` is an optional existing absolute POSIX workspace path on the VPS. The current CLI supports up to four paired VPS environments. Omit it to use the SSH user's home directory. GULZ checks that the directory exists and is not a symlink. SSH config aliases are supported, so you can use `production` instead of `user@host` if your local SSH config defines it.

GULZ uses OpenSSH with `BatchMode=yes` and `StrictHostKeyChecking=yes`. It never accepts unknown or changed host keys automatically, never enables agent forwarding, and does not store SSH private keys or passwords. If the host key is not known locally, connect manually, verify the fingerprint and retry. Each remote tool call opens an on-demand SSH process; there is no public control port or always-running remote daemon.

The remote agent exposes the current bounded tools for environment inspection, workspace files and explicitly approved direct programs. The AI provider receives the remote tool results, not SSH credentials. Before any file change or command, the local CLI shows the requested action and asks for approval. Command output may be sent to the configured AI provider as context. Do not approve commands that print credentials or private data. Shell interpreters and inline interpreter code are blocked. Privileged commands must use non-interactive `sudo -n`; GULZ will not collect or forward administrator passwords. If the VPS does not allow passwordless sudo for a specific operation, that privileged step must be handled manually.

This is an initial remote execution foundation, not a complete one-click hosting platform. Dedicated workflows for provisioning an API or website, configuring TLS/reverse proxies, managing databases and verifying public service health are still in development.
 
## First local workflow

After building and linking the CLI:

~~~sh
gulz --version
gulz doctor
gulz provider list
gulz account status
gulz chat
~~~

Run `gulz` with no arguments to open the interactive assistant. Add a provider with `/provider` and manage multiple saved profiles from its interactive provider centre. GitHub sign-in is optional: sign in at `https://gulz.gaxity.com.ng/dashboard`, create a Place pairing code, and enter it during installation or run `gulz account connect <code>` later. Then chat naturally. Recent conversation history is saved privately in `~/.gulz/conversation.json` (or your configured `GULZ_HOME`). Use `/clear` to clear it or `/exit` to leave.

When the selected model supports tool calling, GULZ can inspect the current workspace, list directories, read non-secret text files, create directories, write files with backups and run explicitly approved programs. Program execution uses no shell; shell interpreters and inline code are blocked. Package-manager commands can be proposed by the AI and run only after you approve the exact command. Command output may be sent to your configured provider, so do not approve commands that print credentials or private data. The current tool set is a foundation, not yet the complete VPS hosting workflow.

To update this installation later, run `gulz update` from an interactive terminal and answer `y` or `n`. GULZ runs a fast-forward-only Git update, installs only the CLI workspaces (including TypeScript development dependencies), rebuilds the CLI and refreshes the global link. It then preserves your saved provider profiles. Add or switch providers later with `/provider` inside chat. Pair this installation with your account at any time using `gulz account connect <code>`. It deliberately does not install the website's Wrangler/Workerd dependency. Close the current session and run `gulz` again. This updater is for source-checkout installations; published package updates are not available yet.

## Local data and privacy

GULZ stores its local data under `~/.gulz` by default; set `GULZ_HOME` to choose another data directory. Conversation history is stored in `conversation.json`, provider configuration in `provider.json`, paired VPS destinations/workspace roots in `remote-environments.json`, and local audit events in `audit.jsonl`. These files are created with owner-only permissions where supported. Provider keys and per-Place credentials are stored in owner-only files under `~/.gulz`; they are not yet encrypted by an OS credential vault. Protect your device account and data directory. The optional Places dashboard stores only a hash of the Place credential and provider/model metadata, never provider API keys. Internal work records remain an implementation detail and are not required for normal chat.

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

File paths are confined to the current working directory; absolute paths, traversal and symbolic links are rejected. Reads and writes are limited to 256 KiB by default. Writes and restores show the target and ask for a simple yes/no confirmation. Replaced files are preserved as owner-only backups.

The standalone `gulz run` diagnostic command remains a fixed allowlist. Chat uses a separate agent tool to run explicitly approved direct programs without a shell; this can invoke package managers and system utilities, with high-impact actions clearly flagged. Shell interpreters, inline interpreter code, direct SSH commands and several command wrappers are blocked. Critical disk/root-filesystem operations are blocked. The agent tool starts programs in the selected workspace, but an approved program can affect wider system state. Remote program execution is available only through a separately paired VPS agent.

## Run the automated checks

From the repository root:

~~~sh
npm test
~~~

On Termux or another host where the website's Wrangler/Workerd runtime is unavailable, run `npm run test:cli` to test and typecheck only the CLI workspaces. On supported desktop/Linux development hosts, `npm test` also typechecks the website. These checks are present in the repository; they must be run in a clean environment before a public release. Do not treat a source build as production-ready machine administration software.

## Planned desktop and package distribution

- **Windows:** signed desktop installer (.msi or .exe) and later WinGet distribution.
- **macOS:** signed and notarized .dmg for Apple Silicon and Intel; Homebrew distribution may follow.
- **Linux:** AppImage, .deb and .rpm, plus a desktop application.
- **Android:** Termux CLI first; native Android app is a separate planned deliverable.
- **VPS:** headless CLI installation and initial OpenSSH remote-agent pairing are available in the source preview; dedicated hosting workflows are still in development.
- **Node.js developers:** global npm installation after @gulz/core and @gulz/cli are published.

All release artifacts must be built for their target platform, tested, checksummed and cryptographically signed. Download buttons and package commands will be enabled only after those artifacts actually exist.

## Remove the linked developer CLI

From the repository root:

~~~sh
npm unlink --workspace @gulz/cli
~~~

This removes the global development link. It does not delete the repository or local GULZ data.


## Multiple AI providers

Inside GULZ chat, type `/provider` to open the provider centre. You can also use:

~~~text
/provider add
/provider list
/provider use deepseek
/provider models
/provider test
/provider remove
~~~

The CLI currently includes presets for several popular OpenAI-compatible providers and local model servers, plus a custom endpoint option. Up to 50 provider profiles can be saved per Place. A preset is a connection template, not a guarantee that every model supports tool calling. Run the provider test before asking GULZ to execute project operations. See [PLACES_AND_AUTH.md](PLACES_AND_AUTH.md) for optional GitHub sign-in and Places pairing setup.
