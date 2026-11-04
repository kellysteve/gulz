#!/usr/bin/env bash
set -Eeuo pipefail

GULZ_REPO="https://github.com/kellysteve/gulz.git"
GULZ_DEFAULT_DIR="$HOME/.local/share/gulz"
GULZ_BIN_DIR="$HOME/.local/bin"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != "dumb" ]; then
  BOLD=
ask_yes_no() {
  local prompt="$1" answer="" answer_lc=""
  while true; do
    read -r -p "$prompt [y/N] " answer </dev/tty || true
    answer_lc="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"
    case "$answer_lc" in y|yes) return 0 ;; n|no|"") return 1 ;; *) printf 'Please answer y or n.\n' ;; esac
  done
}
command_exists() { command -v "$1" >/dev/null 2>&1; }

[ -t 1 ] || fail "Run this installer in an interactive terminal; it asks before making changes."
[ -r /dev/tty ] || fail "An interactive terminal is required. Download the script and run it from a terminal."

case "$(uname -s 2>/dev/null || echo unknown)" in
  Linux*)
    if [ -n "${PREFIX:-}" ] && [[ "$PREFIX" == *com.termux* ]]; then PLATFORM="termux"; else PLATFORM="linux"; fi
    ;;
  Darwin*) PLATFORM="macos" ;;
  *) fail "This Bash installer supports Termux, Linux, macOS and Linux-based VPS hosts. Use the Windows PowerShell guide on Windows." ;;
esac

bold "GULZ — Goals. Executed."
printf 'Interactive installer · %s\n' "$PLATFORM"
printf 'This installs GULZ CLI from the official source repository.\n'
printf 'It does not install a native Android or desktop app.\n'

if [ "$PLATFORM" = "termux" ]; then
  info "Detected Termux. Installation stays inside your Termux environment."
elif [ "$PLATFORM" = "linux" ]; then
  info "Detected Linux. This also works on a VPS when run as your normal user."
else
  info "Detected macOS."
fi

if [ "$(id -u)" -eq 0 ]; then
  warn "Running as root is not recommended. GULZ should be installed and run as a normal user."
  ask_yes_no "Continue anyway?" || exit 0
fi

bold "1/5 · Check prerequisites"
if ! command_exists git; then
  case "$PLATFORM" in
    termux) INSTALL_CMD="pkg install git" ;;
    linux)
      if command_exists apt-get; then INSTALL_CMD="sudo apt-get update && sudo apt-get install -y git"
      elif command_exists dnf; then INSTALL_CMD="sudo dnf install -y git"
      elif command_exists pacman; then INSTALL_CMD="sudo pacman -S --needed git"
      elif command_exists zypper; then INSTALL_CMD="sudo zypper install git"
      else fail "Git is missing. Install Git with your distribution's package manager, then rerun this installer."; fi
      ;;
    macos) INSTALL_CMD="xcode-select --install (or install Git with Homebrew)" ;;
  esac
  printf 'Git is not installed. Suggested command: %s\n' "$INSTALL_CMD"
  ask_yes_no "May this installer attempt to install Git now?" || fail "Install Git, then rerun this installer."
  case "$PLATFORM" in
    termux) pkg install -y git ;;
    linux)
      if command_exists apt-get; then sudo apt-get update && sudo apt-get install -y git
      elif command_exists dnf; then sudo dnf install -y git
      elif command_exists pacman; then sudo pacman -S --needed git
      else sudo zypper install -y git; fi
      ;;
    macos) xcode-select --install || true; fail "Finish the Git/Xcode command-line tools installation, then rerun this installer." ;;
  esac
fi

if ! command_exists node || ! command_exists npm; then
  if [ "$PLATFORM" = "termux" ]; then
    printf 'Node.js/npm are missing. Termux can install them with: pkg install nodejs-lts\n'
    ask_yes_no "Install Node.js LTS now?" || fail "Install Node.js LTS, then rerun this installer."
    pkg install -y nodejs-lts
  else
    fail "Node.js 20.19+ and npm are required. Install the current Node.js LTS from https://nodejs.org/en/download, then rerun this installer. No system-wide Node installer will be run automatically."
  fi
fi

NODE_VERSION="$(node -p 'process.versions.node' 2>/dev/null || true)"
node -e 'const [a,b,c]=process.versions.node.split(".").map(Number); process.exit(a>20 || (a===20 && (b>19 || (b===19 && c>=0))) ? 0 : 1)' || fail "Node.js 20.19.0 or newer is required (found v$NODE_VERSION). Upgrade Node.js and rerun."
info "Git: $(git --version)"
info "Node.js: v$NODE_VERSION"
info "npm: $(npm --version)"

bold "2/5 · Choose installation folder"
printf 'Default: %s\n' "$GULZ_DEFAULT_DIR"
read -r -p "Install folder [press Enter to accept]: " chosen_dir </dev/tty || true
INSTALL_DIR="${chosen_dir:-$GULZ_DEFAULT_DIR}"
case "$INSTALL_DIR" in "~/"*) INSTALL_DIR="$HOME/${INSTALL_DIR#~/}" ;; esac
INSTALL_DIR="$(mkdir -p "$(dirname "$INSTALL_DIR")" && cd "$(dirname "$INSTALL_DIR")" && pwd)/$(basename "$INSTALL_DIR")"
[ "$INSTALL_DIR" != "$HOME" ] && [ "$INSTALL_DIR" != "/" ] || fail "Choose a dedicated folder, not your home directory or filesystem root."
if [ -e "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR/.git" ]; then
  fail "The selected folder exists but is not a GULZ Git checkout: $INSTALL_DIR"
fi
printf 'GULZ source will be stored at: %s\n' "$INSTALL_DIR"

bold "3/5 · Review installation"
printf 'The installer will clone or fast-forward the GULZ repository, install only CLI workspace dependencies (including TypeScript), build the CLI and create a user-level command link. The website and Wrangler/Workerd are excluded.\n'
printf 'It may use sudo only if you explicitly approve installing a missing Git package. It will not run GULZ operations on your files or install a background service.\n'
ask_yes_no "Continue with installation?" || { printf 'Installation cancelled.\n'; exit 0; }

bold "4/5 · Download and build"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  git clone --depth 1 "$GULZ_REPO" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
if [ "$PLATFORM" = "termux" ]; then
  GULZ_BIN_DIR="$(npm config get prefix)/bin"
  mkdir -p "$GULZ_BIN_DIR"
  npm run install:cli
else
  GULZ_BIN_DIR="$HOME/.local/bin"
  mkdir -p "$GULZ_BIN_DIR"
  NPM_CONFIG_PREFIX="$HOME/.local" npm run install:cli
fi

bold "5/5 · Verify the gulz command"
case ":$PATH:" in
  *":$GULZ_BIN_DIR:"*) ;;
  *)
    warn "$GULZ_BIN_DIR is not currently in PATH."
    PROFILE="$HOME/.profile"
    case "${SHELL:-/bin/bash}" in */zsh) PROFILE="$HOME/.zprofile" ;; */bash) PROFILE="$HOME/.bashrc" ;; esac
    if ask_yes_no "Add $GULZ_BIN_DIR to PATH in $PROFILE?"; then
      touch "$PROFILE"
      if ! grep -Fq "$GULZ_BIN_DIR" "$PROFILE"; then
        printf '\n# GULZ command-line tools\nexport PATH="%s:$PATH"\n' "$GULZ_BIN_DIR" >> "$PROFILE"
      fi
      export PATH="$GULZ_BIN_DIR:$PATH"
      info "Updated $PROFILE. The PATH change is active in this installer session."
    else
      printf 'You can add this line to your shell profile later:\n  export PATH="%s:$PATH"\n' "$GULZ_BIN_DIR"
    fi
    ;;
esac

printf '\n'
if command_exists gulz; then
  gulz --version
  printf '\n'
  gulz doctor || warn "The CLI installed, but its local doctor check reported an issue."
else
  warn "The command is not on PATH in this terminal yet. Add $GULZ_BIN_DIR to PATH, reopen the terminal, then run gulz."
fi

