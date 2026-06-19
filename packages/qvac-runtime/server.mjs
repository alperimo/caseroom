import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {
  GTE_LARGE_FP16,
  LLAMA_3_2_1B_INST_Q4_0,
  MEDGEMMA_4B_IT_Q4_1,
  MEDGEMMA_4B_IT_Q8_0,
  QWEN3_1_7B_INST_Q4,
  QWEN3_600M_INST_Q4,
  TTS_EN_SUPERTONIC_Q8_0,
  VAD_SILERO_5_1_2,
  WHISPER_EN_BASE_Q8_0,
  WHISPER_EN_SMALL_Q8_0,
  WHISPER_EN_TINY_Q8_0,
  completion,
  embed,
  loadModel,
  ragDeleteWorkspace,
  ragReindex,
  ragSaveEmbeddings,
  ragSearch,
  transcribe,
  textToSpeech
} from "@qvac/sdk";
import { bundledRagDocuments, ragWorkspaceVersion } from "./rag-documents.mjs";

const port = Number(process.env.CASE_ROOM_QVAC_PORT ?? 4545);
const requestedModel = process.env.CASE_ROOM_QVAC_MODEL ?? "LLAMA_3_2_1B_INST_Q4_0";
const requestedModelPath = process.env.CASE_ROOM_QVAC_MODEL_PATH;
const requestedAsrModel = process.env.CASE_ROOM_QVAC_ASR_MODEL ?? "WHISPER_EN_BASE_Q8_0";
const strictQvacMode = process.env.CASE_ROOM_STRICT_QVAC === "1";
const ragWorkspace = "caseroom-medical-osce";
const ragManifestDir = path.resolve(process.cwd(), ".caseroom", "rag");
const ragManifestPath = path.join(ragManifestDir, `${ragWorkspace}.json`);
const performanceLogDir = path.resolve(process.cwd(), ".artifacts", "performance");
const performanceLogPath = path.join(performanceLogDir, "inference-events.jsonl");

const supportedModels = {
  LLAMA_3_2_1B_INST_Q4_0,
  MEDGEMMA_4B_IT_Q4_1,
  MEDGEMMA_4B_IT_Q8_0,
  QWEN3_600M_INST_Q4,
  QWEN3_1_7B_INST_Q4
};

const supportedAsrModels = {
  WHISPER_EN_TINY_Q8_0,
  WHISPER_EN_BASE_Q8_0,
  WHISPER_EN_SMALL_Q8_0
};

let activeAsrModelName = supportedAsrModels[requestedAsrModel] ? requestedAsrModel : "WHISPER_EN_BASE_Q8_0";

let modelId = null;
let embeddingModelId = null;
let ttsModelId = null;
let asrModelId = null;
let modelLoadPromise = null;
let embeddingLoadPromise = null;
let ttsLoadPromise = null;
let asrLoadPromise = null;
let ragSearchQueue = Promise.resolve();
let asrQueue = Promise.resolve();
let activeModelName = requestedModelPath ? `local:${path.basename(requestedModelPath)}` : requestedModel;
let lastLoadError = null;
let ragStatus = "initializing";
let ragReady = false;
let lastRagError = null;
let ttsReady = false;
let lastTtsError = null;
let asrReady = false;
let lastAsrError = null;

const ttsSampleRate = 44100;

function approximateTokens(text) {
  return Math.max(1, Math.ceil(String(text ?? "").trim().split(/\s+/).filter(Boolean).length * 1.35));
}

async function logInferenceEvent(event) {
  const record = {
    timestamp: new Date().toISOString(),
    strictQvacMode,
    ...event
  };
  try {
    await fs.mkdir(performanceLogDir, { recursive: true });
    await fs.appendFile(performanceLogPath, `${JSON.stringify(record)}\n`, "utf8");
  } catch (error) {
    console.error("[qvac] could not write inference log:", error instanceof Error ? error.message : String(error));
  }
}

