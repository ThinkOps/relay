#!/usr/bin/env node

const emitWarning = process.emitWarning;
process.emitWarning = function emitRelayWarning(warning, type, code, ctor) {
  const name = typeof warning === "object" ? warning.name : type;
  const message = typeof warning === "object" ? warning.message : String(warning);
  if (name === "ExperimentalWarning" && message.includes("SQLite")) return;
  return emitWarning.call(process, warning, type, code, ctor);
};

const { runCli } = require("../src/cli");

runCli(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