bold "Installation finished"
printf 'Run: gulz\n'
printf 'Update later: gulz update (requires a clean source checkout)\n'
printf 'Install folder: %s\n' "$INSTALL_DIR"
printf 'Your local GULZ data is stored separately in ~/.gulz.\n'
printf 'GULZ currently provides local goal management and supervised workspace operations. AI planning and remote SSH execution are not included in this CLI installation.\n'
\033[1m'; DIM=
ask_yes_no() {
  local prompt="$1" answer="" answer_lc=""
  while true; do
    read -r -p "$prompt [y/N] " answer </dev/tty || true
    answer_lc="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"
    case "$answer_lc" in y|yes) return 0 ;; n|no|"") return 1 ;; *) printf 'Please answer y or n.\n' ;; esac
  done
}
command_exists() { command -v "$1" >/dev/null 2>&1; }

[ -t 1 ] || fail "Run this installer in an interactive terminal; it asks before making changes."
[ -r /dev/tty ] || fail "An interactive terminal is required. Download the script and run it from a terminal."

case "$(uname -s 2>/dev/null || echo unknown)" in
  Linux*)
    if [ -n "${PREFIX:-}" ] && [[ "$PREFIX" == *com.termux* ]]; then PLATFORM="termux"; else PLATFORM="linux"; fi
    ;;
  Darwin*) PLATFORM="macos" ;;
  *) fail "This Bash installer supports Termux, Linux, macOS and Linux-based VPS hosts. Use the Windows PowerShell guide on Windows." ;;
esac

bold "GULZ — Goals. Executed."
printf 'Interactive source installer · %s\n' "$PLATFORM"
printf 'This installs the current CLI developer preview from the public source repository.\n'
printf 'It does not install a native Android or desktop app.\n'

if [ "$PLATFORM" = "termux" ]; then
  info "Detected Termux. Installation stays inside your Termux environment."
elif [ "$PLATFORM" = "linux" ]; then
  info "Detected Linux. This also works on a VPS when run as your normal user."
else
  info "Detected macOS."
fi

if [ "$(id -u)" -eq 0 ]; then
  warn "Running as root is not recommended. GULZ should be installed and run as a normal user."
  ask_yes_no "Continue anyway?" || exit 0
fi

bold "1/5 · Check prerequisites"
if ! command_exists git; then
  case "$PLATFORM" in
    termux) INSTALL_CMD="pkg install git" ;;
    linux)
      if command_exists apt-get; then INSTALL_CMD="sudo apt-get update && sudo apt-get install -y git"
      elif command_exists dnf; then INSTALL_CMD="sudo dnf install -y git"
      elif command_exists pacman; then INSTALL_CMD="sudo pacman -S --needed git"
      elif command_exists zypper; then INSTALL_CMD="sudo zypper install git"
      else fail "Git is missing. Install Git with your distribution's package manager, then rerun this installer."; fi
      ;;
    macos) INSTALL_CMD="xcode-select --install (or install Git with Homebrew)" ;;
  esac
  printf 'Git is not installed. Suggested command: %s\n' "$INSTALL_CMD"
  ask_yes_no "May this installer attempt to install Git now?" || fail "Install Git, then rerun this installer."
  case "$PLATFORM" in
    termux) pkg install -y git ;;
    linux)
      if command_exists apt-get; then sudo apt-get update && sudo apt-get install -y git
      elif command_exists dnf; then sudo dnf install -y git
      elif command_exists pacman; then sudo pacman -S --needed git
      else sudo zypper install -y git; fi
      ;;
    macos) xcode-select --install || true; fail "Finish the Git/Xcode command-line tools installation, then rerun this installer." ;;
  esac
fi

if ! command_exists node || ! command_exists npm; then
  if [ "$PLATFORM" = "termux" ]; then
    printf 'Node.js/npm are missing. Termux can install them with: pkg install nodejs-lts\n'
    ask_yes_no "Install Node.js LTS now?" || fail "Install Node.js LTS, then rerun this installer."
    pkg install -y nodejs-lts
  else
    fail "Node.js 20.19+ and npm are required. Install the current Node.js LTS from https://nodejs.org/en/download, then rerun this installer. No system-wide Node installer will be run automatically."
  fi
fi

NODE_VERSION="$(node -p 'process.versions.node' 2>/dev/null || true)"
node -e 'const [a,b,c]=process.versions.node.split(".").map(Number); process.exit(a>20 || (a===20 && (b>19 || (b===19 && c>=0))) ? 0 : 1)' || fail "Node.js 20.19.0 or newer is required (found v$NODE_VERSION). Upgrade Node.js and rerun."
info "Git: $(git --version)"
info "Node.js: v$NODE_VERSION"
info "npm: $(npm --version)"

bold "2/5 · Choose installation folder"
printf 'Default: %s\n' "$GULZ_DEFAULT_DIR"
read -r -p "Install folder [press Enter to accept]: " chosen_dir </dev/tty || true
INSTALL_DIR="${chosen_dir:-$GULZ_DEFAULT_DIR}"
case "$INSTALL_DIR" in "~/"*) INSTALL_DIR="$HOME/${INSTALL_DIR#~/}" ;; esac
INSTALL_DIR="$(mkdir -p "$(dirname "$INSTALL_DIR")" && cd "$(dirname "$INSTALL_DIR")" && pwd)/$(basename "$INSTALL_DIR")"
[ "$INSTALL_DIR" != "$HOME" ] && [ "$INSTALL_DIR" != "/" ] || fail "Choose a dedicated folder, not your home directory or filesystem root."
if [ -e "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR/.git" ]; then
  fail "The selected folder exists but is not a GULZ Git checkout: $INSTALL_DIR"
fi
printf 'GULZ source will be stored at: %s\n' "$INSTALL_DIR"

bold "3/5 · Review installation"
printf 'The installer will clone or fast-forward the GULZ repository, install only CLI workspace dependencies (including TypeScript), build the CLI and create a user-level command link. The website and Wrangler/Workerd are excluded.\n'
printf 'It may use sudo only if you explicitly approve installing a missing Git package. It will not run GULZ operations on your files or install a background service.\n'
ask_yes_no "Continue with installation?" || { printf 'Installation cancelled.\n'; exit 0; }

bold "4/5 · Download and build"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  git clone --depth 1 "$GULZ_REPO" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
if [ "$PLATFORM" = "termux" ]; then
  GULZ_BIN_DIR="$(npm config get prefix)/bin"
  mkdir -p "$GULZ_BIN_DIR"
  npm run install:cli
else
  GULZ_BIN_DIR="$HOME/.local/bin"
  mkdir -p "$GULZ_BIN_DIR"
  NPM_CONFIG_PREFIX="$HOME/.local" npm run install:cli
fi

bold "5/5 · Verify the gulz command"
case ":$PATH:" in
  *":$GULZ_BIN_DIR:"*) ;;
  *)
    warn "$GULZ_BIN_DIR is not currently in PATH."
    PROFILE="$HOME/.profile"
    case "${SHELL:-/bin/bash}" in */zsh) PROFILE="$HOME/.zprofile" ;; */bash) PROFILE="$HOME/.bashrc" ;; esac
    if ask_yes_no "Add $GULZ_BIN_DIR to PATH in $PROFILE?"; then
      touch "$PROFILE"
      if ! grep -Fq "$GULZ_BIN_DIR" "$PROFILE"; then
        printf '\n# GULZ command-line tools\nexport PATH="%s:$PATH"\n' "$GULZ_BIN_DIR" >> "$PROFILE"
      fi
      export PATH="$GULZ_BIN_DIR:$PATH"
      info "Updated $PROFILE. The PATH change is active in this installer session."
    else
      printf 'You can add this line to your shell profile later:\n  export PATH="%s:$PATH"\n' "$GULZ_BIN_DIR"
    fi
    ;;
esac

printf '\n'
if command_exists gulz; then
  gulz --version
  printf '\n'
  gulz doctor || warn "The CLI installed, but its local doctor check reported an issue."
else
  warn "The command is not on PATH in this terminal yet. Add $GULZ_BIN_DIR to PATH, reopen the terminal, then run gulz."
fi

