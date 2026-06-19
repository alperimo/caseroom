import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  FileText,
  LockKeyhole,
  Mic,
  Play,
  Send,
  ShieldCheck,
  Stethoscope,
  TestTube2,
  UserRound,
  Volume2
} from "lucide-react";
import { medicalCasePack } from "@caseroom/case-packs-medical-osce";
import {
  buildDebriefHighlights,
  createSession,
  formatPercent,
  type ActionKind,
  type EncounterSession,
  type MedicalScenario
} from "@caseroom/simulation-core";
import {
  buildVoiceContextPhrases,
  cancelSpeech,
  finishEncounter,
  generatePatientTurn,
  getRuntimeStatus,
  probeRuntimeStatus,
  speakText,
  startVoiceCapture,
  warmRuntimeModel,
  type VoiceCaptureController,
  type RuntimeStatus
} from "@caseroom/qvac-runtime";
import {
  deletePersistedRun,
  getStorageModeLabel,
  loadPersistedRuns,
  savePersistedRun,
  type PersistedRun
} from "./sessionStore";
import { saveEvidenceArtifact } from "./exportArtifacts";

type Screen = "lobby" | "brief" | "room" | "debrief";
type DebriefRun = PersistedRun<ReturnType<typeof buildDebriefHighlights>>;
type ClinicalFinding = {
  title: string;
  detail: string;
};

type ActionOverlay = {
  kind: Exclude<ActionKind, "history">;
  title: string;
  eyebrow: string;
  summary: string;
  items: string[];
  primaryLabel: string;
  statusLabel: string;
  nextStep: string;
};

type ActionState = "done" | "ready" | "needs";

type ActionStatus = {
  state: ActionState;
  label: string;
};

function getPatientInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatDifficulty(difficulty: MedicalScenario["difficulty"]): string {
  return difficulty === "easy" ? "Guided" : difficulty === "medium" ? "Focused" : "High stakes";
}

function buildClinicalFindings(session: EncounterSession): ClinicalFinding[] {
  const findings: ClinicalFinding[] = [];

  if (session.examPerformed) {
    findings.push({
      title: "Exam",
      detail: session.scenario.hiddenCase.examFindings.join(" ")
    });
  }
  if (session.testsOrdered > 0) {
    findings.push({
      title: "Results",
      detail: session.scenario.hiddenCase.testResults.join(" ")
    });
  }
  if (session.diagnosisText) {
    findings.push({
      title: "Impression",
      detail: session.diagnosisText
    });
  }
  if (session.planText) {
    findings.push({
      title: "Plan",
      detail: session.planText
    });
  }

  return findings;
}

function buildActionOverlay(session: EncounterSession, kind: Exclude<ActionKind, "history">): ActionOverlay {
  if (kind === "examine") {
    const missingTopics = session.progress.missingCriticalTopics.slice(0, 2);
    return {
      kind,
      eyebrow: "Bedside exam",
      title: "Focused examination",
      summary: "Exam findings are now in the chart. They support risk assessment, but they do not replace focused history.",
      items: session.scenario.hiddenCase.examFindings,
      primaryLabel: "Return to room",
      statusLabel: "Exam documented",
      nextStep: missingTopics.length > 0
        ? `Clarify next: ${missingTopics.join(", ")}.`
        : "Move to tests or commit an impression."
    };
  }

  if (kind === "order_test") {
    const shouldEscalate = session.progress.needsUrgentEscalation;
    return {
      kind,
      eyebrow: "Results",
      title: "Tests reviewed",
      summary: "Results are available for interpretation. Use them to support, challenge, or escalate your working impression.",
      items: session.scenario.hiddenCase.testResults,
      primaryLabel: "Continue consult",
      statusLabel: "Results available",
      nextStep: shouldEscalate
        ? "Risk is now high enough to explain urgent escalation."
        : "If the history is complete, commit an impression."
    };
  }

  if (kind === "diagnose") {
    const missingTopics = session.progress.missingCriticalTopics;
    return {
      kind,
      eyebrow: "Clinical impression",
      title: "Working diagnosis",
      summary: session.diagnosisText ?? "A working diagnosis needs enough history, exam, or test evidence.",
      items: missingTopics.length > 0
        ? missingTopics.map((topic) => `Still clarify: ${topic}`)
        : ["Key critical topics have been addressed."],
      primaryLabel: "Use in plan",
      statusLabel: missingTopics.length > 0 ? "Provisional" : "Ready for plan",
      nextStep: missingTopics.length > 0
        ? "Ask the missing red-flag questions before relying on this diagnosis."
        : "Explain the plan and safety net."
    };
  }

  if (kind === "treatment_plan") {
    const hasMissingCriticalTopics = session.progress.missingCriticalTopics.length > 0;
    return {
      kind,
      eyebrow: "Plan",
      title: "Management plan",
      summary: session.planText ?? "Plan not documented yet.",
      items: session.progress.escalationReasons.length > 0
        ? session.progress.escalationReasons
        : ["No immediate escalation triggers are documented from the visible state."],
      primaryLabel: "Back to patient",
      statusLabel: session.progress.needsUrgentEscalation ? "Urgent plan" : "Plan documented",
      nextStep: hasMissingCriticalTopics
        ? "Before finishing, close the remaining history gaps or acknowledge uncertainty."
        : "Add explicit return precautions before ending."
    };
  }

  return {
    kind,
    eyebrow: "Safety net",
    title: "Return precautions",
    summary: session.planText ?? "Safety-net advice has been added to the plan.",
    items: session.scenario.hiddenCase.safetyNet,
    primaryLabel: "Finish advice",
    statusLabel: "Safety net added",
    nextStep: "If diagnosis and plan are documented, end the encounter for debrief."
  };
}

