import {
  addAction,
  appendTurn,
  evaluateEncounter,
  revealTopic,
  setDiagnosis,
  setPlan,
  type ActionKind,
  type DebriefReport,
  type EncounterSession
} from "@caseroom/simulation-core";

const defaultRuntimeUrl = "http://127.0.0.1:4545";

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives?: number;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type BrowserSpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: {
      transcript: string;
    };
    length: number;
  }>;
};

type VoiceRuntimeSupport = {
  canTranscribe: boolean;
  canSpeak: boolean;
  recognitionEngine: "qvac-asr" | "web-speech" | "none";
  speechEngine: "qvac-tts" | "speech-synthesis" | "none";
};

export type RuntimeStatus = {
  modelMode: string;
  voiceMode: string;
  storageMode: string;
  completionMode: string;
  retrievalMode: string;
  modelName?: string;
  qvacLocal?: boolean;
  ragReady?: boolean;
  strictQvacMode?: boolean;
};

export type VoiceCaptureController = {
  stop(): void;
  cancel(): void;
};

export type VoiceCaptureOptions = {
  contextPhrases?: string[];
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void | Promise<void>;
  onError?: (message: string) => void;
  onStateChange?: (state: "idle" | "listening" | "processing") => void;
};



export function getRuntimeStatus(): RuntimeStatus {
  const voiceSupport = getVoiceRuntimeSupport();
  return {
    modelMode: "checking local QVAC bridge",
    voiceMode: describeVoiceMode(voiceSupport),
    storageMode: describeStorageMode(),
    completionMode: "auto fallback enabled",
    retrievalMode: "static citations fallback",
    modelName: "detecting...",
    qvacLocal: false,
    ragReady: false,
    strictQvacMode: isStrictQvacMode()
  };
}

function describeStorageMode(): string {
  const desktopWindow = typeof window === "undefined"
    ? null
    : (window as Window & { caseroomDesktop?: { storageMode?: string } });

  if (desktopWindow?.caseroomDesktop?.storageMode) {
    return desktopWindow.caseroomDesktop.storageMode;
  }
  return "browser local storage";
}

function resolveRuntimeUrl(): string {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_CASE_ROOM_QVAC_URL) {
    return import.meta.env.VITE_CASE_ROOM_QVAC_URL;
  }
  return defaultRuntimeUrl;
}

function isStrictQvacMode(): boolean {
  return typeof import.meta !== "undefined" && import.meta.env?.VITE_CASE_ROOM_STRICT_QVAC === "1";
}

function isStrictEvaluatorRequired(): boolean {
  return typeof import.meta !== "undefined" && import.meta.env?.VITE_CASE_ROOM_REQUIRE_EVALUATOR === "1";
}

function isEvaluatorEnabled(): boolean {
  return typeof import.meta !== "undefined" && import.meta.env?.VITE_CASE_ROOM_ENABLE_EVALUATOR === "1";
}

function getEvaluatorTimeoutMs(): number {
  const raw = typeof import.meta !== "undefined" ? import.meta.env?.VITE_CASE_ROOM_EVALUATOR_TIMEOUT_MS : undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3500;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }

  const recognition = (
    window as Window & {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    }
  ).SpeechRecognition ??
    (
      window as Window & {
        webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
      }
    ).webkitSpeechRecognition;

  return recognition ?? null;
}

function getVoiceRuntimeSupport(): VoiceRuntimeSupport {
  const canSpeak =
    typeof window !== "undefined" &&
    (typeof Audio !== "undefined" ||
      ("speechSynthesis" in window && typeof window.SpeechSynthesisUtterance !== "undefined"));

  const recognitionConstructor = getSpeechRecognitionConstructor();
  const canRecord =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof AudioContext !== "undefined";

  return {
    canTranscribe: canRecord || recognitionConstructor !== null,
    canSpeak,
    recognitionEngine: canRecord ? "qvac-asr" : recognitionConstructor ? "web-speech" : "none",
    speechEngine: canSpeak ? "qvac-tts" : "none"
  };
}