bold "Installation finished"
printf 'Run: gulz\n'
printf 'Update later: gulz update (source-checkout preview only; requires a clean Git checkout)\n'
printf 'Install folder: %s\n' "$INSTALL_DIR"
printf 'Your local GULZ data is stored separately in ~/.gulz.\n'
printf 'This is an early developer preview; AI goal execution and remote SSH orchestration are not available yet.\n'
\033[2m'; CYAN=
ask_yes_no() {
  local prompt="$1" answer="" answer_lc=""
  while true; do
    read -r -p "$prompt [y/N] " answer </dev/tty || true
    answer_lc="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"
    case "$answer_lc" in y|yes) return 0 ;; n|no|"") return 1 ;; *) printf 'Please answer y or n.\n' ;; esac
  done
}
command_exists() { command -v "$1" >/dev/null 2>&1; }

[ -t 1 ] || fail "Run this installer in an interactive terminal; it asks before making changes."
[ -r /dev/tty ] || fail "An interactive terminal is required. Download the script and run it from a terminal."

case "$(uname -s 2>/dev/null || echo unknown)" in
  Linux*)
    if [ -n "${PREFIX:-}" ] && [[ "$PREFIX" == *com.termux* ]]; then PLATFORM="termux"; else PLATFORM="linux"; fi
    ;;
  Darwin*) PLATFORM="macos" ;;
  *) fail "This Bash installer supports Termux, Linux, macOS and Linux-based VPS hosts. Use the Windows PowerShell guide on Windows." ;;
esac

bold "GULZ — Goals. Executed."
printf 'Interactive source installer · %s\n' "$PLATFORM"
printf 'This installs the current CLI developer preview from the public source repository.\n'
printf 'It does not install a native Android or desktop app.\n'

if [ "$PLATFORM" = "termux" ]; then
  info "Detected Termux. Installation stays inside your Termux environment."
elif [ "$PLATFORM" = "linux" ]; then
  info "Detected Linux. This also works on a VPS when run as your normal user."
else
  info "Detected macOS."
fi

if [ "$(id -u)" -eq 0 ]; then
  warn "Running as root is not recommended. GULZ should be installed and run as a normal user."
  ask_yes_no "Continue anyway?" || exit 0
fi

bold "1/5 · Check prerequisites"
if ! command_exists git; then
  case "$PLATFORM" in
    termux) INSTALL_CMD="pkg install git" ;;
    linux)
      if command_exists apt-get; then INSTALL_CMD="sudo apt-get update && sudo apt-get install -y git"
      elif command_exists dnf; then INSTALL_CMD="sudo dnf install -y git"
      elif command_exists pacman; then INSTALL_CMD="sudo pacman -S --needed git"
      elif command_exists zypper; then INSTALL_CMD="sudo zypper install git"
      else fail "Git is missing. Install Git with your distribution's package manager, then rerun this installer."; fi
      ;;
    macos) INSTALL_CMD="xcode-select --install (or install Git with Homebrew)" ;;
  esac
  printf 'Git is not installed. Suggested command: %s\n' "$INSTALL_CMD"
  ask_yes_no "May this installer attempt to install Git now?" || fail "Install Git, then rerun this installer."
  case "$PLATFORM" in
    termux) pkg install -y git ;;
    linux)
      if command_exists apt-get; then sudo apt-get update && sudo apt-get install -y git
      elif command_exists dnf; then sudo dnf install -y git
      elif command_exists pacman; then sudo pacman -S --needed git
      else sudo zypper install -y git; fi
      ;;
    macos) xcode-select --install || true; fail "Finish the Git/Xcode command-line tools installation, then rerun this installer." ;;
  esac
fi

if ! command_exists node || ! command_exists npm; then
  if [ "$PLATFORM" = "termux" ]; then
    printf 'Node.js/npm are missing. Termux can install them with: pkg install nodejs-lts\n'
    ask_yes_no "Install Node.js LTS now?" || fail "Install Node.js LTS, then rerun this installer."
    pkg install -y nodejs-lts
  else
    fail "Node.js 20.19+ and npm are required. Install the current Node.js LTS from https://nodejs.org/en/download, then rerun this installer. No system-wide Node installer will be run automatically."
  fi
fi

NODE_VERSION="$(node -p 'process.versions.node' 2>/dev/null || true)"
node -e 'const [a,b,c]=process.versions.node.split(".").map(Number); process.exit(a>20 || (a===20 && (b>19 || (b===19 && c>=0))) ? 0 : 1)' || fail "Node.js 20.19.0 or newer is required (found v$NODE_VERSION). Upgrade Node.js and rerun."
info "Git: $(git --version)"
info "Node.js: v$NODE_VERSION"
info "npm: $(npm --version)"

bold "2/5 · Choose installation folder"
printf 'Default: %s\n' "$GULZ_DEFAULT_DIR"
read -r -p "Install folder [press Enter to accept]: " chosen_dir </dev/tty || true
INSTALL_DIR="${chosen_dir:-$GULZ_DEFAULT_DIR}"
case "$INSTALL_DIR" in "~/"*) INSTALL_DIR="$HOME/${INSTALL_DIR#~/}" ;; esac
INSTALL_DIR="$(mkdir -p "$(dirname "$INSTALL_DIR")" && cd "$(dirname "$INSTALL_DIR")" && pwd)/$(basename "$INSTALL_DIR")"
[ "$INSTALL_DIR" != "$HOME" ] && [ "$INSTALL_DIR" != "/" ] || fail "Choose a dedicated folder, not your home directory or filesystem root."
if [ -e "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR/.git" ]; then
  fail "The selected folder exists but is not a GULZ Git checkout: $INSTALL_DIR"
fi
printf 'GULZ source will be stored at: %s\n' "$INSTALL_DIR"

bold "3/5 · Review installation"
printf 'The installer will clone or fast-forward the GULZ repository, install only CLI workspace dependencies (including TypeScript), build the CLI and create a user-level command link. The website and Wrangler/Workerd are excluded.\n'
printf 'It may use sudo only if you explicitly approve installing a missing Git package. It will not run GULZ operations on your files or install a background service.\n'
ask_yes_no "Continue with installation?" || { printf 'Installation cancelled.\n'; exit 0; }

bold "4/5 · Download and build"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  git clone --depth 1 "$GULZ_REPO" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
if [ "$PLATFORM" = "termux" ]; then
  GULZ_BIN_DIR="$(npm config get prefix)/bin"
  mkdir -p "$GULZ_BIN_DIR"
  npm run install:cli
else
  GULZ_BIN_DIR="$HOME/.local/bin"
  mkdir -p "$GULZ_BIN_DIR"
  NPM_CONFIG_PREFIX="$HOME/.local" npm run install:cli
fi

bold "5/5 · Verify the gulz command"
case ":$PATH:" in
  *":$GULZ_BIN_DIR:"*) ;;
  *)
    warn "$GULZ_BIN_DIR is not currently in PATH."
    PROFILE="$HOME/.profile"
    case "${SHELL:-/bin/bash}" in */zsh) PROFILE="$HOME/.zprofile" ;; */bash) PROFILE="$HOME/.bashrc" ;; esac
    if ask_yes_no "Add $GULZ_BIN_DIR to PATH in $PROFILE?"; then
      touch "$PROFILE"
      if ! grep -Fq "$GULZ_BIN_DIR" "$PROFILE"; then
        printf '\n# GULZ command-line tools\nexport PATH="%s:$PATH"\n' "$GULZ_BIN_DIR" >> "$PROFILE"
      fi
      export PATH="$GULZ_BIN_DIR:$PATH"
      info "Updated $PROFILE. The PATH change is active in this installer session."
    else
      printf 'You can add this line to your shell profile later:\n  export PATH="%s:$PATH"\n' "$GULZ_BIN_DIR"
    fi
    ;;
esac

printf '\n'
if command_exists gulz; then
  gulz --version
  printf '\n'
  gulz doctor || warn "The CLI installed, but its local doctor check reported an issue."
else
  warn "The command is not on PATH in this terminal yet. Add $GULZ_BIN_DIR to PATH, reopen the terminal, then run gulz."
fi