function getActionStatus(session: EncounterSession, kind: ActionKind): ActionStatus {
  if (kind === "history") {
    return session.progress.missingCriticalTopics.length === 0
      ? { state: "done", label: "covered" }
      : { state: "needs", label: `${session.progress.missingCriticalTopics.length} left` };
  }
  if (kind === "examine") {
    return session.examPerformed ? { state: "done", label: "done" } : { state: "ready", label: "ready" };
  }
  if (kind === "order_test") {
    return session.testsOrdered > 0 ? { state: "done", label: "reviewed" } : { state: "ready", label: "ready" };
  }
  if (kind === "diagnose") {
    if (session.diagnosisText && !session.diagnosisText.toLowerCase().includes("more history")) {
      return { state: "done", label: "set" };
    }
    return session.progress.missingCriticalTopics.length > 0
      ? { state: "needs", label: "needs history" }
      : { state: "ready", label: "ready" };
  }
  if (kind === "treatment_plan") {
    return session.planText ? { state: "done", label: "set" } : { state: "ready", label: "ready" };
  }
  return session.planText?.includes("Safety-net advice covered")
    ? { state: "done", label: "given" }
    : { state: "ready", label: "ready" };
}

function formatSavedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Saved locally";
  }
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function App() {
  const initialRuntime = useMemo(
    () => ({
      ...getRuntimeStatus(),
      storageMode: getStorageModeLabel()
    }),
    [],
  );
  const [runtime, setRuntime] = useState<RuntimeStatus>(initialRuntime);
  const [screen, setScreen] = useState<Screen>("lobby");
  const [selectedCase, setSelectedCase] = useState<MedicalScenario | null>(null);
  const [session, setSession] = useState<EncounterSession | null>(null);
  const [message, setMessage] = useState("");
  const [voiceState, setVoiceState] = useState<"idle" | "listening" | "processing">("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [history, setHistory] = useState<DebriefRun[]>([]);
  const [activeRun, setActiveRun] = useState<DebriefRun | null>(null);
  const [activeReport, setActiveReport] = useState<DebriefRun["report"] | null>(null);
  const [activeActionOverlay, setActiveActionOverlay] = useState<ActionOverlay | null>(null);
  const [exportState, setExportState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [isPrompting, setIsPrompting] = useState(false);
  const [isEndingEncounter, setIsEndingEncounter] = useState(false);
  const voiceControllerRef = useRef<VoiceCaptureController | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const historyRef = useRef<DebriefRun[]>([]);
  const promptInFlightRef = useRef<string | null>(null);
  const lastSubmittedPromptRef = useRef<{ normalized: string; submittedAt: number } | null>(null);
  const lastDraftSignatureRef = useRef<string | null>(null);
  const initialSpokenSessionIdRef = useRef<string | null>(null);
  const warmupAttemptedRef = useRef(false);
  const draftRuns = history.filter((item) => item.status === "in_progress" && item.session);
  const completedRuns = history.filter((item) => item.status === "completed");

  function productizeStatusLabel(label: string): string {
    if (label.includes("bridge reachable")) {
      return "Private AI standby";
    }
    if (label.includes("local QVAC completion")) {
      return "Private replies live";
    }
    if (label.includes("QVAC on-demand load")) {
      return "Preparing AI";
    }
    if (label.includes("QVAC voice loop")) {
      return "Voice conversation ready";
    }
    if (label.includes("QVAC") || label.includes("model")) {
      return "Private AI ready";
    }
    if (label.includes("fallback")) {
      return "Clinical fallback";
    }
    if (label.includes("persistent local embeddings")) {
      return "Knowledge ready";
    }
    if (label.includes("static citations")) {
      return "Knowledge available";
    }
    if (label.includes("local SQLite sessions")) {
      return "Saved privately on this device";
    }
    if (label.includes("browser local storage")) {
      return "Saved on this device";
    }
    if (label.includes("voice loop")) {
      return "Voice conversation ready";
    }
    if (label.includes("mic input ready")) {
      return "Microphone ready";
    }
    if (label.includes("spoken reply ready")) {
      return "Patient voice ready";
    }
    if (label.includes("text fallback only")) {
      return "Text mode";
    }
    return label;
  }

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      const persistedRuns = await loadPersistedRuns<DebriefRun["report"]>();
      if (!cancelled) {
        setHistory(persistedRuns);
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshRuntime() {
      const status = await probeRuntimeStatus();
      if (!cancelled) {
        setRuntime({
          ...status,
          storageMode: getStorageModeLabel()
        });
      }

      if (status.completionMode === "QVAC on-demand load" && !warmupAttemptedRef.current) {
        warmupAttemptedRef.current = true;
        try {
          await warmRuntimeModel();
          const warmedStatus = await probeRuntimeStatus();
          if (!cancelled) {
            setRuntime({
              ...warmedStatus,
              storageMode: getStorageModeLabel()
            });
          }
        } catch {
          // Keep fallback/runtime probe state if warmup fails.
        }
      }
    }

    void refreshRuntime();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    return () => {
      voiceControllerRef.current?.cancel();
      voiceControllerRef.current = null;
      cancelSpeech();
    };
  }, []);

  useEffect(() => {
    if (screen !== "room") {
      return;
    }
    window.requestAnimationFrame(() => {
      transcriptEndRef.current?.scrollIntoView({ block: "end" });
    });
  }, [screen, session?.transcript.length]);

  useEffect(() => {
    if (!session || screen !== "room" || initialSpokenSessionIdRef.current === session.id) {
      return;
    }

    const openingTurn = session.transcript.find((turn) => turn.speaker === "patient");
    if (!openingTurn) {
      return;
    }

    initialSpokenSessionIdRef.current = session.id;
    void speakText(openingTurn.text).catch((error: unknown) => {
      setVoiceError(error instanceof Error ? error.message : String(error));
    });
  }, [screen, session]);

  useEffect(() => {
    if (!session || (screen !== "brief" && screen !== "room")) {
      return;
    }

    const signature = JSON.stringify({
      id: session.id,
      screen,
      turnCount: session.turnCount,
      actionLog: session.actionLog,
      revealedTopics: session.revealedTopics,
      diagnosisText: session.diagnosisText,
      planText: session.planText,
      remainingMinutes: session.progress.remainingMinutes
    });

    if (lastDraftSignatureRef.current === signature) {
      return;
    }

    lastDraftSignatureRef.current = signature;

    const draftEntry: DebriefRun = {
      id: session.id,
      caseId: session.scenario.id,
      report: {
        title: session.scenario.title,
        summary: session.scenario.brief.chiefComplaint,
        overallScore: 0,
        strengths: [],
        gaps: [],
        citations: []
      },
      finishedAt: new Date().toISOString(),
      transcript: session.transcript,
      session,
      status: "in_progress"
    };

    void savePersistedRun(draftEntry, historyRef.current).then((nextHistory) => {
      setHistory(nextHistory);
    });
  }, [screen, session]);

  function chooseCase(scenario: MedicalScenario) {
    setSelectedCase(scenario);
    const nextSession = createSession(scenario);
    setSession(nextSession);
    initialSpokenSessionIdRef.current = null;
    setActiveRun(null);
    setActiveReport(null);
    setExportState("idle");
    setExportMessage(null);
    setActiveActionOverlay(null);
    setScreen("brief");
  }

  function playOpeningTurn(nextSession: EncounterSession) {
    if (initialSpokenSessionIdRef.current === nextSession.id) {
      return;
    }

    const openingTurn = nextSession.transcript.find((turn) => turn.speaker === "patient");
    if (!openingTurn) {
      return;
    }

    initialSpokenSessionIdRef.current = nextSession.id;
    voiceControllerRef.current?.cancel();
    voiceControllerRef.current = null;
    void speakText(openingTurn.text).catch((error: unknown) => {
      setVoiceError(error instanceof Error ? error.message : String(error));
    });
  }

  function enterRoom() {
    if (!session) {
      return;
    }

    setScreen("room");
    playOpeningTurn(session);
  }

  async function submitPrompt(promptText: string) {
    if (!session || !promptText.trim()) {
      return;
    }

    const normalizedPrompt = promptText.trim().replace(/\s+/g, " ").toLowerCase();
    const lastSubmittedPrompt = lastSubmittedPromptRef.current;
    if (promptInFlightRef.current === normalizedPrompt) {
      return;
    }
    if (
      lastSubmittedPrompt?.normalized === normalizedPrompt &&
      Date.now() - lastSubmittedPrompt.submittedAt < 20_000
    ) {
      return;
    }

    promptInFlightRef.current = normalizedPrompt;
    lastSubmittedPromptRef.current = {
      normalized: normalizedPrompt,
      submittedAt: Date.now()
    };
    setIsPrompting(true);
    let response: Awaited<ReturnType<typeof generatePatientTurn>>;
    try {
      response = await generatePatientTurn(session, promptText.trim());
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : String(error));
      return;
    } finally {
      promptInFlightRef.current = null;
      setIsPrompting(false);
    }
    setSession(response.session);
    const latestTurn = response.session.transcript[response.session.transcript.length - 1];
    if (latestTurn?.speaker === "patient") {
      try {
        voiceControllerRef.current?.cancel();
        voiceControllerRef.current = null;
        await speakText(latestTurn.text);
      } catch (error) {
        setVoiceError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function sendPrompt() {
    if (!message.trim()) {
      return;
    }

    const promptText = message.trim();
    setMessage("");
    await submitPrompt(promptText);
  }

  function toggleVoiceCapture() {
    if (isPrompting || isEndingEncounter) {
      return;
    }

    if (voiceState === "listening") {
      voiceControllerRef.current?.stop();
      return;
    }

    setVoiceError(null);
    cancelSpeech();
    voiceControllerRef.current = startVoiceCapture({
      contextPhrases: session ? buildVoiceContextPhrases(session) : [],
      onInterim(text) {
        setMessage(text);
      },
      async onFinal(text) {
        setMessage(text);
        await submitPrompt(text);
        setMessage("");
      },
      onError(errorMessage) {
        setVoiceError(errorMessage);
      },
      onStateChange(state) {
        setVoiceState(state);
      }
    });

    if (!voiceControllerRef.current) {
      setVoiceState("idle");
    }
  }

  async function runAction(kind: ActionKind) {
    if (!session || isPrompting || isEndingEncounter) {
      return;
    }
    if (kind === "history") {
      toggleVoiceCapture();
      return;
    }
    const response = await generatePatientTurn(session, "", kind);
    setSession(response.session);
    setActiveActionOverlay(buildActionOverlay(response.session, kind));
  }

  async function endEncounter() {
    if (!session || isEndingEncounter) {
      return;
    }

    setIsEndingEncounter(true);
    setVoiceError(null);
    voiceControllerRef.current?.cancel();
    voiceControllerRef.current = null;
    cancelSpeech();
    let report: Awaited<ReturnType<typeof finishEncounter>>;
    try {
      report = await finishEncounter(session);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : String(error));
      setIsEndingEncounter(false);
      return;
    }
    const entry: DebriefRun = {
      id: session.id,
      caseId: session.scenario.id,
      report: buildDebriefHighlights(report),
      finishedAt: new Date().toISOString(),
      transcript: session.transcript,
      session,
      status: "completed"
    };
    const nextHistory = await savePersistedRun(entry, history);
    setHistory(nextHistory);
    setActiveRun(entry);
    setActiveReport(entry.report);
    setExportState("idle");
    setExportMessage(null);
    setActiveActionOverlay(null);
    setScreen("debrief");
    setIsEndingEncounter(false);
  }

  function openSavedDebrief(run: DebriefRun) {
    voiceControllerRef.current?.cancel();
    setSelectedCase(null);
    setSession(run.session);
    setMessage("");
    setVoiceState("idle");
    setVoiceError(null);
    setActiveRun(run);
    setActiveReport(run.report);
    setExportState("idle");
    setExportMessage(null);
    setActiveActionOverlay(null);
    setScreen("debrief");
  }

  function resumeEncounter(run: DebriefRun) {
    if (!run.session) {
      return;
    }

    voiceControllerRef.current?.cancel();
    setSelectedCase(run.session.scenario);
    setSession(run.session);
    initialSpokenSessionIdRef.current = run.session.id;
    setMessage("");
    setVoiceState("idle");
    setVoiceError(null);
    setActiveRun(null);
    setActiveReport(null);
    setExportState("idle");
    setExportMessage(null);
    setActiveActionOverlay(null);
    setScreen("room");
  }

  async function discardDraft(run: DebriefRun) {
    const shouldDiscard = window.confirm(
      `Discard the saved draft for "${run.report.title}"? This will keep completed debriefs untouched.`,
    );
    if (!shouldDiscard) {
      return;
    }

    const nextHistory = await deletePersistedRun(run.id, historyRef.current);
    lastDraftSignatureRef.current = null;
    setHistory(nextHistory);
  }

  async function exportReport() {
    if (!activeRun) {
      return;
    }

    setExportState("saving");
    setExportMessage(null);
    try {
      const result = await saveEvidenceArtifact(activeRun);
      if (!result.saved) {
        setExportState("idle");
        return;
      }
      setExportState("saved");
      setExportMessage(result.location ? `Report saved to ${result.location}` : "Report downloaded.");
    } catch (error) {
      setExportState("error");
      setExportMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function resetFlow() {
    voiceControllerRef.current?.cancel();
    setScreen("lobby");
    setSelectedCase(null);
    setSession(null);
    initialSpokenSessionIdRef.current = null;
    setMessage("");
    setVoiceState("idle");
    setVoiceError(null);
    setActiveRun(null);
    setActiveReport(null);
    setExportState("idle");
    setExportMessage(null);
    setActiveActionOverlay(null);
  }

  const latestPatientTurn = session?.transcript.slice().reverse().find((turn) => turn.speaker === "patient");
  const clinicalFindings = session ? buildClinicalFindings(session) : [];

  return (
    <div className="app-shell">
      {screen === "lobby" && (
        <header className="topbar">
          <div className="topbar-copy">
            <p className="eyebrow">CaseRoom</p>
            <h1>Clinical simulation room</h1>
            <p className="topbar-note">
              Practice a focused patient encounter, make decisions under pressure, then review the debrief.
            </p>
          </div>
          <div className="status-strip">
            <span className="status-pill success">
              <LockKeyhole size={15} />
              On this device
            </span>
            <span className="status-pill neutral">
              <Mic size={15} />
              Voice practice
            </span>
            <span className="status-pill warning">
              <Clock3 size={15} />
              Timed drills
            </span>
          </div>
        </header>
      )}

      {screen === "lobby" && (
        <section className="hero-grid">
          <div className="hero-copy card compact-hero simulator-hero">
            <div>
              <p className="eyebrow">Simulation Deck</p>
              <h2>Choose today&apos;s patient and run the consult.</h2>
              <p className="lead">
                Each case starts with a doorway brief, moves into a voice-first room, and ends with a scored clinical debrief.
              </p>
            </div>
            <div className="hero-room-preview" aria-hidden="true">
              <div className="preview-wall" />
              <div className="preview-patient">
                <UserRound size={28} />
              </div>
              <div className="preview-bubble">“Doctor, I&apos;m worried.”</div>
              <div className="preview-monitor">
                <Activity size={16} />
                <span>HR 88</span>
                <span>SpO2 99</span>
              </div>
            </div>
            <div className="hero-metrics">
              <div className="metric-tile">
                <span>Cases</span>
                <strong>{medicalCasePack.length}</strong>
              </div>
              <div className="metric-tile">
                <span>Mode</span>
                <strong>Private</strong>
              </div>
              <div className="metric-tile">
                <span>Saved runs</span>
                <strong>{history.length}</strong>
              </div>
            </div>
          </div>
          <div className="hero-copy card quick-steps simulator-steps">
            <p className="eyebrow">Room Flow</p>
            <div className="step-row">
              <span><strong>01</strong> Read doorway brief</span>
              <span><strong>02</strong> Speak with the patient</span>
              <span><strong>03</strong> Review the debrief</span>
            </div>
          </div>
        </section>
      )}

      {screen === "lobby" && (
        <main className="page-grid">
          <section className="card panel-span-2">
            <div className="section-header">
              <div>
                <p className="eyebrow">Patient Queue</p>
                <h2>Select a room</h2>
              </div>
              <span className="status-pill neutral">{medicalCasePack.length} ready</span>
            </div>
            <div className="case-grid">
              {medicalCasePack.map((scenario) => (
                <button
                  className={`case-card case-card-${scenario.difficulty}`}
                  key={scenario.id}
                  onClick={() => chooseCase(scenario)}
                >
                  <div className="case-card-top">
                    <span className="case-avatar">{getPatientInitials(scenario.brief.patientName)}</span>
                    <div className="case-meta">
                      <span>{scenario.specialty}</span>
                      <span>{formatDifficulty(scenario.difficulty)}</span>
                    </div>
                  </div>
                  <h3>{scenario.title}</h3>
                  <p>{scenario.brief.chiefComplaint}</p>
                  <div className="case-tags">
                    <span>{scenario.brief.age} years old</span>
                    <span>{scenario.brief.timerMinutes ?? (scenario.difficulty === "easy" ? 12 : scenario.difficulty === "medium" ? 10 : 8)} mins</span>
                    <span>{scenario.hiddenCase.mustAsk.length} history topics</span>
                  </div>
                  <span className="case-cta">
                    Open room
                    <ChevronRight size={17} />
                  </span>
                </button>
              ))}
            </div>
          </section>

          <aside className="card saved-work panel-span-2">
            <div className="saved-work-header">
              <div>
                <p className="eyebrow">Saved Work</p>
                <h2>Practice record</h2>
                <p className="muted">
                  Resume interrupted rooms or review completed debriefs stored on this device.
                </p>
              </div>
              <div className="saved-summary">
                <span>
                  <strong>{draftRuns.length}</strong>
                  Drafts
                </span>
                <span>
                  <strong>{completedRuns.length}</strong>
                  Debriefs
                </span>
                <span>
                  <strong>
                    {completedRuns.length > 0
                      ? formatPercent(Math.max(...completedRuns.map((item) => item.report.overallScore)))
                      : "-"}
                  </strong>
                  Best score
                </span>
              </div>
            </div>

            <div className="saved-work-grid">
              <section className="saved-section" aria-label="Draft encounters">
                <div className="saved-section-header">
                  <h3>In progress</h3>
                  <span>{draftRuns.length} draft{draftRuns.length === 1 ? "" : "s"}</span>
                </div>
                {draftRuns.length === 0 ? (
                  <div className="saved-empty compact">
                    <Clock3 size={22} />
                    <p>Active rooms you leave mid-consult will appear here.</p>
                  </div>
                ) : (
                  <ul className="history-list saved-list">
                    {draftRuns.slice(0, 5).map((item) => (
                      <li key={`${item.caseId}-${item.finishedAt}`}>
                        <div className="history-actions">
                          <button
                            className="history-entry saved-entry"
                            onClick={() => resumeEncounter(item)}
                            type="button"
                          >
                            <span>
                              <strong>{item.report.title}</strong>
                              <small>{formatSavedDate(item.finishedAt)}</small>
                            </span>
                            <span className="entry-cta">Resume</span>
                          </button>
                          <button
                            className="ghost-button history-discard"
                            onClick={() => {
                              void discardDraft(item);
                            }}
                            type="button"
                          >
                            Discard
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="saved-section" aria-label="Completed debriefs">
                <div className="saved-section-header">
                  <h3>Debriefs</h3>
                  <span>{completedRuns.length} saved</span>
                </div>
                {completedRuns.length === 0 ? (
                  <div className="saved-empty compact">
                    <FileText size={22} />
                    <p>Finish a room to create a scored debrief and transcript.</p>
                  </div>
                ) : (
                  <ul className="history-list saved-list">
                    {completedRuns.slice(0, 5).map((item) => (
                      <li key={`${item.caseId}-${item.finishedAt}`}>
                        <button
                          className="history-entry saved-entry"
                          onClick={() => openSavedDebrief(item)}
                          type="button"
                        >
                          <span>
                            <strong>{item.report.title}</strong>
                            <small>{formatSavedDate(item.finishedAt)}</small>
                          </span>
                          <span className="score-chip">{formatPercent(item.report.overallScore)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </aside>
        </main>
      )}

      {screen === "brief" && selectedCase && session && (
        <main className="brief-shell">
          <section className="card doorway-brief briefing-console">
            <div className="briefing-main">
              <div className="briefing-id">
                <span className="case-avatar large">{getPatientInitials(selectedCase.brief.patientName)}</span>
                <div>
                  <p className="eyebrow">Doorway Brief</p>
                  <h2>
                    {selectedCase.brief.patientName}, {selectedCase.brief.age}
                  </h2>
                  <p>{selectedCase.specialty} · {formatDifficulty(selectedCase.difficulty)}</p>
                </div>
              </div>

              <div className="briefing-quote">
                <span>Reason for visit</span>
                <strong>“{selectedCase.brief.chiefComplaint}”</strong>
              </div>

              <div className="briefing-vitals" aria-label="Visible vitals">
                <span><Activity size={16} /> HR {selectedCase.brief.visibleVitals.hr}</span>
                <span>BP {selectedCase.brief.visibleVitals.bp}</span>
                <span>RR {selectedCase.brief.visibleVitals.rr}</span>
                <span>SpO2 {selectedCase.brief.visibleVitals.spo2}</span>
                <span>Temp {selectedCase.brief.visibleVitals.temp}</span>
              </div>
            </div>

            <aside className="briefing-side">
              <p className="eyebrow">Room Objectives</p>
              <div className="briefing-checklist">
                {selectedCase.brief.tasks.map((task, index) => (
                  <span key={task}>
                    <strong>{index + 1}</strong>
                    {task}
                  </span>
                ))}
              </div>
              <div className="briefing-actions">
                <button className="ghost-button" onClick={resetFlow}>
                  Back to lobby
                </button>
                <button className="primary-button enter-room-button" onClick={enterRoom}>
                  <Play size={18} />
                  Enter room
                </button>
              </div>
            </aside>
          </section>
        </main>
      )}

      {screen === "debrief" && activeReport && (
        <main className="debrief-shell">
          <section className="card debrief-console">
            <div className="debrief-hero">
              <div>
                <p className="eyebrow">Debrief</p>
                <h2>{activeReport.title}</h2>
                <p>{activeReport.summary}</p>
              </div>
              <div className="debrief-score">
                <span>Clinical score</span>
                <strong>{formatPercent(activeReport.overallScore)}</strong>
              </div>
            </div>

            <div className="debrief-grid">
              <div className="debrief-panel strengths">
                <h3>What went well</h3>
                <ul className="compact-list">
                  {activeReport.strengths.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="debrief-panel gaps">
                <h3>What to improve</h3>
                <ul className="compact-list">
                  {activeReport.gaps.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="citations-box debrief-panel">
              <h3>Source-backed notes</h3>
              <ul className="compact-list">
                {activeReport.citations.map((citation) => (
                  <li key={citation}>
                    {citation}
                  </li>
                ))}
              </ul>
            </div>

            <div className="action-row">
              <button className="secondary-button" onClick={exportReport} type="button">
                {exportState === "saving" ? "Saving report..." : "Save report"}
              </button>
              <button className="primary-button" onClick={resetFlow} type="button">
                Return to lobby
              </button>
            </div>
            {exportMessage ? (
              <p className={exportState === "error" ? "export-feedback error" : "export-feedback"}>
                {exportMessage}
              </p>
            ) : null}
          </section>
        </main>
      )}

      {screen === "room" && selectedCase && session && (
        <main className="simulation-room simulation-room-full">
          <section className="room-stage" aria-label="Consultation room">
            <div className="room-topline">
              <div>
                <p className="eyebrow">In Room</p>
                <h2>{selectedCase.title}</h2>
              </div>
              <div className="room-meta-row">
                <span className={`status-pill risk-${session.progress.riskLevel}`}>
                  Risk {session.progress.riskLevel}
                </span>
                <span className="status-pill neutral">{session.progress.remainingMinutes} min</span>
                <span className="status-pill neutral">{Math.round(session.progress.completionRatio * 100)}%</span>
              </div>
            </div>

            <div className="scene-canvas">
              <div className="scene-back-wall" />
              <div className="scene-floor" />
              <div className="ceiling-light" />
              <div className="exam-bed" />
              <div className="wall-board">
                <span>{selectedCase.specialty}</span>
                <strong>{session.progress.stateLabel}</strong>
              </div>
              <div className="vitals-monitor">
                <div className="monitor-title">
                  <Activity size={16} />
                  <span>Vitals</span>
                </div>
                <strong>HR {selectedCase.brief.visibleVitals.hr}</strong>
                <strong>BP {selectedCase.brief.visibleVitals.bp}</strong>
                <strong>SpO2 {selectedCase.brief.visibleVitals.spo2}</strong>
                <strong>RR {selectedCase.brief.visibleVitals.rr}</strong>
              </div>
              <div className={`patient-avatar patient-${selectedCase.id}`} aria-label={selectedCase.brief.patientName}>
                <div className="patient-bubble">
                  <span>{selectedCase.brief.patientName}</span>
                  <p>{latestPatientTurn?.text ?? selectedCase.brief.chiefComplaint}</p>
                </div>
                <div className="avatar-hair" />
                <div className="avatar-head">
                  <span>{getPatientInitials(selectedCase.brief.patientName)}</span>
                </div>
                <div className="avatar-body" />
                <div className="avatar-chair" />
              </div>
              <div className="desk-table">
                <FileText size={20} />
                <span>Chart</span>
              </div>
              <div className="chart-tablet">
                <span>{selectedCase.brief.patientName}</span>
                <strong>{selectedCase.brief.age} years</strong>
                <p>{selectedCase.brief.chiefComplaint}</p>
              </div>

              <aside className="scene-record-overlay">
                <div className="record-person">
                  <div className="record-avatar">{getPatientInitials(selectedCase.brief.patientName)}</div>
                  <div>
                    <h2>{selectedCase.brief.patientName}</h2>
                    <p>{selectedCase.brief.age} years · {selectedCase.specialty}</p>
                  </div>
                </div>

                <div className="record-vitals compact">
                  <span>HR {selectedCase.brief.visibleVitals.hr}</span>
                  <span>BP {selectedCase.brief.visibleVitals.bp}</span>
                  <span>SpO2 {selectedCase.brief.visibleVitals.spo2}</span>
                  <span>Temp {selectedCase.brief.visibleVitals.temp}</span>
                </div>

                <div className="record-section">
                  <h3>Findings</h3>
                  {clinicalFindings.length === 0 ? (
                    <p className="muted">No exam or test findings yet.</p>
                  ) : (
                    <ul className="finding-list">
                      {clinicalFindings.slice(-3).map((finding) => (
                        <li key={finding.title}>
                          <strong>{finding.title}</strong>
                          <span>{finding.detail}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </aside>

              <section className="scene-chat-overlay">
                <div className="dock-header">
                  <div>
                    <p className="eyebrow">Conversation</p>
                    <h2>{selectedCase.brief.patientName}</h2>
                  </div>
                  <span className="voice-indicator">
                    <Volume2 size={15} />
                    {productizeStatusLabel(runtime.voiceMode)}
                  </span>
                </div>

                <div className="transcript-log">
                  {session.transcript.map((turn) => (
                    <article key={turn.id} className={`turn turn-${turn.speaker}`}>
                      <span>{turn.speaker === "clinician" ? "You" : selectedCase.brief.patientName}</span>
                      <p>{turn.text}</p>
                    </article>
                  ))}
                  <div ref={transcriptEndRef} />
                </div>

                <div className="composer">
                  <textarea
                    id="prompt"
                    ref={promptInputRef}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Ask the patient..."
                    aria-label="Ask the patient"
                  />
                  <div className="composer-actions">
                    <button
                      className={voiceState === "listening" ? "secondary-button" : "ghost-button"}
                      disabled={isPrompting || isEndingEncounter || voiceState === "processing"}
                      onClick={toggleVoiceCapture}
                      type="button"
                    >
                      <Mic size={18} />
                      {voiceState === "listening"
                        ? "Stop"
                        : voiceState === "processing"
                          ? "Processing"
                          : "Voice"}
                    </button>
                    <button
                      className="primary-button"
                      disabled={isPrompting || isEndingEncounter || !message.trim()}
                      onClick={sendPrompt}
                      type="button"
                    >
                      <Send size={18} />
                      {isPrompting ? "Sending" : "Send"}
                    </button>
                  </div>
                  {voiceError ? <p className="voice-error">{voiceError}</p> : null}
                </div>
              </section>

              <div className="room-command-bar">
                {(
                  [
                    ["history", voiceState === "listening" ? "Stop" : "Voice", Mic],
                    ["examine", "Exam", Stethoscope],
                    ["order_test", "Tests", TestTube2],
                    ["diagnose", "Impression", Brain],
                    ["treatment_plan", "Plan", ClipboardList],
                    ["safety_net", "Safety", ShieldCheck]
                  ] as const
                ).map(([kind, label, Icon]) => {
                  const status = session ? getActionStatus(session, kind) : { state: "ready", label: "ready" };
                  return (
                    <button
                      key={kind}
                      className={`tool-button tool-button-${status.state}`}
                      disabled={isPrompting || isEndingEncounter}
                      onClick={() => runAction(kind)}
                      type="button"
                    >
                      <Icon size={18} />
                      <span>{label}</span>
                      <small>{status.label}</small>
                    </button>
                  );
                })}
                <button className="end-button" disabled={isEndingEncounter} onClick={endEncounter} type="button">
                  {isEndingEncounter ? "Closing" : "End"}
                </button>
              </div>

              {activeActionOverlay ? (
                <div className="action-overlay" role="dialog" aria-modal="true" aria-label={activeActionOverlay.title}>
                  <div className="action-overlay-card">
                    <div className="action-overlay-header">
                      <div>
                        <p className="eyebrow">{activeActionOverlay.eyebrow}</p>
                        <h3>{activeActionOverlay.title}</h3>
                      </div>
                      <button
                        className="ghost-button overlay-close"
                        onClick={() => setActiveActionOverlay(null)}
                        type="button"
                      >
                        Close
                      </button>
                    </div>
                    <div className="overlay-status-strip">
                      <span className="status-pill success">
                        <CheckCircle2 size={16} />
                        {activeActionOverlay.statusLabel}
                      </span>
                      {session?.progress.missingCriticalTopics.length ? (
                        <span className="status-pill warning">
                          <AlertTriangle size={16} />
                          {session.progress.missingCriticalTopics.length} history gap
                          {session.progress.missingCriticalTopics.length === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </div>
                    <p>{activeActionOverlay.summary}</p>
                    <ul className="overlay-findings">
                      {activeActionOverlay.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <div className="overlay-next-step">
                      <span>Recommended next move</span>
                      <strong>{activeActionOverlay.nextStep}</strong>
                    </div>
                    <div className="action-row">
                      <button
                        className="primary-button"
                        onClick={() => setActiveActionOverlay(null)}
                        type="button"
                      >
                        {activeActionOverlay.primaryLabel}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </main>
      )}

    </div>
  );
}