function isEnglishVoice(voice: SpeechSynthesisVoice): boolean {
  return voice.lang.toLowerCase().startsWith("en");
}

function rankVoice(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase();
  let score = 0;

  if (voice.default) {
    score += 4;
  }
  if (voice.localService) {
    score += 3;
  }
  if (voice.lang.toLowerCase() === "en-us") {
    score += 4;
  } else if (voice.lang.toLowerCase().startsWith("en")) {
    score += 2;
  }
  if (
    name.includes("samantha") ||
    name.includes("ava") ||
    name.includes("allison") ||
    name.includes("premium") ||
    name.includes("natural")
  ) {
    score += 2;
  }

  return score;
}

async function resolvePreferredVoice(): Promise<SpeechSynthesisVoice | null> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return null;
  }

  const voices = window.speechSynthesis.getVoices();
  const englishVoices = voices.filter(isEnglishVoice);
  if (englishVoices.length > 0) {
    return englishVoices.sort((left, right) => rankVoice(right) - rankVoice(left))[0] ?? null;
  }

  await new Promise<void>((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
      window.clearTimeout(timeoutId);
      resolve();
    };

    const handleVoicesChanged = () => {
      finish();
    };

    const timeoutId = window.setTimeout(finish, 250);
    window.speechSynthesis.addEventListener("voiceschanged", handleVoicesChanged, { once: true });
  });

  const refreshedEnglishVoices = window.speechSynthesis.getVoices().filter(isEnglishVoice);
  return refreshedEnglishVoices.sort((left, right) => rankVoice(right) - rankVoice(left))[0] ?? null;
}

function describeVoiceMode(support: VoiceRuntimeSupport): string {
  if (support.recognitionEngine === "qvac-asr" && support.canSpeak) {
    return "QVAC voice loop ready";
  }
  if (support.canTranscribe && support.canSpeak) {
    return "browser voice loop ready";
  }
  if (support.canTranscribe) {
    return "mic input ready / spoken reply unavailable";
  }
  if (support.canSpeak) {
    return "spoken reply ready / mic input unavailable";
  }
  return "text fallback only";
}

function normalizeLexiconPhrase(value: string): string {
  return value
    .replace(/[_/-]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function uniquePhrases(values: string[]): string[] {
  return [...new Set(values.map(normalizeLexiconPhrase).filter(Boolean))];
}

function expandClinicalPhrase(phrase: string, synonyms: Record<string, string[]> = {}): string[] {
  const normalized = normalizeLexiconPhrase(phrase);
  const words = normalized.split(" ").filter(Boolean);
  const expanded = new Set<string>([normalized]);

  const stopwords = new Set(["of", "and", "the", "or", "any", "your", "have", "with", "about", "after", "at", "in", "on", "to", "for", "is", "was", "am", "are", "do", "you", "my", "me", "has", "had", "been"]);

  for (const [concept, alternatives] of Object.entries(synonyms)) {
    if (normalized === concept || alternatives.includes(normalized)) {
      expanded.add(concept);
      alternatives.forEach((alternative) => expanded.add(alternative));
    }
  }

  for (const word of words) {
    if (stopwords.has(word)) {
      continue;
    }

    if (word.length >= 3) {
      expanded.add(word);
      if (word.endsWith("s") && word.length > 3) {
        expanded.add(word.slice(0, -1));
      } else if (word.length > 3) {
        expanded.add(`${word}s`);
      }
    }

    for (const [concept, alternatives] of Object.entries(synonyms)) {
      if (word === concept || alternatives.includes(word)) {
        expanded.add(concept);
        alternatives.forEach((alternative) => expanded.add(alternative));
      }
    }
  }

  if (words.length > 1) {
    expanded.add(words.join(" "));
  }
  return [...expanded];
}

function buildScenarioLexicon(session: EncounterSession): string[] {
  const hidden = session.scenario.hiddenCase;
  const synonyms = hidden.synonyms ?? {};
  const truthKeys = Object.keys(hidden.truthTable);
  const values = [
    ...hidden.mustAsk,
    ...hidden.redFlags,
    ...truthKeys,
    ...hidden.safetyNet,
    session.scenario.title,
    session.scenario.specialty,
    session.scenario.brief.chiefComplaint,
    hidden.diagnosis
  ];
  return uniquePhrases(values.flatMap((phrase) => expandClinicalPhrase(phrase, synonyms)));
}

export function buildVoiceContextPhrases(session: EncounterSession): string[] {
  return buildScenarioLexicon(session)
    .filter((phrase) => phrase.length >= 3)
    .slice(0, 80);
}

function levenshtein(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let row = 0; row < rows; row += 1) matrix[row][0] = row;
  for (let col = 0; col < cols; col += 1) matrix[0][col] = col;

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost,
      );
    }
  }

  return matrix[left.length][right.length];
}