bold "Installation finished"
printf 'Run: gulz\n'
printf 'Update later: gulz update (source-checkout preview only; requires a clean Git checkout)\n'
printf 'Install folder: %s\n' "$INSTALL_DIR"
printf 'Your local GULZ data is stored separately in ~/.gulz.\n'
printf 'This is an early developer preview; AI goal execution and remote SSH orchestration are not available yet.\n'
\033[36m'; GREEN=
ask_yes_no() {
  local prompt="$1" answer="" answer_lc=""
  while true; do
    read -r -p "$prompt [y/N] " answer </dev/tty || true
    answer_lc="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"
    case "$answer_lc" in y|yes) return 0 ;; n|no|"") return 1 ;; *) printf 'Please answer y or n.\n' ;; esac
  done
}
command_exists() { command -v "$1" >/dev/null 2>&1; }

[ -t 1 ] || fail "Run this installer in an interactive terminal; it asks before making changes."
[ -r /dev/tty ] || fail "An interactive terminal is required. Download the script and run it from a terminal."

case "$(uname -s 2>/dev/null || echo unknown)" in
  Linux*)
    if [ -n "${PREFIX:-}" ] && [[ "$PREFIX" == *com.termux* ]]; then PLATFORM="termux"; else PLATFORM="linux"; fi
    ;;
  Darwin*) PLATFORM="macos" ;;
  *) fail "This Bash installer supports Termux, Linux, macOS and Linux-based VPS hosts. Use the Windows PowerShell guide on Windows." ;;
esac

bold "GULZ — Goals. Executed."
printf 'Interactive source installer · %s\n' "$PLATFORM"
printf 'This installs the current CLI developer preview from the public source repository.\n'
printf 'It does not install a native Android or desktop app.\n'

if [ "$PLATFORM" = "termux" ]; then
  info "Detected Termux. Installation stays inside your Termux environment."
elif [ "$PLATFORM" = "linux" ]; then
  info "Detected Linux. This also works on a VPS when run as your normal user."
else
  info "Detected macOS."
fi

if [ "$(id -u)" -eq 0 ]; then
  warn "Running as root is not recommended. GULZ should be installed and run as a normal user."
  ask_yes_no "Continue anyway?" || exit 0
fi

bold "1/5 · Check prerequisites"
if ! command_exists git; then
  case "$PLATFORM" in
    termux) INSTALL_CMD="pkg install git" ;;
    linux)
      if command_exists apt-get; then INSTALL_CMD="sudo apt-get update && sudo apt-get install -y git"
      elif command_exists dnf; then INSTALL_CMD="sudo dnf install -y git"
      elif command_exists pacman; then INSTALL_CMD="sudo pacman -S --needed git"
      elif command_exists zypper; then INSTALL_CMD="sudo zypper install git"
      else fail "Git is missing. Install Git with your distribution's package manager, then rerun this installer."; fi
      ;;
    macos) INSTALL_CMD="xcode-select --install (or install Git with Homebrew)" ;;
  esac
  printf 'Git is not installed. Suggested command: %s\n' "$INSTALL_CMD"
  ask_yes_no "May this installer attempt to install Git now?" || fail "Install Git, then rerun this installer."
  case "$PLATFORM" in
    termux) pkg install -y git ;;
    linux)
      if command_exists apt-get; then sudo apt-get update && sudo apt-get install -y git
      elif command_exists dnf; then sudo dnf install -y git
      elif command_exists pacman; then sudo pacman -S --needed git
      else sudo zypper install -y git; fi
      ;;
    macos) xcode-select --install || true; fail "Finish the Git/Xcode command-line tools installation, then rerun this installer." ;;
  esac
fi

if ! command_exists node || ! command_exists npm; then
  if [ "$PLATFORM" = "termux" ]; then
    printf 'Node.js/npm are missing. Termux can install them with: pkg install nodejs-lts\n'
    ask_yes_no "Install Node.js LTS now?" || fail "Install Node.js LTS, then rerun this installer."
    pkg install -y nodejs-lts
  else
    fail "Node.js 20.19+ and npm are required. Install the current Node.js LTS from https://nodejs.org/en/download, then rerun this installer. No system-wide Node installer will be run automatically."
  fi
fi

NODE_VERSION="$(node -p 'process.versions.node' 2>/dev/null || true)"
node -e 'const [a,b,c]=process.versions.node.split(".").map(Number); process.exit(a>20 || (a===20 && (b>19 || (b===19 && c>=0))) ? 0 : 1)' || fail "Node.js 20.19.0 or newer is required (found v$NODE_VERSION). Upgrade Node.js and rerun."
info "Git: $(git --version)"
info "Node.js: v$NODE_VERSION"
info "npm: $(npm --version)"

bold "2/5 · Choose installation folder"
printf 'Default: %s\n' "$GULZ_DEFAULT_DIR"
read -r -p "Install folder [press Enter to accept]: " chosen_dir </dev/tty || true
INSTALL_DIR="${chosen_dir:-$GULZ_DEFAULT_DIR}"
case "$INSTALL_DIR" in "~/"*) INSTALL_DIR="$HOME/${INSTALL_DIR#~/}" ;; esac
INSTALL_DIR="$(mkdir -p "$(dirname "$INSTALL_DIR")" && cd "$(dirname "$INSTALL_DIR")" && pwd)/$(basename "$INSTALL_DIR")"
[ "$INSTALL_DIR" != "$HOME" ] && [ "$INSTALL_DIR" != "/" ] || fail "Choose a dedicated folder, not your home directory or filesystem root."
if [ -e "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR/.git" ]; then
  fail "The selected folder exists but is not a GULZ Git checkout: $INSTALL_DIR"
fi
printf 'GULZ source will be stored at: %s\n' "$INSTALL_DIR"

bold "3/5 · Review installation"
printf 'The installer will clone or fast-forward the GULZ repository, install only CLI workspace dependencies (including TypeScript), build the CLI and create a user-level command link. The website and Wrangler/Workerd are excluded.\n'
printf 'It may use sudo only if you explicitly approve installing a missing Git package. It will not run GULZ operations on your files or install a background service.\n'
ask_yes_no "Continue with installation?" || { printf 'Installation cancelled.\n'; exit 0; }

bold "4/5 · Download and build"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  git clone --depth 1 "$GULZ_REPO" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
if [ "$PLATFORM" = "termux" ]; then
  GULZ_BIN_DIR="$(npm config get prefix)/bin"
  mkdir -p "$GULZ_BIN_DIR"
  npm run install:cli
else
  GULZ_BIN_DIR="$HOME/.local/bin"
  mkdir -p "$GULZ_BIN_DIR"
  NPM_CONFIG_PREFIX="$HOME/.local" npm run install:cli
fi

bold "5/5 · Verify the gulz command"
case ":$PATH:" in
  *":$GULZ_BIN_DIR:"*) ;;
  *)
    warn "$GULZ_BIN_DIR is not currently in PATH."
    PROFILE="$HOME/.profile"
    case "${SHELL:-/bin/bash}" in */zsh) PROFILE="$HOME/.zprofile" ;; */bash) PROFILE="$HOME/.bashrc" ;; esac
    if ask_yes_no "Add $GULZ_BIN_DIR to PATH in $PROFILE?"; then
      touch "$PROFILE"
      if ! grep -Fq "$GULZ_BIN_DIR" "$PROFILE"; then
        printf '\n# GULZ command-line tools\nexport PATH="%s:$PATH"\n' "$GULZ_BIN_DIR" >> "$PROFILE"
      fi
      export PATH="$GULZ_BIN_DIR:$PATH"
      info "Updated $PROFILE. The PATH change is active in this installer session."
    else
      printf 'You can add this line to your shell profile later:\n  export PATH="%s:$PATH"\n' "$GULZ_BIN_DIR"
    fi
    ;;
esac

printf '\n'
if command_exists gulz; then
  gulz --version
  printf '\n'
  gulz doctor || warn "The CLI installed, but its local doctor check reported an issue."
else
  warn "The command is not on PATH in this terminal yet. Add $GULZ_BIN_DIR to PATH, reopen the terminal, then run gulz."
fi

