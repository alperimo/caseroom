import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = process.cwd();
const outDir = path.join(rootDir, ".artifacts", "submission");
const logDir = path.join(outDir, "logs");
const performanceLogPath = path.join(rootDir, ".artifacts", "performance", "inference-events.jsonl");
const remoteApiManifestPath = path.join(rootDir, "remote-api-calls.json");

async function run(command, args, options = {}) {
  const startedAt = Date.now();
  try {
    const result = await execFileAsync(command, args, {
      cwd: rootDir,
      timeout: options.timeout ?? 120_000,
      maxBuffer: 1024 * 1024 * 8
    });
    return {
      ok: true,
      command: [command, ...args].join(" "),
      durationMs: Date.now() - startedAt,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    return {
      ok: false,
      command: [command, ...args].join(" "),
      durationMs: Date.now() - startedAt,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      error: error.message
    };
  }
}

async function writeLog(name, content) {
  await fs.writeFile(path.join(logDir, name), content, "utf8");
}

async function fetchJson(url) {
  try {
    const response = await fetch(url);
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json().catch(() => null)
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      body: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

await fs.mkdir(logDir, { recursive: true });

const hardware = {
  capturedAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  cpus: os.cpus().map((cpu) => cpu.model),
  cpuCount: os.cpus().length,
  totalMemoryGb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(2)),
  freeMemoryGb: Number((os.freemem() / 1024 / 1024 / 1024).toFixed(2)),
  hostname: os.hostname(),
  release: os.release()
};

await fs.writeFile(path.join(outDir, "hardware-proof.json"), JSON.stringify(hardware, null, 2), "utf8");

const commands = [
  ["npm-typecheck.log", "npm", ["run", "typecheck"]],
  ["npm-lint.log", "npm", ["run", "lint"]],
  ["npm-test.log", "npm", ["run", "test"]],
  ["npm-build.log", "npm", ["run", "build"]],
  ["git-status.log", "git", ["status", "--short"]],
  ["git-diff-stat.log", "git", ["diff", "--stat"]]
];

const commandResults = [];
for (const [fileName, command, args] of commands) {
  const result = await run(command, args);
  commandResults.push({
    fileName,
    command: result.command,
    ok: result.ok,
    durationMs: result.durationMs,
    error: result.error ?? null
  });
  await writeLog(
    fileName,
    [
      `$ ${result.command}`,
      `ok=${result.ok}`,
      `durationMs=${result.durationMs}`,
      "",
      "## stdout",
      result.stdout,
      "",
      "## stderr",
      result.stderr,
      result.error ? `\n## error\n${result.error}` : ""
    ].join("\n"),
  );
}

const qvacHealth = await fetchJson(process.env.CASE_ROOM_QVAC_URL ?? "http://127.0.0.1:4545/health");
await fs.writeFile(path.join(outDir, "qvac-health.json"), JSON.stringify(qvacHealth, null, 2), "utf8");

let performanceLogCopied = false;
try {
  await fs.copyFile(performanceLogPath, path.join(outDir, "inference-events.jsonl"));
  performanceLogCopied = true;
} catch {
  performanceLogCopied = false;
}

let remoteApiManifestCopied = false;
try {
  await fs.copyFile(remoteApiManifestPath, path.join(outDir, "remote-api-calls.json"));
  remoteApiManifestCopied = true;
} catch {
  remoteApiManifestCopied = false;
}

const manifest = {
  createdAt: new Date().toISOString(),
  track: process.env.CASE_ROOM_SUBMISSION_TRACK ?? "General Purpose + Psy Models",
  artifactDirectory: outDir,
  hardwareProof: "hardware-proof.json",
  qvacHealth: "qvac-health.json",
  performanceLog: performanceLogCopied ? "inference-events.jsonl" : null,
  remoteApiManifest: remoteApiManifestCopied ? "remote-api-calls.json" : null,
  logs: commandResults,
  manualArtifactsExpected: [
    "demo-video.mp4",
    "system-profiler-screenshot-or-screen-recording",
    "saved-debrief-markdown",
    "offline-run-screen-recording-or-log"
  ],
  notes: [
    "Run this command after starting the local QVAC bridge for a populated qvac-health.json.",
    "Run one standard encounter before collecting artifacts so inference-events.jsonl contains patient, ASR/TTS, RAG, and evaluator events."
  ]
};

await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
console.log(`Submission artifacts written to ${outDir}`);