function shouldCorrectToken(token: string, candidate: string): boolean {
  if (token.length < 4 || candidate.length < 4 || Math.abs(token.length - candidate.length) > 2) {
    return false;
  }
  if (token === candidate) {
    return false;
  }

  const distance = levenshtein(token, candidate);
  const normalizedDistance = distance / Math.max(token.length, candidate.length);
  if (normalizedDistance <= 0.34) {
    return true;
  }

  const sameClinicalStem = token.slice(0, 2) === candidate.slice(0, 2) && token.length <= 6 && candidate.length <= 6;
  return sameClinicalStem && distance <= 3;
}

function normalizeMedicalTranscript(text: string, contextPhrases: string[] = []): string {
  const terms = uniquePhrases(contextPhrases.flatMap((phrase) => expandClinicalPhrase(phrase)))
    .filter((term) => /^[a-z0-9]+$/i.test(term) && term.length >= 4);
  if (terms.length === 0) {
    return text;
  }

  return text.replace(/\b[\p{L}\p{N}]{4,}\b/gu, (token) => {
    const lowerToken = token.toLowerCase();
    if (terms.includes(lowerToken)) {
      return token;
    }
    const correction = terms.find((term) => shouldCorrectToken(lowerToken, term));
    return correction ?? token;
  });
}

function promptMentionsTopic(prompt: string, topic: string, session: EncounterSession): boolean {
  const synonyms = session.scenario.hiddenCase.synonyms ?? {};
  const lowered = normalizeMedicalTranscript(prompt, buildScenarioLexicon(session)).toLowerCase();
  return expandClinicalPhrase(topic, synonyms).some((alias) => {
    const escaped = alias.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(lowered);
  });
}

function normalizePromptForScenario(session: EncounterSession, prompt: string): string {
  return normalizeMedicalTranscript(prompt, buildScenarioLexicon(session));
}

function applyPromptSignals(session: EncounterSession, prompt: string): EncounterSession {
  let next = appendTurn(session, "clinician", prompt);

  for (const topic of Object.keys(session.scenario.hiddenCase.truthTable)) {
    if (promptMentionsTopic(prompt, topic, session)) {
      next = revealTopic(next, topic);
    }
  }

  return next;
}