bold "Installation finished"
printf 'Run: gulz\n'
printf 'Update later: gulz update (source-checkout preview only; requires a clean Git checkout)\n'
printf 'Install folder: %s\n' "$INSTALL_DIR"
printf 'Your local GULZ data is stored separately in ~/.gulz.\n'
printf 'This is an early developer preview; AI goal execution and remote SSH orchestration are not available yet.\n'
\033[32m'; YELLOW=
ask_yes_no() {
  local prompt="$1" answer="" answer_lc=""
  while true; do
    read -r -p "$prompt [y/N] " answer </dev/tty || true
    answer_lc="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"
    case "$answer_lc" in y|yes) return 0 ;; n|no|"") return 1 ;; *) printf 'Please answer y or n.\n' ;; esac
  done
}
command_exists() { command -v "$1" >/dev/null 2>&1; }

[ -t 1 ] || fail "Run this installer in an interactive terminal; it asks before making changes."
[ -r /dev/tty ] || fail "An interactive terminal is required. Download the script and run it from a terminal."

case "$(uname -s 2>/dev/null || echo unknown)" in
  Linux*)
    if [ -n "${PREFIX:-}" ] && [[ "$PREFIX" == *com.termux* ]]; then PLATFORM="termux"; else PLATFORM="linux"; fi
    ;;
  Darwin*) PLATFORM="macos" ;;
  *) fail "This Bash installer supports Termux, Linux, macOS and Linux-based VPS hosts. Use the Windows PowerShell guide on Windows." ;;
esac

bold "GULZ — Goals. Executed."
printf 'Interactive source installer · %s\n' "$PLATFORM"
printf 'This installs the current CLI developer preview from the public source repository.\n'
printf 'It does not install a native Android or desktop app.\n'

if [ "$PLATFORM" = "termux" ]; then
  info "Detected Termux. Installation stays inside your Termux environment."
elif [ "$PLATFORM" = "linux" ]; then
  info "Detected Linux. This also works on a VPS when run as your normal user."
else
  info "Detected macOS."
fi

if [ "$(id -u)" -eq 0 ]; then
  warn "Running as root is not recommended. GULZ should be installed and run as a normal user."
  ask_yes_no "Continue anyway?" || exit 0
fi

bold "1/5 · Check prerequisites"
if ! command_exists git; then
  case "$PLATFORM" in
    termux) INSTALL_CMD="pkg install git" ;;
    linux)
      if command_exists apt-get; then INSTALL_CMD="sudo apt-get update && sudo apt-get install -y git"
      elif command_exists dnf; then INSTALL_CMD="sudo dnf install -y git"
      elif command_exists pacman; then INSTALL_CMD="sudo pacman -S --needed git"
      elif command_exists zypper; then INSTALL_CMD="sudo zypper install git"
      else fail "Git is missing. Install Git with your distribution's package manager, then rerun this installer."; fi
      ;;
    macos) INSTALL_CMD="xcode-select --install (or install Git with Homebrew)" ;;
  esac
  printf 'Git is not installed. Suggested command: %s\n' "$INSTALL_CMD"
  ask_yes_no "May this installer attempt to install Git now?" || fail "Install Git, then rerun this installer."
  case "$PLATFORM" in
    termux) pkg install -y git ;;
    linux)
      if command_exists apt-get; then sudo apt-get update && sudo apt-get install -y git
      elif command_exists dnf; then sudo dnf install -y git
      elif command_exists pacman; then sudo pacman -S --needed git
      else sudo zypper install -y git; fi
      ;;
    macos) xcode-select --install || true; fail "Finish the Git/Xcode command-line tools installation, then rerun this installer." ;;
  esac
fi

if ! command_exists node || ! command_exists npm; then
  if [ "$PLATFORM" = "termux" ]; then
    printf 'Node.js/npm are missing. Termux can install them with: pkg install nodejs-lts\n'
    ask_yes_no "Install Node.js LTS now?" || fail "Install Node.js LTS, then rerun this installer."
    pkg install -y nodejs-lts
  else
    fail "Node.js 20.19+ and npm are required. Install the current Node.js LTS from https://nodejs.org/en/download, then rerun this installer. No system-wide Node installer will be run automatically."
  fi
fi

NODE_VERSION="$(node -p 'process.versions.node' 2>/dev/null || true)"
node -e 'const [a,b,c]=process.versions.node.split(".").map(Number); process.exit(a>20 || (a===20 && (b>19 || (b===19 && c>=0))) ? 0 : 1)' || fail "Node.js 20.19.0 or newer is required (found v$NODE_VERSION). Upgrade Node.js and rerun."
info "Git: $(git --version)"
info "Node.js: v$NODE_VERSION"
info "npm: $(npm --version)"

bold "2/5 · Choose installation folder"
printf 'Default: %s\n' "$GULZ_DEFAULT_DIR"
read -r -p "Install folder [press Enter to accept]: " chosen_dir </dev/tty || true
INSTALL_DIR="${chosen_dir:-$GULZ_DEFAULT_DIR}"
case "$INSTALL_DIR" in "~/"*) INSTALL_DIR="$HOME/${INSTALL_DIR#~/}" ;; esac
INSTALL_DIR="$(mkdir -p "$(dirname "$INSTALL_DIR")" && cd "$(dirname "$INSTALL_DIR")" && pwd)/$(basename "$INSTALL_DIR")"
[ "$INSTALL_DIR" != "$HOME" ] && [ "$INSTALL_DIR" != "/" ] || fail "Choose a dedicated folder, not your home directory or filesystem root."
if [ -e "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR/.git" ]; then
  fail "The selected folder exists but is not a GULZ Git checkout: $INSTALL_DIR"
fi
printf 'GULZ source will be stored at: %s\n' "$INSTALL_DIR"

bold "3/5 · Review installation"
printf 'The installer will clone or fast-forward the GULZ repository, install only CLI workspace dependencies (including TypeScript), build the CLI and create a user-level command link. The website and Wrangler/Workerd are excluded.\n'
printf 'It may use sudo only if you explicitly approve installing a missing Git package. It will not run GULZ operations on your files or install a background service.\n'
ask_yes_no "Continue with installation?" || { printf 'Installation cancelled.\n'; exit 0; }

bold "4/5 · Download and build"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  git clone --depth 1 "$GULZ_REPO" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
if [ "$PLATFORM" = "termux" ]; then
  GULZ_BIN_DIR="$(npm config get prefix)/bin"
  mkdir -p "$GULZ_BIN_DIR"
  npm run install:cli
else
  GULZ_BIN_DIR="$HOME/.local/bin"
  mkdir -p "$GULZ_BIN_DIR"
  NPM_CONFIG_PREFIX="$HOME/.local" npm run install:cli
fi

bold "5/5 · Verify the gulz command"
case ":$PATH:" in
  *":$GULZ_BIN_DIR:"*) ;;
  *)
    warn "$GULZ_BIN_DIR is not currently in PATH."
    PROFILE="$HOME/.profile"
    case "${SHELL:-/bin/bash}" in */zsh) PROFILE="$HOME/.zprofile" ;; */bash) PROFILE="$HOME/.bashrc" ;; esac
    if ask_yes_no "Add $GULZ_BIN_DIR to PATH in $PROFILE?"; then
      touch "$PROFILE"
      if ! grep -Fq "$GULZ_BIN_DIR" "$PROFILE"; then
        printf '\n# GULZ command-line tools\nexport PATH="%s:$PATH"\n' "$GULZ_BIN_DIR" >> "$PROFILE"
      fi
      export PATH="$GULZ_BIN_DIR:$PATH"
      info "Updated $PROFILE. The PATH change is active in this installer session."
    else
      printf 'You can add this line to your shell profile later:\n  export PATH="%s:$PATH"\n' "$GULZ_BIN_DIR"
    fi
    ;;
esac

printf '\n'
if command_exists gulz; then
  gulz --version
  printf '\n'
  gulz doctor || warn "The CLI installed, but its local doctor check reported an issue."
else
  warn "The command is not on PATH in this terminal yet. Add $GULZ_BIN_DIR to PATH, reopen the terminal, then run gulz."
fi

bold "Installation finished"
printf 'Run: gulz\n'
printf 'Update later: gulz update (source-checkout preview only; requires a clean Git checkout)\n'
printf 'Install folder: %s\n' "$INSTALL_DIR"
printf 'Your local GULZ data is stored separately in ~/.gulz.\n'
printf 'This is an early developer preview; AI goal execution and remote SSH orchestration are not available yet.\n'
\033[33m'; RED=
ask_yes_no() {
  local prompt="$1" answer="" answer_lc=""
  while true; do
    read -r -p "$prompt [y/N] " answer </dev/tty || true
    answer_lc="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"
    case "$answer_lc" in y|yes) return 0 ;; n|no|"") return 1 ;; *) printf 'Please answer y or n.\n' ;; esac
  done
}
command_exists() { command -v "$1" >/dev/null 2>&1; }

