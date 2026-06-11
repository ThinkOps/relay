const assert = require("node:assert/strict");
const test = require("node:test");
const { runCli } = require("../src/cli");

async function captureStdout(callback) {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    await callback();
  } finally {
    console.log = originalLog;
  }
  return lines.join("\n");
}

test("help explains the agent operating loop", async () => {
  const output = await captureStdout(() => runCli(["--help"], {}, process.cwd()));

  assert.match(output, /Agent contract:/);
  assert.match(output, /Agent loop:/);
  assert.match(output, /RELAY_DB=\/path\/to\/control\/\.relay\/relay\.db/);
  assert.match(output, /relay agent inbox --agent dev-agent --role developer --unread --json/);
  assert.match(output, /relay agent ack 34 --agent dev-agent --role developer --json/);
  assert.match(output, /MISTRI_DB is still accepted as a legacy fallback/);
  assert.match(output, /Prefer --json for machine-readable output/);
});