async function measured(operation, details, fn) {
  const startedAt = performance.now();
  try {
    const result = await fn();
    const durationMs = Math.round(performance.now() - startedAt);
    await logInferenceEvent({
      operation,
      ok: true,
      durationMs,
      ...details,
      ...(details.outputText
        ? {
            outputTokensApprox: approximateTokens(details.outputText),
            tokensPerSecondApprox: Number((approximateTokens(details.outputText) / Math.max(0.001, durationMs / 1000)).toFixed(2))
          }
        : {})
    });
    return result;
  } catch (error) {
    await logInferenceEvent({
      operation,
      ok: false,
      durationMs: Math.round(performance.now() - startedAt),
      ...details,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

async function enqueue(queueName, fn) {
  const previousQueue = queueName === "asr" ? asrQueue : ragSearchQueue;
  const run = previousQueue.catch(() => {}).then(fn);
  if (queueName === "asr") {
    asrQueue = run.catch(() => {});
  } else {
    ragSearchQueue = run.catch(() => {});
  }
  return run;
}

function createWavHeader(dataLength, sampleRate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

function int16ArrayToBuffer(samples) {
  const buffer = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-32768, Math.min(32767, Math.round(samples[index] ?? 0)));
    buffer.writeInt16LE(value, index * 2);
  }
  return buffer;
}

function normalizeTranscriptionResult(result) {
  if (typeof result === "string") {
    return result;
  }
  if (result && typeof result === "object") {
    if (typeof result.text === "string") {
      return result.text;
    }
    if (typeof result.transcript === "string") {
      return result.transcript;
    }
    if (Array.isArray(result.segments)) {
      return result.segments
        .map((segment) => typeof segment?.text === "string" ? segment.text : "")
        .join(" ");
    }
  }
  return "";
}

async function ensureModelLoaded() {
  if (modelId) {
    return modelId;
  }
  if (modelLoadPromise) {
    return modelLoadPromise;
  }

  const modelSrc = requestedModelPath
    ? requestedModelPath
    : supportedModels[activeModelName] ?? supportedModels.LLAMA_3_2_1B_INST_Q4_0;
  if (!requestedModelPath && !supportedModels[activeModelName]) {
    activeModelName = "LLAMA_3_2_1B_INST_Q4_0";
  }

  modelLoadPromise = (async () => {
    try {
      modelId = await measured(
        "model.load",
        { modelName: activeModelName, modelType: "completion" },
        () => loadModel({
          modelSrc,
          ...(requestedModelPath ? { modelType: "llamacpp-completion" } : {}),
          modelConfig: {
            ctx_size: 4096,
            ...(requestedModelPath ? { device: "gpu" } : {})
          },
          onProgress: (progress) => {
            console.log(`[qvac] loading ${activeModelName}: ${progress.percentage.toFixed(1)}%`);
          }
        }),
      );
      lastLoadError = null;
      console.log(`[qvac] model ready: ${activeModelName} (${modelId})`);
      return modelId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const registeredMatch = message.match(/Model with ID "([^"]+)" is already registered/);
      if (registeredMatch) {
        modelId = registeredMatch[1];
        lastLoadError = null;
        return modelId;
      }
      lastLoadError = message;
      modelId = null;
      throw error;
    } finally {
      modelLoadPromise = null;
    }
  })();

  return modelLoadPromise;
}

async function ensureEmbeddingModelLoaded() {
  if (embeddingModelId) {
    return embeddingModelId;
  }
  if (embeddingLoadPromise) {
    return embeddingLoadPromise;
  }

  embeddingLoadPromise = (async () => {
    embeddingModelId = await measured(
      "model.load",
      { modelName: "GTE_LARGE_FP16", modelType: "embedding" },
      () => loadModel({
        modelSrc: GTE_LARGE_FP16,
        modelType: "llamacpp-embedding",
        modelConfig: {
          gpuLayers: 99,
          device: "gpu"
        },
        onProgress: (progress) => {
          console.log(`[qvac] loading embeddings: ${progress.percentage.toFixed(1)}%`);
        }
      }),
    );
    console.log(`[qvac] embedding model ready (${embeddingModelId})`);
    return embeddingModelId;
  })().finally(() => {
    embeddingLoadPromise = null;
  });

  return embeddingLoadPromise;
}

async function ensureTtsModelLoaded() {
  if (ttsModelId) {
    return ttsModelId;
  }
  if (ttsLoadPromise) {
    return ttsLoadPromise;
  }

  ttsLoadPromise = (async () => {
    try {
      ttsModelId = await measured(
        "model.load",
        { modelName: "TTS_EN_SUPERTONIC_Q8_0", modelType: "tts" },
        () => loadModel({
          modelSrc: TTS_EN_SUPERTONIC_Q8_0,
          modelConfig: {
            ttsEngine: "supertonic",
            language: "en",
            voice: "F1",
            ttsSpeed: 1.03,
            ttsNumInferenceSteps: 5
          },
          onProgress: (progress) => {
            console.log(`[qvac] loading Supertonic TTS: ${progress.percentage.toFixed(1)}%`);
          }
        }),
      );
      ttsReady = true;
      lastTtsError = null;
      console.log(`[qvac] TTS ready (${ttsModelId})`);
      return ttsModelId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const registeredMatch = message.match(/Model with ID "([^"]+)" is already registered/);
      if (registeredMatch) {
        ttsModelId = registeredMatch[1];
        ttsReady = true;
        lastTtsError = null;
        return ttsModelId;
      }
      ttsReady = false;
      lastTtsError = message;
      ttsModelId = null;
      throw error;
    } finally {
      ttsLoadPromise = null;
    }
  })();

  return ttsLoadPromise;
}

async function ensureAsrModelLoaded() {
  if (asrModelId) {
    return asrModelId;
  }
  if (asrLoadPromise) {
    return asrLoadPromise;
  }

  asrLoadPromise = (async () => {
    try {
      asrModelId = await measured(
        "model.load",
        { modelName: activeAsrModelName, modelType: "asr", vadModelName: "VAD_SILERO_5_1_2" },
        () => loadModel({
          modelSrc: supportedAsrModels[activeAsrModelName],
          modelConfig: {
            vadModelSrc: VAD_SILERO_5_1_2,
            language: "en",
            no_timestamps: true,
            suppress_blank: true,
            suppress_nst: true,
            temperature: 0.0,
            vad_params: {
              threshold: 0.6,
              min_speech_duration_ms: 250,
              min_silence_duration_ms: 650,
              max_speech_duration_s: 14.0,
              speech_pad_ms: 180
            }
          },
          onProgress: (progress) => {
            console.log(`[qvac] loading ${activeAsrModelName}: ${progress.percentage.toFixed(1)}%`);
          }
        }),
      );
      asrReady = true;
      lastAsrError = null;
      console.log(`[qvac] ASR ready (${asrModelId})`);
      return asrModelId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const registeredMatch = message.match(/Model with ID "([^"]+)" is already registered/);
      if (registeredMatch) {
        asrModelId = registeredMatch[1];
        asrReady = true;
        lastAsrError = null;
        return asrModelId;
      }
      asrReady = false;
      lastAsrError = message;
      asrModelId = null;
      throw error;
    } finally {
      asrLoadPromise = null;
    }
  })();

  return asrLoadPromise;
}