[ -t 1 ] || fail "Run this installer in an interactive terminal; it asks before making changes."
[ -r /dev/tty ] || fail "An interactive terminal is required. Download the script and run it from a terminal."

case "$(uname -s 2>/dev/null || echo unknown)" in
  Linux*)
    if [ -n "${PREFIX:-}" ] && [[ "$PREFIX" == *com.termux* ]]; then PLATFORM="termux"; else PLATFORM="linux"; fi
    ;;
  Darwin*) PLATFORM="macos" ;;
  *) fail "This Bash installer supports Termux, Linux, macOS and Linux-based VPS hosts. Use the Windows PowerShell guide on Windows." ;;
esac

bold "GULZ — Goals. Executed."
printf 'Interactive source installer · %s\n' "$PLATFORM"
printf 'This installs the current CLI developer preview from the public source repository.\n'
printf 'It does not install a native Android or desktop app.\n'

if [ "$PLATFORM" = "termux" ]; then
  info "Detected Termux. Installation stays inside your Termux environment."
elif [ "$PLATFORM" = "linux" ]; then
  info "Detected Linux. This also works on a VPS when run as your normal user."
else
  info "Detected macOS."
fi

if [ "$(id -u)" -eq 0 ]; then
  warn "Running as root is not recommended. GULZ should be installed and run as a normal user."
  ask_yes_no "Continue anyway?" || exit 0
fi

bold "1/5 · Check prerequisites"
if ! command_exists git; then
  case "$PLATFORM" in
    termux) INSTALL_CMD="pkg install git" ;;
    linux)
      if command_exists apt-get; then INSTALL_CMD="sudo apt-get update && sudo apt-get install -y git"
      elif command_exists dnf; then INSTALL_CMD="sudo dnf install -y git"
      elif command_exists pacman; then INSTALL_CMD="sudo pacman -S --needed git"
      elif command_exists zypper; then INSTALL_CMD="sudo zypper install git"
      else fail "Git is missing. Install Git with your distribution's package manager, then rerun this installer."; fi
      ;;
    macos) INSTALL_CMD="xcode-select --install (or install Git with Homebrew)" ;;
  esac
  printf 'Git is not installed. Suggested command: %s\n' "$INSTALL_CMD"
  ask_yes_no "May this installer attempt to install Git now?" || fail "Install Git, then rerun this installer."
  case "$PLATFORM" in
    termux) pkg install -y git ;;
    linux)
      if command_exists apt-get; then sudo apt-get update && sudo apt-get install -y git
      elif command_exists dnf; then sudo dnf install -y git
      elif command_exists pacman; then sudo pacman -S --needed git
      else sudo zypper install -y git; fi
      ;;
    macos) xcode-select --install || true; fail "Finish the Git/Xcode command-line tools installation, then rerun this installer." ;;
  esac
fi

if ! command_exists node || ! command_exists npm; then
  if [ "$PLATFORM" = "termux" ]; then
    printf 'Node.js/npm are missing. Termux can install them with: pkg install nodejs-lts\n'
    ask_yes_no "Install Node.js LTS now?" || fail "Install Node.js LTS, then rerun this installer."
    pkg install -y nodejs-lts
  else
    fail "Node.js 20.19+ and npm are required. Install the current Node.js LTS from https://nodejs.org/en/download, then rerun this installer. No system-wide Node installer will be run automatically."
  fi
fi

NODE_VERSION="$(node -p 'process.versions.node' 2>/dev/null || true)"
node -e 'const [a,b,c]=process.versions.node.split(".").map(Number); process.exit(a>20 || (a===20 && (b>19 || (b===19 && c>=0))) ? 0 : 1)' || fail "Node.js 20.19.0 or newer is required (found v$NODE_VERSION). Upgrade Node.js and rerun."
info "Git: $(git --version)"
info "Node.js: v$NODE_VERSION"
info "npm: $(npm --version)"

bold "2/5 · Choose installation folder"
printf 'Default: %s\n' "$GULZ_DEFAULT_DIR"
read -r -p "Install folder [press Enter to accept]: " chosen_dir </dev/tty || true
INSTALL_DIR="${chosen_dir:-$GULZ_DEFAULT_DIR}"
case "$INSTALL_DIR" in "~/"*) INSTALL_DIR="$HOME/${INSTALL_DIR#~/}" ;; esac
INSTALL_DIR="$(mkdir -p "$(dirname "$INSTALL_DIR")" && cd "$(dirname "$INSTALL_DIR")" && pwd)/$(basename "$INSTALL_DIR")"
[ "$INSTALL_DIR" != "$HOME" ] && [ "$INSTALL_DIR" != "/" ] || fail "Choose a dedicated folder, not your home directory or filesystem root."
if [ -e "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR/.git" ]; then
  fail "The selected folder exists but is not a GULZ Git checkout: $INSTALL_DIR"
fi
printf 'GULZ source will be stored at: %s\n' "$INSTALL_DIR"

bold "3/5 · Review installation"
printf 'The installer will clone or fast-forward the GULZ repository, install only CLI workspace dependencies (including TypeScript), build the CLI and create a user-level command link. The website and Wrangler/Workerd are excluded.\n'
printf 'It may use sudo only if you explicitly approve installing a missing Git package. It will not run GULZ operations on your files or install a background service.\n'
ask_yes_no "Continue with installation?" || { printf 'Installation cancelled.\n'; exit 0; }

bold "4/5 · Download and build"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  git clone --depth 1 "$GULZ_REPO" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
if [ "$PLATFORM" = "termux" ]; then
  GULZ_BIN_DIR="$(npm config get prefix)/bin"
  mkdir -p "$GULZ_BIN_DIR"
  npm run install:cli
else
  GULZ_BIN_DIR="$HOME/.local/bin"
  mkdir -p "$GULZ_BIN_DIR"
  NPM_CONFIG_PREFIX="$HOME/.local" npm run install:cli
fi

bold "5/5 · Verify the gulz command"
case ":$PATH:" in
  *":$GULZ_BIN_DIR:"*) ;;
  *)
    warn "$GULZ_BIN_DIR is not currently in PATH."
    PROFILE="$HOME/.profile"
    case "${SHELL:-/bin/bash}" in */zsh) PROFILE="$HOME/.zprofile" ;; */bash) PROFILE="$HOME/.bashrc" ;; esac
    if ask_yes_no "Add $GULZ_BIN_DIR to PATH in $PROFILE?"; then
      touch "$PROFILE"
      if ! grep -Fq "$GULZ_BIN_DIR" "$PROFILE"; then
        printf '\n# GULZ command-line tools\nexport PATH="%s:$PATH"\n' "$GULZ_BIN_DIR" >> "$PROFILE"
      fi
      export PATH="$GULZ_BIN_DIR:$PATH"
      info "Updated $PROFILE. The PATH change is active in this installer session."
    else
      printf 'You can add this line to your shell profile later:\n  export PATH="%s:$PATH"\n' "$GULZ_BIN_DIR"
    fi
    ;;
esac

printf '\n'
if command_exists gulz; then
  gulz --version
  printf '\n'
  gulz doctor || warn "The CLI installed, but its local doctor check reported an issue."
else
  warn "The command is not on PATH in this terminal yet. Add $GULZ_BIN_DIR to PATH, reopen the terminal, then run gulz."
fi

bold "Installation finished"
printf 'Run: gulz\n'
printf 'Update later: gulz update (source-checkout preview only; requires a clean Git checkout)\n'
printf 'Install folder: %s\n' "$INSTALL_DIR"
printf 'Your local GULZ data is stored separately in ~/.gulz.\n'
printf 'This is an early developer preview; AI goal execution and remote SSH orchestration are not available yet.\n'
\033[31m'; RESET=
ask_yes_no() {
  local prompt="$1" answer="" answer_lc=""
  while true; do
    read -r -p "$prompt [y/N] " answer </dev/tty || true
    answer_lc="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"
    case "$answer_lc" in y|yes) return 0 ;; n|no|"") return 1 ;; *) printf 'Please answer y or n.\n' ;; esac
  done
}
command_exists() { command -v "$1" >/dev/null 2>&1; }