function answerHistoryFallback(session: EncounterSession, prompt: string): EncounterSession {
  let next = appendTurn(session, "clinician", prompt);
  let matched = false;

  if (/\b(what'?s your name|what is your name|who are you|your name)\b/i.test(prompt)) {
    return addAction(
      appendTurn(next, "patient", `My name is ${session.scenario.brief.patientName}.`),
      "history",
    );
  }

  if (/^\s*(hi|hello|hey|good morning|good afternoon|good evening)\s*[.!?]*\s*$/i.test(prompt)) {
    return addAction(
      appendTurn(next, "patient", `Hello doctor. ${session.scenario.brief.chiefComplaint}`),
      "history",
    );
  }

  for (const [topic, answer] of Object.entries(session.scenario.hiddenCase.truthTable)) {
    if (promptMentionsTopic(prompt, topic, session)) {
      matched = true;
      next = revealTopic(next, topic);
      next = appendTurn(next, "patient", answer);
      break;
    }
  }

  if (!matched) {
    next = appendTurn(
      next,
      "patient",
      `I'm not sure, doctor. ${session.scenario.brief.chiefComplaint}`,
    );
  }

  return addAction(next, "history");
}

async function answerHistory(session: EncounterSession, prompt: string): Promise<EncounterSession> {
  try {
    const response = await fetch(`${resolveRuntimeUrl()}/patient-turn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ session, prompt })
    });

    if (!response.ok) {
      throw new Error(`Runtime responded with ${response.status}.`);
    }

    const payload = (await response.json()) as { reply?: string };
    if (!payload.reply) {
      throw new Error("Runtime returned an empty reply.");
    }

    const next = applyPromptSignals(session, prompt);
    return addAction(appendTurn(next, "patient", payload.reply), "history");
  } catch {
    if (isStrictQvacMode()) {
      throw new Error("Strict QVAC mode is enabled and patient completion failed.");
    }
    return answerHistoryFallback(session, prompt);
  }
}

function answerAction(session: EncounterSession, action: ActionKind): EncounterSession {
  let next = addAction(session, action);
  if (action === "examine") {
    return next;
  }
  if (action === "order_test") {
    return next;
  }
  if (action === "diagnose") {
    const hasEnoughEvidence =
      session.revealedTopics.length >= 2 || session.examPerformed || session.testsOrdered > 0;
    return setDiagnosis(
      next,
      hasEnoughEvidence ? session.scenario.hiddenCase.diagnosis : "More history needed before diagnosis",
    );
  }
  if (action === "treatment_plan") {
    const urgentPlan = next.progress.needsUrgentEscalation;
    const basePlan = urgentPlan
      ? "Urgent assessment and same-day escalation were explained to the patient."
      : "Initial management and follow-up were explained to the patient.";
    const hasSafetyNet = session.planText?.includes("Safety-net advice covered:");
    const safetyNetText = `Safety-net advice covered: ${session.scenario.hiddenCase.safetyNet.join(", ")}.`;
    return setPlan(
      next,
      hasSafetyNet ? `${basePlan} ${safetyNetText}` : basePlan,
    );
  }
  if (action === "safety_net") {
    const safetyNetText = `Safety-net advice covered: ${session.scenario.hiddenCase.safetyNet.join(", ")}.`;
    if (session.planText?.includes("Safety-net advice covered:")) {
      return next;
    }
    return setPlan(
      next,
      session.planText ? `${session.planText} ${safetyNetText}` : safetyNetText,
    );
  }
  return next;
}

export async function generatePatientTurn(
  session: EncounterSession,
  prompt: string,
  action?: ActionKind,
): Promise<{ session: EncounterSession }> {
  if (action) {
    return { session: answerAction(session, action) };
  }
  return { session: await answerHistory(session, prompt) };
}

export async function finishEncounter(session: EncounterSession): Promise<DebriefReport> {
  let report = evaluateEncounter(session);
  try {
    const response = await fetch(`${resolveRuntimeUrl()}/rag/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ session })
    });

    if (!response.ok) {
      if (isStrictQvacMode()) {
        throw new Error(`Strict QVAC mode requires RAG; status ${response.status}.`);
      }
      return report;
    }

    const payload = (await response.json()) as {
      citations?: Array<{ id: string; title: string; excerpt: string }>;
    };

    if (!payload.citations || payload.citations.length === 0) {
      if (isStrictQvacMode()) {
        throw new Error("Strict QVAC mode requires non-empty RAG citations.");
      }
      return report;
    }

    report = {
      ...report,
      citations: payload.citations.map((citation) => ({
        id: citation.id,
        title: citation.title,
        excerpt: citation.excerpt
      }))
    };
  } catch (error) {
    if (isStrictQvacMode()) {
      throw error;
    }
    return report;
  }

  if (!isEvaluatorEnabled() && !isStrictEvaluatorRequired()) {
    return report;
  }

  try {
    const response = await fetchWithTimeout(
      `${resolveRuntimeUrl()}/evaluate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ session, report, citations: report.citations })
      },
      getEvaluatorTimeoutMs(),
    );

    if (!response.ok) {
      if (isStrictQvacMode() && isStrictEvaluatorRequired()) {
        throw new Error(`Strict QVAC mode requires evaluator completion; status ${response.status}.`);
      }
      return report;
    }

    const payload = (await response.json()) as {
      evaluator?: {
        summary?: string;
        strengths?: string[];
        gaps?: string[];
      } | null;
    };

    if (!payload.evaluator) {
      if (isStrictQvacMode() && isStrictEvaluatorRequired()) {
        throw new Error("Strict QVAC mode requires evaluator output.");
      }
      return report;
    }

    return {
      ...report,
      summary: payload.evaluator.summary ?? report.summary,
      strengths: payload.evaluator.strengths?.length ? payload.evaluator.strengths : report.strengths,
      gaps: payload.evaluator.gaps?.length ? payload.evaluator.gaps : report.gaps
    };
  } catch (error) {
    if (isStrictQvacMode() && isStrictEvaluatorRequired()) {
      throw error;
    }
    return report;
  }
}

export async function probeRuntimeStatus(): Promise<RuntimeStatus> {
  const voiceSupport = getVoiceRuntimeSupport();
  try {
    const response = await fetch(`${resolveRuntimeUrl()}/health`);
    if (!response.ok) {
      throw new Error(`Health probe failed with ${response.status}.`);
    }

    const payload = (await response.json()) as {
      modelName?: string;
      modelLoaded?: boolean;
      lastLoadError?: string | null;
      ragStatus?: string;
      ragReady?: boolean;
      ttsReady?: boolean;
      asrReady?: boolean;
      strictQvacMode?: boolean;
    };

    return {
      modelMode: payload.modelLoaded
        ? `QVAC ${payload.modelName ?? "model"} ready`
        : `QVAC bridge reachable${payload.lastLoadError ? " / model idle" : ""}`,
      voiceMode: payload.asrReady && payload.ttsReady ? "QVAC voice loop ready" : describeVoiceMode(voiceSupport),
      storageMode: describeStorageMode(),
      completionMode: payload.modelLoaded ? "local QVAC completion" : "QVAC on-demand load",
      retrievalMode: payload.ragReady ? "persistent local embeddings" : payload.ragStatus ?? "static citations fallback",
      modelName: payload.modelName ?? "Llama 3.2 1B Q4",
      qvacLocal: true,
      ragReady: payload.ragReady,
      strictQvacMode: payload.strictQvacMode ?? isStrictQvacMode()
    };
  } catch {
    return {
      modelMode: "mock fallback active",
      voiceMode: describeVoiceMode(voiceSupport),
      storageMode: describeStorageMode(),
      completionMode: "deterministic fallback",
      retrievalMode: "static citations fallback",
      modelName: "Mock clinical LLM",
      qvacLocal: false,
      ragReady: false,
      strictQvacMode: false
    };
  }
}

export async function warmRuntimeModel(): Promise<void> {
  const response = await fetch(`${resolveRuntimeUrl()}/warmup`, {
    method: "POST"
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Warmup failed with ${response.status}.`);
  }
}