async function loadRagManifest() {
  try {
    const raw = await fs.readFile(ragManifestPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeRagManifest(documentIds) {
  await fs.mkdir(ragManifestDir, { recursive: true });
  await fs.writeFile(
    ragManifestPath,
    JSON.stringify(
      {
        version: ragWorkspaceVersion,
        documentIds,
        savedAt: new Date().toISOString()
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function ensureRagWorkspace() {
  if (ragReady) {
    return;
  }

  ragStatus = "loading";
  try {
    const manifest = await loadRagManifest();
    const expectedIds = bundledRagDocuments.map((doc) => doc.id).sort();
    const hasMatchingManifest =
      manifest?.version === ragWorkspaceVersion &&
      JSON.stringify([...(manifest.documentIds ?? [])].sort()) === JSON.stringify(expectedIds);

    const readyEmbeddingModelId = await ensureEmbeddingModelLoaded();

    if (!hasMatchingManifest) {
      try {
        await ragDeleteWorkspace({ workspace: ragWorkspace });
      } catch {
        // Ignore missing workspace on first boot.
      }

      const documents = bundledRagDocuments.map((doc) => doc.content);
      const { embedding } = await measured(
        "rag.embed",
        {
          modelName: "GTE_LARGE_FP16",
          modelId: readyEmbeddingModelId,
          documentCount: documents.length,
          inputTokensApprox: documents.reduce((sum, item) => sum + approximateTokens(item), 0)
        },
        () => embed({
          modelId: readyEmbeddingModelId,
          text: documents
        }),
      );

      await ragSaveEmbeddings({
        workspace: ragWorkspace,
        modelId: readyEmbeddingModelId,
        documents: bundledRagDocuments.map((doc, index) => ({
          id: doc.id,
          content: doc.content,
          embedding: embedding[index],
          embeddingModelId: readyEmbeddingModelId
        }))
      });

      await ragReindex({
        workspace: ragWorkspace,
        modelId: readyEmbeddingModelId
      });

      await writeRagManifest(expectedIds);
    }

    ragReady = true;
    ragStatus = "ready";
    lastRagError = null;
  } catch (error) {
    ragReady = false;
    ragStatus = "fallback";
    lastRagError = error instanceof Error ? error.message : String(error);
    console.error("[qvac] rag workspace failed:", lastRagError);
  }
}

function buildSystemPrompt(session) {
  const truthLines = Object.entries(session.scenario.hiddenCase.truthTable)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");

  return [
    "You are the patient in a medical OSCE simulation.",
    "You are only the patient. You are never the doctor, clinician, nurse, evaluator, tutor, assistant, or narrator.",
    "The user is the doctor currently speaking with you in this consultation. Treat them as your doctor right now.",
    "Do not refer to another doctor, your doctor, a GP, a specialist, or a previous clinician unless that fact appears explicitly in the case truth table.",
    `Your name is ${session.scenario.brief.patientName}. If asked for your name, answer with that name and nothing about being a doctor.`,
    "Do not say you are here to evaluate, examine, treat, diagnose, prescribe, or manage the clinician.",
    "Do not coach, quiz, assess, or prompt the clinician. Never ask what the clinician's next step is.",
    "Do not summarize the checklist, missed topics, red flags, or clinical reasoning back to the clinician.",
    "Do not combine unrelated facts into an examiner-style recap. Speak like a real patient with limited medical knowledge.",
    "Do not volunteer the diagnosis.",
    "Do not mention hidden labels such as UTI, ACS, anemia, diagnosis, differential, rubric, or red flags unless the clinician explicitly asks what they should worry about as a patient.",
    "If the clinician tells you a diagnosis, explains a condition, or suggests what you might have, react naturally as a patient hearing this information: express surprise, concern, or ask what that means in simple terms. Do not act like you already understand the medical details of the condition, and stay true to your character's affect.",
    "Only reveal facts that are consistent with the case truth table and only when the clinician asks something relevant.",
    "Answer the clinician's latest question directly. If it matches a truth-table topic, use that fact in the first sentence.",
    "If asked about a listed topic, answer using the matching fact. If asked about something unrelated, stay uncertain and redirect politely.",
    "Never output chain-of-thought, <think> tags, bullet lists, or meta commentary.",
    "Respond in 1 to 3 natural spoken sentences.",
    `Patient name: ${session.scenario.brief.patientName}.`,
    `Patient affect: ${session.scenario.hiddenCase.patientAffect}.`,
    `Chief complaint: ${session.scenario.brief.chiefComplaint}.`,
    `Red flags: ${session.scenario.hiddenCase.redFlags.join(", ")}.`,
    "Case truth table:",
    truthLines
  ].join("\n");
}

function buildHistory(session, prompt) {
  const priorTurns = session.transcript.map((turn) => ({
    role: turn.speaker === "clinician" ? "user" : "assistant",
    content: turn.text
  }));

  return [
    { role: "system", content: buildSystemPrompt(session) },
    ...priorTurns,
    { role: "user", content: prompt }
  ];
}

async function generatePatientReply(session, prompt) {
  if (/^\s*(hi|hello|hey|good morning|good afternoon|good evening)\s*[.!?]*\s*$/i.test(prompt)) {
    return `Hello doctor. ${session.scenario.brief.chiefComplaint}`;
  }

  if (/\b(what'?s your name|what is your name|who are you|your name)\b/i.test(prompt)) {
    return `My name is ${session.scenario.brief.patientName}.`;
  }

  const readyModelId = await ensureModelLoaded();
  const history = buildHistory(session, prompt);
  const startedAt = performance.now();
  const run = completion({
    modelId: readyModelId,
    history,
    stream: false
  });
  const final = await run.final;
  const rawReply = String(final.contentText ?? "");
  const reply = sanitizePatientReply(rawReply, session);
  const durationMs = Math.round(performance.now() - startedAt);
  await logInferenceEvent({
    operation: "completion.patient_turn",
    ok: true,
    modelName: activeModelName,
    modelId: readyModelId,
    caseId: session.scenario.id,
    promptPreview: prompt.slice(0, 220),
    inputTokensApprox: approximateTokens(history.map((turn) => turn.content).join(" ")),
    outputTokensApprox: approximateTokens(reply),
    durationMs,
    ttftMs: null,
    tokensPerSecondApprox: Number((approximateTokens(reply) / Math.max(0.001, durationMs / 1000)).toFixed(2)),
    sanitized: rawReply.trim() !== reply.trim()
  });
  return reply;
}

function buildEvaluatorPrompt(session, report, citations) {
  return [
    "You are an attending examiner for an educational medical simulation.",
    "Use only the transcript, action log, case rubric, hidden case facts, and retrieved local source snippets.",
    "Do not give real medical advice to a real patient. This is simulation feedback only.",
    "Return strict JSON with keys: summary, strengths, gaps.",
    "summary: one concise learner-facing sentence.",
    "strengths: array of up to 3 concrete strengths.",
    "gaps: array of up to 4 concrete next-improvement items.",
    "",
    `Case: ${session.scenario.title}`,
    `Diagnosis truth: ${session.scenario.hiddenCase.diagnosis}`,
    `Must ask: ${session.scenario.hiddenCase.mustAsk.join(", ")}`,
    `Revealed topics: ${session.revealedTopics.join(", ") || "none"}`,
    `Action log: ${session.actionLog.join(", ") || "none"}`,
    `Deterministic score: ${report.overallScore}`,
    `Deterministic strengths: ${report.strengths.join(" | ")}`,
    `Deterministic gaps: ${report.gaps.join(" | ")}`,
    `Citations: ${citations.map((item) => `${item.title}: ${item.excerpt}`).join(" | ")}`,
    "Transcript:",
    session.transcript.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n")
  ].join("\n");
}

function extractJsonObject(text) {
  let cleaned = String(text ?? "").trim();
  // Strip <think>...</think> blocks if present
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const lastBraceIndex = cleaned.lastIndexOf("}");
    const firstBraceIndex = cleaned.indexOf("{");
    if (firstBraceIndex !== -1 && lastBraceIndex !== -1 && lastBraceIndex > firstBraceIndex) {
      const subtext = cleaned.slice(firstBraceIndex, lastBraceIndex + 1);
      try {
        return JSON.parse(subtext);
      } catch {
        // Try searching backwards from the last } for the matching { that forms valid JSON
        let startIdx = cleaned.lastIndexOf("{", lastBraceIndex);
        while (startIdx !== -1 && startIdx >= firstBraceIndex) {
          try {
            return JSON.parse(cleaned.slice(startIdx, lastBraceIndex + 1));
          } catch {}
          startIdx = cleaned.lastIndexOf("{", startIdx - 1);
        }
      }
    }
    throw error;
  }
}


function normalizeStringArray(value, fallback, maxItems) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const normalized = value
    .filter((item) => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, maxItems);
  return normalized.length > 0 ? normalized : fallback;
}

function buildExtractTopicsPrompt(turns, mustAsk, synonyms) {
  const topicsDescription = mustAsk.map((topic) => {
    const list = synonyms[topic] || [];
    return `- Topic: "${topic}" (addressed if the conversation mentions: ${topic}${list.length ? ", " + list.join(", ") : ""})`;
  }).join("\n");

  return [
    "You are a medical simulation assessor checking a clinician-patient dialogue.",
    "Evaluate if the clinician successfully asked about or explored any of the specified topics in the dialogue turns below.",
    "",
    "Topic Definitions for this case:",
    topicsDescription,
    "",
    "Semantic Relevance Principles:",
    "1. Intent & Context Match: A topic is only addressed (TRUE) if there is a clear intent in the clinician's question or the patient's response to explore that specific area of clinical history or physical symptom.",
    "2. Active Symptoms vs. Historical Inquiries:",
    "   - Topics representing 'history' (e.g. cardiac history, family history, medical history) require discussing past events, chronic conditions, prior diagnoses, or family members' conditions. Mentioning or describing current acute symptoms (like chest pain, high heart rate, active sweating) does NOT satisfy a history topic.",
    "3. Triggers/Context vs. Symptom Presence:",
    "   - Mentioning a physical activity or trigger (e.g. climbing stairs, walking) does NOT satisfy a symptom topic (e.g. shortness of breath, dyspnea) unless there is explicit discussion or mention of the breathing difficulty itself.",
    "4. No Logical Over-association:",
    "   - Do not mark a topic as true just because it is logically or clinically related to what the patient is experiencing. For example, a patient presenting with chest pain is likely having a cardiac issue, but unless the clinician asks about their cardiac history (past heart attacks, cholesterol, family history) or the patient volunteers it, 'cardiac history' remains false.",
    "",
    "Instructions:",
    "- Analyze the dialogue turns carefully.",
    "- Analyze each topic step-by-step according to the Semantic Relevance Principles above before determining if it is true or false.",
    "- Output a brief reasoning sentence for each topic, then output a JSON block mapping each topic name to a boolean (true if addressed, false otherwise).",
    "- Output ONLY the JSON block at the very end of your response.",
    "",
    "Few-shot Examples:",
    "---",
    "Dialogue:",
    "clinician: Are you feeling sweaty?",
    "patient: Yes, a bit.",
    "Topic definitions:",
    "- Topic: \"sweating\" (addressed if the conversation mentions: sweating, sweat, sweats, clammy, wetness)",
    "- Topic: \"radiation\" (addressed if the conversation mentions: radiation, spread, arm, neck, jaw)",
    "Output:",
    "Analysis:",
    "- sweating: Clinician asked about feeling sweaty, patient confirmed. True.",
    "- radiation: Neither the clinician asked nor the patient mentioned radiation or synonyms. False.",
    "",
    "{\"sweating\": true, \"radiation\": false}",
    "---",
    "Dialogue:",
    "clinician: Do you have family history of heart attack?",
    "patient: My father did.",
    "Topic definitions:",
    "- Topic: \"cardiac history\" (addressed if the conversation mentions: cardiac history, heart, coronary, father, mother, dad)",
    "- Topic: \"sweating\" (addressed if the conversation mentions: sweating, sweat, clammy)",
    "Output:",
    "Analysis:",
    "- cardiac history: Clinician explicitly asked about family history of heart attack, patient confirmed. True.",
    "- sweating: Neither clinician asked nor patient mentioned sweating or synonyms. False.",
    "",
    "{\"cardiac history\": true, \"sweating\": false}",
    "---",
    "Dialogue:",
    "patient: Hello doctor. I got a heavy pain in my chest after climbing the stairs and it scared me.",
    "clinician: Are you feeling sweaty?",
    "patient: I felt clammy when I was climbing the stairs.",
    "Topic definitions:",
    "- Topic: \"cardiac history\" (addressed if the conversation mentions: cardiac history, heart, coronary, father, mother, dad)",
    "- Topic: \"radiation\" (addressed if the conversation mentions: radiation, spread, arm, neck, jaw)",
    "- Topic: \"sweating\" (addressed if the conversation mentions: sweating, sweat, clammy)",
    "Output:",
    "Analysis:",
    "- cardiac history: Patient described current chest pain symptom, but did not discuss past history or family history of heart issues. False.",
    "- radiation: Neither clinician asked nor patient mentioned radiation or synonyms. False.",
    "- sweating: Clinician asked about feeling sweaty, and patient mentioned feeling clammy. True.",
    "",
    "{\"cardiac history\": false, \"radiation\": false, \"sweating\": true}",
    "---",
    "",
    "Active Dialogue to evaluate:",
    turns.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n"),
    "",
    "Topic definitions for this evaluation:",
    topicsDescription,
    "",
    "Output (Perform analysis first, then return the JSON block):"
  ].join("\n");
}

function extractTopicsDeterministic(turns, mustAsk, synonyms) {
  const dialogueText = turns.map(t => t.text).join(" ").toLowerCase();
  const mapping = {};
  
  const contextualKeywords = new Set([
    "father", "mother", "dad", "mom", "parents", "parent", "brother", "sister", "grandpa", "grandma", "family", "family history",
    "arm", "left arm", "neck", "jaw", "back", "shoulder", "chest",
    "stairs", "climbing", "climb", "walk", "walking", "run", "running", "exercise", "exertion"
  ]);

  for (const topic of mustAsk) {
    const list = synonyms[topic] || [];
    const keywords = [topic, ...list];
    
    // For specific chest-pain topics, apply contextual safeguards
    if (topic === "shortness of breath") {
      const primary = keywords.filter(k => !contextualKeywords.has(k.toLowerCase()));
      const hasPrimary = primary.some(kw => {
        const escaped = kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        return new RegExp(kw.length <= 3 ? `\\b${escaped}\\b` : escaped, 'i').test(dialogueText);
      });
      mapping[topic] = hasPrimary;
    } else if (topic === "cardiac history") {
      const primary = ["heart", "cardiac", "coronary", "angina", "infarction", "stroke", "cholesterol", "attack"];
      const hasPrimary = primary.some(kw => {
        const escaped = kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        return new RegExp(kw.length <= 3 ? `\\b${escaped}\\b` : escaped, 'i').test(dialogueText);
      });
      const familyTerms = ["father", "mother", "dad", "mom", "parents", "parent", "family", "history", "prior", "past", "before", "diagnosed"];
      const hasFamilyOrPast = familyTerms.some(kw => {
        const escaped = kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        return new RegExp(kw.length <= 3 ? `\\b${escaped}\\b` : escaped, 'i').test(dialogueText);
      });
      mapping[topic] = hasPrimary && hasFamilyOrPast;
    } else if (topic === "radiation") {
      const primary = ["radiate", "radiates", "radiating", "spread", "spreads", "spreading", "go to", "going to", "travel", "travels", "traveling", "shoot", "shoots", "shooting"];
      const hasPrimary = primary.some(kw => {
        const escaped = kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        return new RegExp(kw.length <= 3 ? `\\b${escaped}\\b` : escaped, 'i').test(dialogueText);
      });
      const anatomical = ["arm", "left arm", "neck", "jaw", "back", "shoulder", "chest"];
      const hasAnatomical = anatomical.some(kw => {
        const escaped = kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        return new RegExp(kw.length <= 3 ? `\\b${escaped}\\b` : escaped, 'i').test(dialogueText);
      });
      mapping[topic] = hasPrimary && hasAnatomical;
    } else {
      // Default fuzzy match
      const hasMatch = keywords.some(keyword => {
        const escaped = keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = keyword.length <= 3 ? new RegExp(`\\b${escaped}\\b`, 'i') : new RegExp(escaped, 'i');
        return regex.test(dialogueText);
      });
      mapping[topic] = hasMatch;
    }
  }
  return mapping;
}

async function extractTopicsWithQvac(turns, mustAsk, synonyms) {
  const isSmallModel = activeModelName.includes("1B") || activeModelName.includes("600M") || !strictQvacMode;
  if (isSmallModel) {
    console.log(`[qvac] using deterministic topic extraction for ${activeModelName}`);
    return extractTopicsDeterministic(turns, mustAsk, synonyms);
  }

  const readyModelId = await ensureModelLoaded();
  const prompt = buildExtractTopicsPrompt(turns, mustAsk, synonyms);
  const history = [
    {
      role: "system",
      content: "You return only valid JSON mapping medical topics to booleans."
    },
    {
      role: "user",
      content: prompt
    }
  ];
  const startedAt = performance.now();
  const run = completion({
    modelId: readyModelId,
    history,
    stream: false
  });
  const final = await run.final;
  const raw = String(final.contentText ?? "");
  const durationMs = Math.round(performance.now() - startedAt);
  let parsed = null;
  try {
    parsed = extractJsonObject(raw);
  } catch (error) {
    console.error("[qvac] extract-topics parse failed:", error.message, "raw:", raw);
    parsed = {};
  }
  await logInferenceEvent({
    operation: "completion.extract_topics",
    ok: true,
    modelName: activeModelName,
    modelId: readyModelId,
    durationMs,
    promptPreview: prompt.slice(0, 220),
    inputTokensApprox: approximateTokens(prompt),
    outputTokensApprox: approximateTokens(raw),
    rawPreview: raw.slice(0, 500)
  });
  return parsed;
}

async function evaluateDebriefWithQvac(session, report, citations) {
  const readyModelId = await ensureModelLoaded();
  const prompt = buildEvaluatorPrompt(session, report, citations);
  const history = [
    {
      role: "system",
      content: "You return only valid JSON for medical simulation debriefs."
    },
    {
      role: "user",
      content: prompt
    }
  ];

  const startedAt = performance.now();
  const run = completion({
    modelId: readyModelId,
    history,
    stream: false
  });
  const final = await run.final;
  const raw = String(final.contentText ?? "");
  const durationMs = Math.round(performance.now() - startedAt);
  let parsed = null;
  let parsedJson = true;
  try {
    parsed = extractJsonObject(raw);
  } catch (error) {
    parsedJson = false;
    await logInferenceEvent({
      operation: "completion.evaluator_debrief_parse",
      ok: false,
      modelName: activeModelName,
      modelId: readyModelId,
      caseId: session.scenario.id,
      durationMs,
      error: error instanceof Error ? error.message : String(error),
      rawPreview: raw.slice(0, 500)
    });
  }
  await logInferenceEvent({
    operation: "completion.evaluator_debrief",
    ok: true,
    modelName: activeModelName,
    modelId: readyModelId,
    caseId: session.scenario.id,
    promptPreview: prompt.slice(0, 220),
    inputTokensApprox: approximateTokens(prompt),
    outputTokensApprox: approximateTokens(raw),
    durationMs,
    ttftMs: null,
    tokensPerSecondApprox: Number((approximateTokens(raw) / Math.max(0.001, durationMs / 1000)).toFixed(2)),
    parsedJson,
    rawPreview: raw.slice(0, 500)
  });

  return {
    summary: typeof parsed?.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : report.summary,
    strengths: normalizeStringArray(parsed?.strengths, report.strengths, 3),
    gaps: normalizeStringArray(parsed?.gaps, report.gaps, 4),
    source: parsedJson ? "qvac-json" : "qvac-completion-deterministic-parse-fallback"
  };
}

function sanitizePatientReply(reply, session) {
  const withoutThinking = reply.replace(/<think>[\s\S]*?<\/think>/gi, " ");
  const singleLine = withoutThinking.replace(/\s+/g, " ").trim();
  if (!singleLine) {
    return "I am not sure how to answer that. Could you ask it a different way?";
  }
  const roleLeak = /\b(i am|i'm|my name is)\s+(dr\.?|doctor|clinician|nurse|professor|consultant)\b/i;
  const evaluatorLeak = /\b(evaluate|examine|treat|diagnose|prescribe|manage)\s+you\b/i;
  const coachingLeak = /\b(what'?s your next step|what is your next step|what would you do next|next step\??|your next move|what do you want to do|what are you going to do)\b/i;
  const examinerRecapLeak = /\b(no fever|flank pain|medication allergies|red flags|differential|diagnosis|rubric|checklist)\b.*\b(next step|what'?s next|what would you)\b/i;
  const otherDoctorLeak = /\b(my doctor|the doctor|a doctor|gp|specialist|consultant)\s+(told|said|says|has told|has been told|explained|diagnosed)\b/i;
  if (roleLeak.test(singleLine) || evaluatorLeak.test(singleLine)) {
    const turnIndex = session.transcript ? session.transcript.length : 0;
    const nameFallbacks = [
      `My name is ${session.scenario.brief.patientName}.`,
      `I'm ${session.scenario.brief.patientName}, doctor.`,
      `I am ${session.scenario.brief.patientName}.`
    ];
    return nameFallbacks[turnIndex % nameFallbacks.length];
  }
  if (coachingLeak.test(singleLine) || examinerRecapLeak.test(singleLine)) {
    const turnIndex = session.transcript ? session.transcript.length : 0;
    const coachingFallbacks = [
      `I'm still uncomfortable, doctor. ${session.scenario.brief.chiefComplaint}`,
      `I'm just really worried about my symptoms. ${session.scenario.brief.chiefComplaint}`,
      `I'm still feeling uneasy. ${session.scenario.brief.chiefComplaint}`
    ];
    return coachingFallbacks[turnIndex % coachingFallbacks.length];
  }
  if (otherDoctorLeak.test(singleLine)) {
    const turnIndex = session.transcript ? session.transcript.length : 0;
    const fallbacks = [
      `I'm not sure, doctor. I'm just really concerned about this: ${session.scenario.brief.chiefComplaint}`,
      `Oh, I see. What does that mean for me?`,
      `I don't know much about that, doctor. Is it serious?`,
      `Okay, doctor. How do we treat this?`,
      `Sorry doctor, I might have got confused. Could you explain what we should do next?`
    ];
    return fallbacks[turnIndex % fallbacks.length];
  }
  return singleLine;
}

function buildRetrievalQuery(session) {
  const clinicianTurns = session.transcript
    .filter((turn) => turn.speaker === "clinician")
    .slice(-4)
    .map((turn) => turn.text)
    .join(" ");

  return [
    session.scenario.title,
    session.scenario.brief.chiefComplaint,
    session.diagnosisText ?? "",
    session.planText ?? "",
    clinicianTurns,
    session.progress?.missingCriticalTopics?.join(" ") ?? ""
  ]
    .join(" ")
    .trim();
}

async function searchRelevantDocuments(session) {
  await ensureRagWorkspace();
  if (!ragReady) {
    return [];
  }

  const readyEmbeddingModelId = await ensureEmbeddingModelLoaded();
  const query = buildRetrievalQuery(session);
  const results = await enqueue("rag", () =>
    measured(
      "rag.search",
      {
        modelName: "GTE_LARGE_FP16",
        modelId: readyEmbeddingModelId,
        workspace: ragWorkspace,
        caseId: session.scenario.id,
        inputTokensApprox: approximateTokens(query),
        topK: 3
      },
      () => ragSearch({
        workspace: ragWorkspace,
        modelId: readyEmbeddingModelId,
        query,
        topK: 3
      }),
    ),
  );

  return results.map((result) => {
    const source = bundledRagDocuments.find((doc) => doc.id === result.id);
    return {
      id: result.id,
      title: source?.title ?? result.id,
      excerpt: result.content,
      score: result.score
    };
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
    });
    request.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: "Missing URL." });
    return;
  }

  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, {
        ok: true,
        mode: "qvac-local-bridge",
        strictQvacMode,
        performanceLogPath,
        modelName: activeModelName,
      modelLoaded: Boolean(modelId),
      lastLoadError,
      ragStatus,
      ragReady,
      lastRagError,
        ragWorkspace,
        ttsReady,
        lastTtsError,
      asrModelName: activeAsrModelName,
      asrReady,
      lastAsrError
    });
    return;
  }

  if (request.method === "POST" && request.url === "/warmup") {
    try {
      await ensureModelLoaded();
      void ensureTtsModelLoaded().catch(() => {});
      void ensureAsrModelLoaded().catch(() => {});
      sendJson(response, 200, {
        ok: true,
        mode: "qvac",
        modelName: activeModelName,
        modelLoaded: true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, {
        ok: false,
        mode: "fallback-required",
        error: message,
        modelName: activeModelName,
        modelLoaded: false
      });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/asr") {
    try {
      const body = await readJson(request);
      const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
      if (!audioBase64) {
        sendJson(response, 400, { error: "audioBase64 is required." });
        return;
      }

      const contextPhrases = Array.isArray(body.contextPhrases)
        ? body.contextPhrases
          .filter((phrase) => typeof phrase === "string")
          .map((phrase) => phrase.replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .slice(0, 80)
        : [];
      const asrPromptBase = "A medical consultation between a doctor and a patient. The doctor asks: Do you have any chest pain, shortness of breath, sweating, or radiation to your arm? How is your heart? Do you feel tired, or have heavy periods? Is there any burning urination, fever, flank pain, or ankle swelling? Tell me about your medical history, tablets, medication, and allergies.";
      const lexicalHint = contextPhrases.length > 0
        ? ` Words you might hear: ${contextPhrases.join(", ")}.`
        : "";
      const readyAsrModelId = await ensureAsrModelLoaded();
      const audioChunk = Buffer.from(audioBase64, "base64");
      const audioDurationMs = Math.round((audioChunk.byteLength / 2 / 16000) * 1000);
      const rawTranscription = await enqueue("asr", () =>
        measured(
          "asr.transcribe",
          {
            modelName: activeAsrModelName,
            modelId: readyAsrModelId,
            audioBytes: audioChunk.byteLength,
            audioDurationMs,
            contextPhraseCount: contextPhrases.length
          },
          () => transcribe({
            modelId: readyAsrModelId,
            audioChunk,
            prompt: `${asrPromptBase}${lexicalHint}`
          }),
        ),
      );
      const transcript = normalizeTranscriptionResult(rawTranscription).replace(/\s+/g, " ").trim();
      await logInferenceEvent({
        operation: "asr.transcript",
        ok: Boolean(transcript),
        modelName: activeAsrModelName,
        modelId: readyAsrModelId,
        audioBytes: audioChunk.byteLength,
        audioDurationMs,
        transcriptPreview: transcript.slice(0, 220)
      });
      sendJson(response, 200, {
        ok: true,
        mode: "qvac-asr",
        text: transcript
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastAsrError = message;
      asrReady = false;
      sendJson(response, 500, {
        ok: false,
        mode: "web-speech-fallback",
        error: message
      });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/tts") {
    try {
      const body = await readJson(request);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) {
        sendJson(response, 400, { error: "Text is required." });
        return;
      }

      const readyTtsModelId = await ensureTtsModelLoaded();
      const ttsResult = textToSpeech({
        modelId: readyTtsModelId,
        text,
        inputType: "text",
        stream: false
      });
      const samples = await measured(
        "tts.synthesize",
        {
          modelName: "TTS_EN_SUPERTONIC_Q8_0",
          modelId: readyTtsModelId,
          inputTokensApprox: approximateTokens(text),
          textPreview: text.slice(0, 220)
        },
        () => ttsResult.buffer,
      );
      const audioData = int16ArrayToBuffer(samples);
      const wavBuffer = Buffer.concat([createWavHeader(audioData.length, ttsSampleRate), audioData]);
      sendJson(response, 200, {
        ok: true,
        mode: "qvac-tts",
        mimeType: "audio/wav",
        audioBase64: wavBuffer.toString("base64")
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastTtsError = message;
      ttsReady = false;
      sendJson(response, 500, {
        ok: false,
        mode: "browser-tts-fallback",
        error: message
      });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/patient-turn") {
    try {
      const body = await readJson(request);
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!body.session || !prompt) {
        sendJson(response, 400, { error: "Session and prompt are required." });
        return;
      }

      const reply = await generatePatientReply(body.session, prompt);
      sendJson(response, 200, {
        ok: true,
        mode: "qvac",
        reply: reply || "I am not sure how to answer that. Could you ask it a different way?"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[qvac] patient-turn failed:", message);
      sendJson(response, 500, {
        ok: false,
        mode: "fallback-required",
        error: message
      });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/rag/search") {
    try {
      const body = await readJson(request);
      if (!body.session) {
        sendJson(response, 400, { error: "Session is required." });
        return;
      }

      const citations = await searchRelevantDocuments(body.session);
      sendJson(response, 200, {
        ok: true,
        citations,
        ragReady
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, {
        ok: false,
        error: message,
        ragReady: false
      });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/evaluate") {
    try {
      const body = await readJson(request);
      if (!body.session || !body.report) {
        sendJson(response, 400, { error: "Session and report are required." });
        return;
      }

      const citations = Array.isArray(body.citations) ? body.citations : [];
      const evaluator = await evaluateDebriefWithQvac(body.session, body.report, citations);
      sendJson(response, 200, {
        ok: true,
        mode: "qvac-evaluator",
        evaluator
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, strictQvacMode ? 500 : 200, {
        ok: false,
        mode: strictQvacMode ? "strict-qvac-failed" : "deterministic-evaluator-fallback",
        error: message,
        evaluator: null
      });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/extract-topics") {
    try {
      const body = await readJson(request);
      if (!body.turns || !body.mustAsk) {
        sendJson(response, 400, { error: "Turns and mustAsk are required." });
        return;
      }
      const synonyms = body.synonyms || {};
      console.log(`[qvac] extract-topics request for turns:`, JSON.stringify(body.turns.map(t => `${t.speaker}: ${t.text}`)));
      const mapping = await extractTopicsWithQvac(body.turns, body.mustAsk, synonyms);
      console.log(`[qvac] extract-topics output mapping:`, JSON.stringify(mapping));
      sendJson(response, 200, {
        ok: true,
        mapping
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[qvac] extract-topics failed:", message);
      sendJson(response, 500, {
        ok: false,
        error: message
      });
    }
    return;
  }

  sendJson(response, 404, { error: "Not found." });
});

void ensureRagWorkspace();

server.listen(port, "127.0.0.1", () => {
  console.log(`[qvac] bridge listening on http://127.0.0.1:${port}`);
});