[ -t 1 ] || fail "Run this installer in an interactive terminal; it asks before making changes."
[ -r /dev/tty ] || fail "An interactive terminal is required. Download the script and run it from a terminal."

case "$(uname -s 2>/dev/null || echo unknown)" in
  Linux*)
    if [ -n "${PREFIX:-}" ] && [[ "$PREFIX" == *com.termux* ]]; then PLATFORM="termux"; else PLATFORM="linux"; fi
    ;;
  Darwin*) PLATFORM="macos" ;;
  *) fail "This Bash installer supports Termux, Linux, macOS and Linux-based VPS hosts. Use the Windows PowerShell guide on Windows." ;;
esac

bold "GULZ — Goals. Executed."
printf 'Interactive source installer · %s\n' "$PLATFORM"
printf 'This installs the current CLI developer preview from the public source repository.\n'
printf 'It does not install a native Android or desktop app.\n'

if [ "$PLATFORM" = "termux" ]; then
  info "Detected Termux. Installation stays inside your Termux environment."
elif [ "$PLATFORM" = "linux" ]; then
  info "Detected Linux. This also works on a VPS when run as your normal user."
else
  info "Detected macOS."
fi

if [ "$(id -u)" -eq 0 ]; then
  warn "Running as root is not recommended. GULZ should be installed and run as a normal user."
  ask_yes_no "Continue anyway?" || exit 0
fi

bold "1/5 · Check prerequisites"
if ! command_exists git; then
  case "$PLATFORM" in
    termux) INSTALL_CMD="pkg install git" ;;
    linux)
      if command_exists apt-get; then INSTALL_CMD="sudo apt-get update && sudo apt-get install -y git"
      elif command_exists dnf; then INSTALL_CMD="sudo dnf install -y git"
      elif command_exists pacman; then INSTALL_CMD="sudo pacman -S --needed git"
      elif command_exists zypper; then INSTALL_CMD="sudo zypper install git"
      else fail "Git is missing. Install Git with your distribution's package manager, then rerun this installer."; fi
      ;;
    macos) INSTALL_CMD="xcode-select --install (or install Git with Homebrew)" ;;
  esac
  printf 'Git is not installed. Suggested command: %s\n' "$INSTALL_CMD"
  ask_yes_no "May this installer attempt to install Git now?" || fail "Install Git, then rerun this installer."
  case "$PLATFORM" in
    termux) pkg install -y git ;;
    linux)
      if command_exists apt-get; then sudo apt-get update && sudo apt-get install -y git
      elif command_exists dnf; then sudo dnf install -y git
      elif command_exists pacman; then sudo pacman -S --needed git
      else sudo zypper install -y git; fi
      ;;
    macos) xcode-select --install || true; fail "Finish the Git/Xcode command-line tools installation, then rerun this installer." ;;
  esac
fi

if ! command_exists node || ! command_exists npm; then
  if [ "$PLATFORM" = "termux" ]; then
    printf 'Node.js/npm are missing. Termux can install them with: pkg install nodejs-lts\n'
    ask_yes_no "Install Node.js LTS now?" || fail "Install Node.js LTS, then rerun this installer."
    pkg install -y nodejs-lts
  else
    fail "Node.js 20.19+ and npm are required. Install the current Node.js LTS from https://nodejs.org/en/download, then rerun this installer. No system-wide Node installer will be run automatically."
  fi
fi

NODE_VERSION="$(node -p 'process.versions.node' 2>/dev/null || true)"
node -e 'const [a,b,c]=process.versions.node.split(".").map(Number); process.exit(a>20 || (a===20 && (b>19 || (b===19 && c>=0))) ? 0 : 1)' || fail "Node.js 20.19.0 or newer is required (found v$NODE_VERSION). Upgrade Node.js and rerun."
info "Git: $(git --version)"
info "Node.js: v$NODE_VERSION"
info "npm: $(npm --version)"

bold "2/5 · Choose installation folder"
printf 'Default: %s\n' "$GULZ_DEFAULT_DIR"
read -r -p "Install folder [press Enter to accept]: " chosen_dir </dev/tty || true
INSTALL_DIR="${chosen_dir:-$GULZ_DEFAULT_DIR}"
case "$INSTALL_DIR" in "~/"*) INSTALL_DIR="$HOME/${INSTALL_DIR#~/}" ;; esac
INSTALL_DIR="$(mkdir -p "$(dirname "$INSTALL_DIR")" && cd "$(dirname "$INSTALL_DIR")" && pwd)/$(basename "$INSTALL_DIR")"
[ "$INSTALL_DIR" != "$HOME" ] && [ "$INSTALL_DIR" != "/" ] || fail "Choose a dedicated folder, not your home directory or filesystem root."
if [ -e "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR/.git" ]; then
  fail "The selected folder exists but is not a GULZ Git checkout: $INSTALL_DIR"
fi
printf 'GULZ source will be stored at: %s\n' "$INSTALL_DIR"

bold "3/5 · Review installation"
printf 'The installer will clone or fast-forward the GULZ repository, install only CLI workspace dependencies (including TypeScript), build the CLI and create a user-level command link. The website and Wrangler/Workerd are excluded.\n'
printf 'It may use sudo only if you explicitly approve installing a missing Git package. It will not run GULZ operations on your files or install a background service.\n'
ask_yes_no "Continue with installation?" || { printf 'Installation cancelled.\n'; exit 0; }

bold "4/5 · Download and build"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  git clone --depth 1 "$GULZ_REPO" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
if [ "$PLATFORM" = "termux" ]; then
  GULZ_BIN_DIR="$(npm config get prefix)/bin"
  mkdir -p "$GULZ_BIN_DIR"
  npm run install:cli
else
  GULZ_BIN_DIR="$HOME/.local/bin"
  mkdir -p "$GULZ_BIN_DIR"
  NPM_CONFIG_PREFIX="$HOME/.local" npm run install:cli
fi

bold "5/5 · Verify the gulz command"
case ":$PATH:" in
  *":$GULZ_BIN_DIR:"*) ;;
  *)
    warn "$GULZ_BIN_DIR is not currently in PATH."
    PROFILE="$HOME/.profile"
    case "${SHELL:-/bin/bash}" in */zsh) PROFILE="$HOME/.zprofile" ;; */bash) PROFILE="$HOME/.bashrc" ;; esac
    if ask_yes_no "Add $GULZ_BIN_DIR to PATH in $PROFILE?"; then
      touch "$PROFILE"
      if ! grep -Fq "$GULZ_BIN_DIR" "$PROFILE"; then
        printf '\n# GULZ command-line tools\nexport PATH="%s:$PATH"\n' "$GULZ_BIN_DIR" >> "$PROFILE"
      fi
      export PATH="$GULZ_BIN_DIR:$PATH"
      info "Updated $PROFILE. The PATH change is active in this installer session."
    else
      printf 'You can add this line to your shell profile later:\n  export PATH="%s:$PATH"\n' "$GULZ_BIN_DIR"
    fi
    ;;
esac

printf '\n'
if command_exists gulz; then
  gulz --version
  printf '\n'
  gulz doctor || warn "The CLI installed, but its local doctor check reported an issue."
else
  warn "The command is not on PATH in this terminal yet. Add $GULZ_BIN_DIR to PATH, reopen the terminal, then run gulz."
fi

bold "Installation finished"
printf 'Run: gulz\n'
printf 'Update later: gulz update (source-checkout preview only; requires a clean Git checkout)\n'
printf 'Install folder: %s\n' "$INSTALL_DIR"
printf 'Your local GULZ data is stored separately in ~/.gulz.\n'
printf 'This is an early developer preview; AI goal execution and remote SSH orchestration are not available yet.\n'
\033[0m'
else
  BOLD=""; DIM=""; CYAN=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi
bold() { printf '\n%s%s%s\n' "$BOLD" "$*" "$RESET"; }
info() { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '\n%s! %s%s\n' "$YELLOW" "$*" "$RESET" >&2; }
fail() { printf '\n%s✗ %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }
ask_yes_no() {
  local prompt="$1" answer="" answer_lc=""
  while true; do
    read -r -p "$prompt [y/N] " answer </dev/tty || true
    answer_lc="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"
    case "$answer_lc" in y|yes) return 0 ;; n|no|"") return 1 ;; *) printf 'Please answer y or n.\n' ;; esac
  done
}
command_exists() { command -v "$1" >/dev/null 2>&1; }