let activeQvacAudio: HTMLAudioElement | null = null;

export function cancelSpeech(): void {
  if (activeQvacAudio) {
    activeQvacAudio.pause();
    activeQvacAudio.src = "";
    activeQvacAudio = null;
  }

  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

async function speakWithQvacTts(text: string): Promise<void> {
  const response = await fetch(`${resolveRuntimeUrl()}/tts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `QVAC TTS failed with ${response.status}.`);
  }

  const payload = (await response.json()) as {
    audioBase64?: string;
    mimeType?: string;
  };
  if (!payload.audioBase64) {
    throw new Error("QVAC TTS returned no audio.");
  }

  const audio = new Audio(`data:${payload.mimeType ?? "audio/wav"};base64,${payload.audioBase64}`);
  activeQvacAudio = audio;
  await audio.play();
  await new Promise<void>((resolve) => {
    audio.onended = () => {
      activeQvacAudio = null;
      resolve();
    };
    audio.onerror = () => {
      activeQvacAudio = null;
      resolve();
    };
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("Could not read microphone audio."));
    reader.readAsDataURL(blob);
  });
}

function mergeAudioChunks(chunks: Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function downsampleAudio(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (targetRate >= sourceRate) {
    return input;
  }

  const ratio = sourceRate / targetRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(Math.floor((index + 1) * ratio), input.length);
    let sum = 0;
    for (let sample = start; sample < end; sample += 1) {
      sum += input[sample] ?? 0;
    }
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  function writeString(offset: number, value: string) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function transcribeAudioBlob(audioBlob: Blob, options: VoiceCaptureOptions): Promise<void> {
  const audioBase64 = await blobToBase64(audioBlob);
  const contextPhrases = options.contextPhrases ?? [];
  const response = await fetch(`${resolveRuntimeUrl()}/asr`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ audioBase64, mimeType: audioBlob.type, contextPhrases })
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `QVAC ASR failed with ${response.status}.`);
  }
  const payload = (await response.json()) as { text?: string };
  const text = (payload.text?.trim() ?? "").trim();
  if (!isMeaningfulTranscript(text)) {
    options.onError?.("I couldn't hear speech clearly. Try again a little closer to the microphone, or type the sentence.");
    return;
  }
  await options.onFinal(text);
}

function isMeaningfulTranscript(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes("[No speech detected]") || /^\[[^\]]+\]$/.test(trimmed)) {
    return false;
  }
  return trimmed.replace(/[^\p{L}\p{N}]/gu, "").length >= 3;
}

function startQvacVoiceCapture(options: VoiceCaptureOptions): VoiceCaptureController | null {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof AudioContext === "undefined"
  ) {
    return null;
  }

  let stream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let silentOutput: GainNode | null = null;
  let stopped = false;
  let cancelled = false;
  const chunks: Float32Array[] = [];

  const cleanup = () => {
    processor?.disconnect();
    silentOutput?.disconnect();
    source?.disconnect();
    void audioContext?.close();
    processor = null;
    silentOutput = null;
    source = null;
    audioContext = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  };

  const finishRecording = () => {
    if (cancelled) {
      cleanup();
      options.onStateChange?.("idle");
      return;
    }

    options.onStateChange?.("processing");
    const sampleRate = audioContext?.sampleRate ?? 48000;
    cleanup();
    const merged = mergeAudioChunks(chunks);
    if (merged.length < sampleRate * 0.35) {
      options.onError?.("I couldn't hear speech clearly. Hold the voice button a moment longer, then try again.");
      options.onStateChange?.("idle");
      return;
    }

    const targetRate = 16000;
    const downsampled = downsampleAudio(merged, sampleRate, targetRate);
    const audioBlob = encodeWav(downsampled, targetRate);
    void transcribeAudioBlob(audioBlob, options)
      .catch((error: unknown) => {
        options.onError?.(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        options.onStateChange?.("idle");
      });
  };

  void navigator.mediaDevices
    .getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })
    .then((mediaStream) => {
      if (stopped) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }

      stream = mediaStream;
      audioContext = new AudioContext();
      source = audioContext.createMediaStreamSource(mediaStream);
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      silentOutput = audioContext.createGain();
      silentOutput.gain.value = 0;
      processor.onaudioprocess = (event) => {
        if (stopped || cancelled) {
          return;
        }
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(silentOutput);
      silentOutput.connect(audioContext.destination);
      options.onStateChange?.("listening");
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      options.onError?.(
        message.includes("Permission") || message.includes("denied")
          ? "Microphone access is blocked. Continue with typing or re-enable the microphone in your browser settings."
          : message,
      );
      options.onStateChange?.("idle");
    });

  return {
    stop() {
      stopped = true;
      finishRecording();
    },
    cancel() {
      stopped = true;
      cancelled = true;
      cleanup();
      options.onStateChange?.("idle");
    }
  };
}

function startWebSpeechCapture(options: VoiceCaptureOptions): VoiceCaptureController | null {
  const SpeechRecognition = getSpeechRecognitionConstructor();
  if (!SpeechRecognition) {
    options.onError?.("Speech recognition is not available in this browser.");
    return null;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  recognition.maxAlternatives = 3;

  recognition.onstart = () => {
    options.onStateChange?.("listening");
  };

  recognition.onresult = (event) => {
    let interim = "";
    let finalText = "";

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result[0]?.transcript?.trim() ?? "";
      if (!transcript) {
        continue;
      }
      if (result.isFinal) {
        finalText = `${finalText} ${transcript}`.trim();
      } else {
        interim = `${interim} ${transcript}`.trim();
      }
    }

    if (interim) {
      options.onInterim?.(interim);
    }

    if (finalText) {
      options.onStateChange?.("processing");
      void Promise.resolve(options.onFinal(finalText)).catch((error: unknown) => {
        options.onError?.(error instanceof Error ? error.message : String(error));
      });
    }
  };

  recognition.onerror = (event) => {
    const readableError =
      event.error === "not-allowed"
        ? "Microphone access is blocked. Continue with typing or re-enable the microphone in your browser settings."
        : event.error === "no-speech"
          ? "No speech was detected."
          : `Speech recognition failed: ${event.error}.`;
    options.onError?.(readableError);
    options.onStateChange?.("idle");
  };

  recognition.onend = () => {
    options.onStateChange?.("idle");
  };

  recognition.start();

  return {
    stop() {
      recognition.stop();
    },
    cancel() {
      recognition.abort();
      options.onStateChange?.("idle");
    }
  };
}

export function startVoiceCapture(options: VoiceCaptureOptions): VoiceCaptureController | null {
  cancelSpeech();
  return startQvacVoiceCapture(options) ?? (isStrictQvacMode() ? null : startWebSpeechCapture(options));
}

export async function speakText(text: string): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  const cleanText = text.trim();
  if (!cleanText) {
    return;
  }

  cancelSpeech();

  try {
    await speakWithQvacTts(cleanText);
    return;
  } catch {
    if (isStrictQvacMode()) {
      throw new Error("Strict QVAC mode is enabled and QVAC TTS failed.");
    }
    // Fall through to browser speech synthesis if QVAC TTS is cold or unavailable.
  }

  if (!("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance === "undefined") {
    return;
  }

  const preferredVoice = await resolvePreferredVoice();

  await new Promise<void>((resolve, reject) => {
    const utterance = new window.SpeechSynthesisUtterance(cleanText);
    utterance.lang = preferredVoice?.lang ?? "en-US";
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }
    utterance.rate = 0.97;
    utterance.pitch = 1;
    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error("Speech synthesis failed."));
    window.speechSynthesis.speak(utterance);
  });
}

export async function extractTopics(
  turns: Array<{ speaker: string; text: string }>,
  mustAsk: string[],
  synonyms: Record<string, string[]>,
): Promise<Record<string, boolean>> {
  try {
    const response = await fetch(`${resolveRuntimeUrl()}/extract-topics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turns, mustAsk, synonyms })
    });
    if (!response.ok) {
      return {};
    }
    const payload = (await response.json()) as { mapping?: Record<string, boolean> };
    return payload.mapping ?? {};
  } catch {
    return {};
  }
}
