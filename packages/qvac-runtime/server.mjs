import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {
  GTE_LARGE_FP16,
  LLAMA_3_2_1B_INST_Q4_0,
  QWEN3_1_7B_INST_Q4,
  QWEN3_600M_INST_Q4,
  TTS_EN_SUPERTONIC_Q8_0,
  VAD_SILERO_5_1_2,
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
const ragWorkspace = "caseroom-medical-osce";
const ragManifestDir = path.resolve(process.cwd(), ".caseroom", "rag");
const ragManifestPath = path.join(ragManifestDir, `${ragWorkspace}.json`);

const supportedModels = {
  LLAMA_3_2_1B_INST_Q4_0,
  QWEN3_600M_INST_Q4,
  QWEN3_1_7B_INST_Q4
};

let modelId = null;
let embeddingModelId = null;
let ttsModelId = null;
let asrModelId = null;
let modelLoadPromise = null;
let embeddingLoadPromise = null;
let ttsLoadPromise = null;
let asrLoadPromise = null;
let activeModelName = requestedModel;
let lastLoadError = null;
let ragStatus = "initializing";
let ragReady = false;
let lastRagError = null;
let ttsReady = false;
let lastTtsError = null;
let asrReady = false;
let lastAsrError = null;

const ttsSampleRate = 44100;

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

async function ensureModelLoaded() {
  if (modelId) {
    return modelId;
  }
  if (modelLoadPromise) {
    return modelLoadPromise;
  }

  const modelSrc = supportedModels[activeModelName] ?? supportedModels.LLAMA_3_2_1B_INST_Q4_0;
  if (!supportedModels[activeModelName]) {
    activeModelName = "LLAMA_3_2_1B_INST_Q4_0";
  }

  modelLoadPromise = (async () => {
    try {
      modelId = await loadModel({
        modelSrc,
        modelConfig: { ctx_size: 4096 },
        onProgress: (progress) => {
          console.log(`[qvac] loading ${activeModelName}: ${progress.percentage.toFixed(1)}%`);
        }
      });
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
    embeddingModelId = await loadModel({
      modelSrc: GTE_LARGE_FP16,
      modelType: "llamacpp-embedding",
      modelConfig: {
        gpuLayers: 99,
        device: "gpu"
      },
      onProgress: (progress) => {
        console.log(`[qvac] loading embeddings: ${progress.percentage.toFixed(1)}%`);
      }
    });
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
      ttsModelId = await loadModel({
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
      });
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
      asrModelId = await loadModel({
        modelSrc: WHISPER_EN_TINY_Q8_0,
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
          console.log(`[qvac] loading Whisper ASR: ${progress.percentage.toFixed(1)}%`);
        }
      });
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

      const { embedding } = await embed({
        modelId: readyEmbeddingModelId,
        text: bundledRagDocuments.map((doc) => doc.content)
      });

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

  if (/\b(pcos|polycystic ovary|you have|you've got|you may have|i think you have|diagnos(?:e|is))\b/i.test(prompt)) {
    return "I didn't know that. Could you explain what that means for me?";
  }

  const readyModelId = await ensureModelLoaded();
  const run = completion({
    modelId: readyModelId,
    history: buildHistory(session, prompt),
    stream: false
  });
  const final = await run.final;
  return sanitizePatientReply(String(final.contentText ?? ""), session);
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
    return `My name is ${session.scenario.brief.patientName}.`;
  }
  if (coachingLeak.test(singleLine) || examinerRecapLeak.test(singleLine)) {
    return `I'm still uncomfortable, doctor. ${session.scenario.brief.chiefComplaint}`;
  }
  if (otherDoctorLeak.test(singleLine)) {
    return "I didn't know that. Could you explain what that means for me?";
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
  const results = await ragSearch({
    workspace: ragWorkspace,
    modelId: readyEmbeddingModelId,
    query: buildRetrievalQuery(session),
    topK: 3
  });

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
      modelName: activeModelName,
      modelLoaded: Boolean(modelId),
      lastLoadError,
      ragStatus,
      ragReady,
      lastRagError,
      ragWorkspace,
      ttsReady,
      lastTtsError,
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

      const readyAsrModelId = await ensureAsrModelLoaded();
      const audioChunk = Buffer.from(audioBase64, "base64");
      const text = await transcribe({
        modelId: readyAsrModelId,
        audioChunk,
        prompt: "English clinical consultation. Transcribe only the clinician's spoken words."
      });
      const transcript = String(text ?? "").replace(/\s+/g, " ").trim();
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
      const samples = await ttsResult.buffer;
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

  sendJson(response, 404, { error: "Not found." });
});

void ensureRagWorkspace();

server.listen(port, "127.0.0.1", () => {
  console.log(`[qvac] bridge listening on http://127.0.0.1:${port}`);
});
