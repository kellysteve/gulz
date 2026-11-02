#!/usr/bin/env node

const args = process.argv.slice(2);
const command = args[0];

if (command === "--version" || command === "-v") {
  console.log("GULZ 0.1.0 (development scaffold)");
} else if (command === "--help" || command === "-h") {
  console.log([
    "GULZ — Goals. Executed.",
    "",
    "Usage: gulz [command]",
    "",
    "Commands:",
    "  (no command)  Open the interactive GULZ environment (not implemented yet)",
    "  --help       Show this help",
    "  --version    Show the development version",
    "",
    "GULZ is under active development. Operational commands are not available yet.",
  ].join("\n"));
} else {
  console.log("GULZ is being built. The interactive goal-execution environment is not available yet.");
  console.log("Run gulz --help to see the current development commands.");
}