[ -t 1 ] || fail "Run this installer in an interactive terminal; it asks before making changes."
[ -r /dev/tty ] || fail "An interactive terminal is required. Download the script and run it from a terminal."

case "$(uname -s 2>/dev/null || echo unknown)" in
  Linux*)
    if [ -n "${PREFIX:-}" ] && [[ "$PREFIX" == *com.termux* ]]; then PLATFORM="termux"; else PLATFORM="linux"; fi
    ;;
  Darwin*) PLATFORM="macos" ;;
  *) fail "This Bash installer supports Termux, Linux, macOS and Linux-based VPS hosts. Use the Windows PowerShell guide on Windows." ;;
esac

bold "GULZ — Goals. Executed."
printf 'Interactive source installer · %s\n' "$PLATFORM"
printf 'This installs the current CLI developer preview from the public source repository.\n'
printf 'It does not install a native Android or desktop app.\n'

if [ "$PLATFORM" = "termux" ]; then
  info "Detected Termux. Installation stays inside your Termux environment."
elif [ "$PLATFORM" = "linux" ]; then
  info "Detected Linux. This also works on a VPS when run as your normal user."
else
  info "Detected macOS."
fi

if [ "$(id -u)" -eq 0 ]; then
  warn "Running as root is not recommended. GULZ should be installed and run as a normal user."
  ask_yes_no "Continue anyway?" || exit 0
fi

bold "1/5 · Check prerequisites"
if ! command_exists git; then
  case "$PLATFORM" in
    termux) INSTALL_CMD="pkg install git" ;;
    linux)
      if command_exists apt-get; then INSTALL_CMD="sudo apt-get update && sudo apt-get install -y git"
      elif command_exists dnf; then INSTALL_CMD="sudo dnf install -y git"
      elif command_exists pacman; then INSTALL_CMD="sudo pacman -S --needed git"
      elif command_exists zypper; then INSTALL_CMD="sudo zypper install git"
      else fail "Git is missing. Install Git with your distribution's package manager, then rerun this installer."; fi
      ;;
    macos) INSTALL_CMD="xcode-select --install (or install Git with Homebrew)" ;;
  esac
  printf 'Git is not installed. Suggested command: %s\n' "$INSTALL_CMD"
  ask_yes_no "May this installer attempt to install Git now?" || fail "Install Git, then rerun this installer."
  case "$PLATFORM" in
    termux) pkg install -y git ;;
    linux)
      if command_exists apt-get; then sudo apt-get update && sudo apt-get install -y git
      elif command_exists dnf; then sudo dnf install -y git
      elif command_exists pacman; then sudo pacman -S --needed git
      else sudo zypper install -y git; fi
      ;;
    macos) xcode-select --install || true; fail "Finish the Git/Xcode command-line tools installation, then rerun this installer." ;;
  esac
fi

if ! command_exists node || ! command_exists npm; then
  if [ "$PLATFORM" = "termux" ]; then
    printf 'Node.js/npm are missing. Termux can install them with: pkg install nodejs-lts\n'
    ask_yes_no "Install Node.js LTS now?" || fail "Install Node.js LTS, then rerun this installer."
    pkg install -y nodejs-lts
  else
    fail "Node.js 20.19+ and npm are required. Install the current Node.js LTS from https://nodejs.org/en/download, then rerun this installer. No system-wide Node installer will be run automatically."
  fi
fi

NODE_VERSION="$(node -p 'process.versions.node' 2>/dev/null || true)"
node -e 'const [a,b,c]=process.versions.node.split(".").map(Number); process.exit(a>20 || (a===20 && (b>19 || (b===19 && c>=0))) ? 0 : 1)' || fail "Node.js 20.19.0 or newer is required (found v$NODE_VERSION). Upgrade Node.js and rerun."
info "Git: $(git --version)"
info "Node.js: v$NODE_VERSION"
info "npm: $(npm --version)"

bold "2/5 · Choose installation folder"
printf 'Default: %s\n' "$GULZ_DEFAULT_DIR"
read -r -p "Install folder [press Enter to accept]: " chosen_dir </dev/tty || true
INSTALL_DIR="${chosen_dir:-$GULZ_DEFAULT_DIR}"
case "$INSTALL_DIR" in "~/"*) INSTALL_DIR="$HOME/${INSTALL_DIR#~/}" ;; esac
INSTALL_DIR="$(mkdir -p "$(dirname "$INSTALL_DIR")" && cd "$(dirname "$INSTALL_DIR")" && pwd)/$(basename "$INSTALL_DIR")"
[ "$INSTALL_DIR" != "$HOME" ] && [ "$INSTALL_DIR" != "/" ] || fail "Choose a dedicated folder, not your home directory or filesystem root."
if [ -e "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR/.git" ]; then
  fail "The selected folder exists but is not a GULZ Git checkout: $INSTALL_DIR"
fi
printf 'GULZ source will be stored at: %s\n' "$INSTALL_DIR"

bold "3/5 · Review installation"
printf 'The installer will clone or fast-forward the GULZ repository, install only CLI workspace dependencies (including TypeScript), build the CLI and create a user-level command link. The website and Wrangler/Workerd are excluded.\n'
printf 'It may use sudo only if you explicitly approve installing a missing Git package. It will not run GULZ operations on your files or install a background service.\n'
ask_yes_no "Continue with installation?" || { printf 'Installation cancelled.\n'; exit 0; }

bold "4/5 · Download and build"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  git clone --depth 1 "$GULZ_REPO" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
if [ "$PLATFORM" = "termux" ]; then
  GULZ_BIN_DIR="$(npm config get prefix)/bin"
  mkdir -p "$GULZ_BIN_DIR"
  npm run install:cli
else
  GULZ_BIN_DIR="$HOME/.local/bin"
  mkdir -p "$GULZ_BIN_DIR"
  NPM_CONFIG_PREFIX="$HOME/.local" npm run install:cli
fi

bold "5/5 · Verify the gulz command"
case ":$PATH:" in
  *":$GULZ_BIN_DIR:"*) ;;
  *)
    warn "$GULZ_BIN_DIR is not currently in PATH."
    PROFILE="$HOME/.profile"
    case "${SHELL:-/bin/bash}" in */zsh) PROFILE="$HOME/.zprofile" ;; */bash) PROFILE="$HOME/.bashrc" ;; esac
    if ask_yes_no "Add $GULZ_BIN_DIR to PATH in $PROFILE?"; then
      touch "$PROFILE"
      if ! grep -Fq "$GULZ_BIN_DIR" "$PROFILE"; then
        printf '\n# GULZ command-line tools\nexport PATH="%s:$PATH"\n' "$GULZ_BIN_DIR" >> "$PROFILE"
      fi
      export PATH="$GULZ_BIN_DIR:$PATH"
      info "Updated $PROFILE. The PATH change is active in this installer session."
    else
      printf 'You can add this line to your shell profile later:\n  export PATH="%s:$PATH"\n' "$GULZ_BIN_DIR"
    fi
    ;;
esac

printf '\n'
if command_exists gulz; then
  gulz --version
  printf '\n'
  gulz doctor || warn "The CLI installed, but its local doctor check reported an issue."
else
  warn "The command is not on PATH in this terminal yet. Add $GULZ_BIN_DIR to PATH, reopen the terminal, then run gulz."
fi

bold "Installation finished"
printf 'Run: gulz\n'
printf 'Update later: gulz update (source-checkout preview only; requires a clean Git checkout)\n'
printf 'Install folder: %s\n' "$INSTALL_DIR"
printf 'Your local GULZ data is stored separately in ~/.gulz.\n'
printf 'This is an early developer preview; AI goal execution and remote SSH orchestration are not available yet.\n'
