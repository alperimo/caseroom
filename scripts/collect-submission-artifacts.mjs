import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = process.cwd();
const outDir = path.join(rootDir, ".artifacts", "submission");
const logDir = path.join(outDir, "logs");
const performanceOutDir = path.join(outDir, "performance");
const performanceLogCandidates = [
  path.join(rootDir, ".artifacts", "performance", "inference-events.jsonl"),
  path.join(rootDir, "packages", "qvac-runtime", ".artifacts", "performance", "inference-events.jsonl")
];
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

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function findPerformanceLog() {
  for (const candidate of performanceLogCandidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function parseJsonl(content) {
  const records = [];
  const parseErrors = [];
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  lines.forEach((line, index) => {
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      parseErrors.push({
        line: index + 1,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  return { records, parseErrors };
}

function summarizePerformanceLog(records, parseErrors, sourcePath) {
  const inferenceOperations = new Set([
    "completion.patient_turn",
    "completion.extract_topics",
    "completion.evaluator_debrief",
    "asr.transcribe",
    "asr.transcript",
    "tts.synthesize",
    "rag.search",
    "rag.reindex",
    "rag.embed"
  ]);
  const modelLoads = records
    .filter((record) => record.operation === "model.load")
    .map((record) => ({
      timestamp: record.timestamp,
      modelName: record.modelName ?? null,
      modelType: record.modelType ?? null,
      ok: record.ok,
      durationMs: record.durationMs ?? null,
      error: record.error ?? null
    }));
  const modelUnloads = records
    .filter((record) => record.operation === "model.unload")
    .map((record) => ({
      timestamp: record.timestamp,
      modelName: record.modelName ?? null,
      modelType: record.modelType ?? null,
      ok: record.ok,
      durationMs: record.durationMs ?? null,
      error: record.error ?? null
    }));
  const inferenceCalls = records
    .filter((record) => inferenceOperations.has(record.operation))
    .map((record) => ({
      timestamp: record.timestamp,
      operation: record.operation,
      modelName: record.modelName ?? record.asrModelName ?? null,
      modelId: record.modelId ?? null,
      caseId: record.caseId ?? null,
      ok: record.ok,
      durationMs: record.durationMs ?? null,
      ttftMs: record.ttftMs ?? null,
      inputTokensApprox: record.inputTokensApprox ?? null,
      outputTokensApprox: record.outputTokensApprox ?? null,
      tokensPerSecondApprox: record.tokensPerSecondApprox ?? null,
      promptPreview: record.promptPreview ?? null,
      transcriptPreview: record.transcriptPreview ?? null,
      textPreview: record.textPreview ?? null,
      resultCount: record.resultCount ?? null,
      error: record.error ?? null
    }));
  const completionCalls = inferenceCalls.filter((record) => record.operation.startsWith("completion."));
  const averageCompletionTokensPerSecond = completionCalls.length
    ? Number((
        completionCalls.reduce((total, record) => total + Number(record.tokensPerSecondApprox ?? 0), 0) /
        completionCalls.length
      ).toFixed(2))
    : null;

  return {
    createdAt: new Date().toISOString(),
    sourcePath,
    eventCount: records.length,
    parseErrors,
    modelLoads,
    modelUnloads,
    inferenceCalls,
    aggregates: {
      completionCalls: completionCalls.length,
      asrCalls: inferenceCalls.filter((record) => record.operation.startsWith("asr.")).length,
      ttsCalls: inferenceCalls.filter((record) => record.operation.startsWith("tts.")).length,
      ragCalls: inferenceCalls.filter((record) => record.operation.startsWith("rag.")).length,
      averageCompletionTokensPerSecond
    },
    notes: [
      "Completion TTFT is null when the QVAC call is executed through the current non-streaming path; durationMs and approximate tokens/sec are still captured.",
      modelUnloads.length
        ? "Model unload events were captured in this run."
        : "No model unload event was captured because the demo bridge keeps local models loaded for the session."
    ]
  };
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
await fs.mkdir(performanceOutDir, { recursive: true });

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
let performanceLogSource = null;
let performanceSummaryCopied = false;
const performanceLogPath = await findPerformanceLog();
if (performanceLogPath) {
  performanceLogSource = path.relative(rootDir, performanceLogPath);
  const copiedLogPath = path.join(performanceOutDir, "inference-events.jsonl");
  await fs.copyFile(performanceLogPath, copiedLogPath);
  performanceLogCopied = true;
  const content = await fs.readFile(performanceLogPath, "utf8");
  const { records, parseErrors } = parseJsonl(content);
  const summary = summarizePerformanceLog(records, parseErrors, performanceLogSource);
  await fs.writeFile(path.join(performanceOutDir, "inference-summary.json"), JSON.stringify(summary, null, 2), "utf8");
  performanceSummaryCopied = true;
} else {
  await fs.writeFile(
    path.join(performanceOutDir, "MISSING.json"),
    JSON.stringify({
      createdAt: new Date().toISOString(),
      missing: "inference-events.jsonl",
      searched: performanceLogCandidates.map((candidate) => path.relative(rootDir, candidate)),
      nextStep: "Start the QVAC bridge, run one standard encounter, then run npm run evidence:bundle again."
    }, null, 2),
    "utf8"
  );
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
  performanceLog: performanceLogCopied ? "performance/inference-events.jsonl" : null,
  performanceSummary: performanceSummaryCopied ? "performance/inference-summary.json" : null,
  performanceLogSource,
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
