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
  recognitionEngine: "web-speech" | "none";
  speechEngine: "speech-synthesis" | "none";
};

export type RuntimeStatus = {
  modelMode: string;
  voiceMode: string;
  storageMode: string;
  completionMode: string;
  retrievalMode: string;
};

export type VoiceCaptureController = {
  stop(): void;
  cancel(): void;
};

export type VoiceCaptureOptions = {
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
    retrievalMode: "static citations fallback"
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
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance !== "undefined";

  const recognitionConstructor = getSpeechRecognitionConstructor();

  return {
    canTranscribe: recognitionConstructor !== null,
    canSpeak,
    recognitionEngine: recognitionConstructor ? "web-speech" : "none",
    speechEngine: canSpeak ? "speech-synthesis" : "none"
  };
}

function describeVoiceMode(support: VoiceRuntimeSupport): string {
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

function applyPromptSignals(session: EncounterSession, prompt: string): EncounterSession {
  const lowered = prompt.toLowerCase();
  let next = appendTurn(session, "clinician", prompt);

  for (const topic of Object.keys(session.scenario.hiddenCase.truthTable)) {
    if (lowered.includes(topic.replaceAll("_", " "))) {
      next = revealTopic(next, topic);
    }
  }

  return next;
}

function answerHistoryFallback(session: EncounterSession, prompt: string): EncounterSession {
  const lowered = prompt.toLowerCase();
  let next = appendTurn(session, "clinician", prompt);
  let matched = false;

  for (const [topic, answer] of Object.entries(session.scenario.hiddenCase.truthTable)) {
    if (lowered.includes(topic.replaceAll("_", " "))) {
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
      "I am not sure what else matters, but I can tell you more if you ask about symptoms, timing, red flags, or what has changed.",
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
    return answerHistoryFallback(session, prompt);
  }
}

function answerAction(session: EncounterSession, action: ActionKind): EncounterSession {
  let next = addAction(session, action);
  if (action === "examine") {
    if (session.examPerformed) {
      return appendTurn(
        next,
        "patient",
        "You already examined me. Is there something specific you want to go back to?",
      );
    }
    return appendTurn(
      next,
      "patient",
      `Exam findings available: ${session.scenario.hiddenCase.examFindings.join(" ")}`,
    );
  }
  if (action === "order_test") {
    if (session.testsOrdered > 0) {
      return appendTurn(
        next,
        "patient",
        "Those test results were already reviewed. What do they mean for me?",
      );
    }
    return appendTurn(
      next,
      "patient",
      `Results are back: ${session.scenario.hiddenCase.testResults.join(" ")}`,
    );
  }
  if (action === "diagnose") {
    const hasEnoughEvidence =
      session.revealedTopics.length >= 2 || session.examPerformed || session.testsOrdered > 0;
    next = setDiagnosis(
      next,
      hasEnoughEvidence ? session.scenario.hiddenCase.diagnosis : "premature diagnosis attempt",
    );
    return appendTurn(
      next,
      "patient",
      hasEnoughEvidence
        ? "Thank you. Can you explain what you think is going on?"
        : "That feels a bit fast. Can I tell you a little more before you decide?",
    );
  }
  if (action === "treatment_plan") {
    const urgentPlan = next.progress.needsUrgentEscalation;
    next = setPlan(
      next,
      urgentPlan
        ? "Urgent assessment and same-day escalation were explained to the patient."
        : "Initial management and follow-up were explained to the patient.",
    );
    return appendTurn(
      next,
      "patient",
      urgentPlan
        ? "So you think I should be seen urgently today?"
        : "That sounds clear. What should I watch out for?",
    );
  }
  if (action === "safety_net") {
    return appendTurn(
      next,
      "patient",
      next.progress.needsUrgentEscalation
        ? `Understood. If this gets worse before I am seen urgently, I should seek help immediately for ${session.scenario.hiddenCase.safetyNet.join(", ")}.`
        : `Understood. I will seek urgent help if any of these happen: ${session.scenario.hiddenCase.safetyNet.join(", ")}.`,
    );
  }
  return appendTurn(next, "patient", "Please go ahead.");
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
  const report = evaluateEncounter(session);
  try {
    const response = await fetch(`${resolveRuntimeUrl()}/rag/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ session })
    });

    if (!response.ok) {
      return report;
    }

    const payload = (await response.json()) as {
      citations?: Array<{ id: string; title: string; excerpt: string }>;
    };

    if (!payload.citations || payload.citations.length === 0) {
      return report;
    }

    return {
      ...report,
      citations: payload.citations.map((citation) => ({
        id: citation.id,
        title: citation.title,
        excerpt: citation.excerpt
      }))
    };
  } catch {
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
    };

    return {
      modelMode: payload.modelLoaded
        ? `QVAC ${payload.modelName ?? "model"} ready`
        : `QVAC bridge reachable${payload.lastLoadError ? " / model idle" : ""}`,
      voiceMode: describeVoiceMode(voiceSupport),
      storageMode: describeStorageMode(),
      completionMode: payload.modelLoaded ? "local QVAC completion" : "QVAC on-demand load",
      retrievalMode: payload.ragReady ? "persistent local embeddings" : payload.ragStatus ?? "static citations fallback"
    };
  } catch {
    return {
      modelMode: "mock fallback active",
      voiceMode: describeVoiceMode(voiceSupport),
      storageMode: describeStorageMode(),
      completionMode: "deterministic fallback",
      retrievalMode: "static citations fallback"
    };
  }
}

export function startVoiceCapture(options: VoiceCaptureOptions): VoiceCaptureController | null {
  const SpeechRecognition = getSpeechRecognitionConstructor();
  if (!SpeechRecognition) {
    options.onError?.("Speech recognition is not available in this browser.");
    return null;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";

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
        ? "Microphone access was denied."
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

export async function speakText(text: string): Promise<void> {
  if (
    typeof window === "undefined" ||
    !("speechSynthesis" in window) ||
    typeof window.SpeechSynthesisUtterance === "undefined"
  ) {
    return;
  }

  const cleanText = text.trim();
  if (!cleanText) {
    return;
  }

  window.speechSynthesis.cancel();

  await new Promise<void>((resolve, reject) => {
    const utterance = new window.SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1;
    utterance.pitch = 0.95;
    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error("Speech synthesis failed."));
    window.speechSynthesis.speak(utterance);
  });
}
