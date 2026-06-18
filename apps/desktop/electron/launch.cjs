const { spawn } = require("node:child_process");
const electronBinary = require("electron");
const path = require("node:path");

const child = spawn(electronBinary, [path.join(__dirname, "..")], {
  stdio: "inherit",
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: undefined
  }
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
