import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Brain,
  ClipboardList,
  FileText,
  Mic,
  Send,
  ShieldCheck,
  Stethoscope,
  TestTube2,
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

function getPatientInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
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
  const [exportState, setExportState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const voiceControllerRef = useRef<VoiceCaptureController | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const historyRef = useRef<DebriefRun[]>([]);
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
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
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

    const response = await generatePatientTurn(session, promptText.trim());
    setSession(response.session);
    const latestTurn = response.session.transcript[response.session.transcript.length - 1];
    if (latestTurn?.speaker === "patient") {
      try {
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
    if (voiceState === "listening") {
      voiceControllerRef.current?.stop();
      return;
    }

    setVoiceError(null);
    voiceControllerRef.current = startVoiceCapture({
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
    if (!session) {
      return;
    }
    if (kind === "history") {
      promptInputRef.current?.focus();
      return;
    }
    const response = await generatePatientTurn(session, "", kind);
    setSession(response.session);
  }

  async function endEncounter() {
    if (!session) {
      return;
    }

    const report = await finishEncounter(session);
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
    setScreen("debrief");
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
  }

  const latestPatientTurn = session?.transcript.slice().reverse().find((turn) => turn.speaker === "patient");
  const clinicalFindings = session ? buildClinicalFindings(session) : [];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-copy">
          <p className="eyebrow">CaseRoom</p>
          <h1>Private clinical rehearsal for difficult patient encounters</h1>
          <p className="topbar-note">
            Short, high-stakes practice rooms with on-device knowledge, saved sessions, and
            structured debriefs.
          </p>
        </div>
        <div className="status-strip">
          <span className="status-pill success">{productizeStatusLabel(runtime.modelMode)}</span>
          <span className="status-pill neutral">{productizeStatusLabel(runtime.completionMode)}</span>
          <span className="status-pill neutral">{productizeStatusLabel(runtime.retrievalMode)}</span>
          <span className="status-pill warning">{productizeStatusLabel(runtime.storageMode)}</span>
        </div>
      </header>

      {screen === "lobby" && (
        <section className="hero-grid">
          <div className="hero-copy card compact-hero">
            <p className="eyebrow">Today&apos;s Room</p>
            <h2>Choose a case, enter the room, finish with a saved debrief.</h2>
            <div className="hero-metrics">
              <div className="metric-tile">
                <span>Cases</span>
                <strong>{medicalCasePack.length}</strong>
              </div>
              <div className="metric-tile">
                <span>Knowledge</span>
                <strong>{productizeStatusLabel(runtime.retrievalMode)}</strong>
              </div>
              <div className="metric-tile">
                <span>Sessions</span>
                <strong>{history.length}</strong>
              </div>
            </div>
          </div>
          <div className="hero-copy card quick-steps">
            <p className="eyebrow">Flow</p>
            <div className="step-row">
              <span>Pick case</span>
              <span>Run consult</span>
              <span>Save report</span>
            </div>
          </div>
        </section>
      )}

      {screen === "lobby" && (
        <main className="page-grid">
          <section className="card panel-span-2">
            <div className="section-header">
              <div>
                <p className="eyebrow">Case Lobby</p>
                <h2>Choose the next patient</h2>
              </div>
              <span className="status-pill neutral">{medicalCasePack.length} available cases</span>
            </div>
            <div className="case-grid">
              {medicalCasePack.map((scenario) => (
                <button className="case-card" key={scenario.id} onClick={() => chooseCase(scenario)}>
                  <div className="case-meta">
                    <span>{scenario.specialty}</span>
                    <span>{scenario.difficulty.toUpperCase()}</span>
                  </div>
                  <h3>{scenario.title}</h3>
                  <p>{scenario.brief.chiefComplaint}</p>
                  <div className="case-tags">
                    {scenario.hiddenCase.redFlags.map((flag) => (
                      <span key={flag}>{flag}</span>
                    ))}
                  </div>
                  <span className="case-cta">Open brief</span>
                </button>
              ))}
            </div>
          </section>

          <aside className="card">
            <p className="eyebrow">Saved Work</p>
            {draftRuns.length > 0 ? (
              <>
                <h2>Continue encounter</h2>
                <ul className="history-list">
                  {draftRuns.map((item) => (
                    <li key={`${item.caseId}-${item.finishedAt}`}>
                      <div className="history-actions">
                        <button
                          className="history-entry"
                          onClick={() => resumeEncounter(item)}
                          type="button"
                        >
                          <strong>{item.report.title}</strong>
                          <span>Resume</span>
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
              </>
            ) : null}
            <h2>{draftRuns.length > 0 ? "Recent debriefs" : "Your recent debriefs"}</h2>
            {completedRuns.length === 0 ? (
              <p className="muted">Completed encounters will appear here.</p>
            ) : (
              <ul className="history-list">
                {completedRuns.map((item) => (
                  <li key={`${item.caseId}-${item.finishedAt}`}>
                    <button
                      className="history-entry"
                      onClick={() => openSavedDebrief(item)}
                      type="button"
                    >
                      <strong>{item.report.title}</strong>
                      <span>{formatPercent(item.report.overallScore)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </main>
      )}

      {screen === "brief" && selectedCase && session && (
        <main className="page-grid">
          <section className="card panel-span-2 doorway-brief">
            <p className="eyebrow">Doorway Brief</p>
            <h2>
              {selectedCase.brief.patientName}, {selectedCase.brief.age}
            </h2>
            <p className="lead">{selectedCase.brief.chiefComplaint}</p>
            <div className="brief-grid">
              <div>
                <h3>Visible vitals</h3>
                <ul className="compact-list">
                  <li>HR: {selectedCase.brief.visibleVitals.hr}</li>
                  <li>BP: {selectedCase.brief.visibleVitals.bp}</li>
                  <li>RR: {selectedCase.brief.visibleVitals.rr}</li>
                  <li>SpO2: {selectedCase.brief.visibleVitals.spo2}</li>
                  <li>Temp: {selectedCase.brief.visibleVitals.temp}</li>
                </ul>
              </div>
              <div>
                <h3>Tasks</h3>
                <ul className="compact-list">
                  {selectedCase.brief.tasks.map((task) => (
                    <li key={task}>{task}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="action-row">
              <button className="ghost-button" onClick={resetFlow}>
                Back to lobby
              </button>
              <button className="primary-button" onClick={enterRoom}>
                Enter room
              </button>
            </div>
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
              <div className="patient-bubble">
                <span>{selectedCase.brief.patientName}</span>
                <p>{latestPatientTurn?.text ?? selectedCase.brief.chiefComplaint}</p>
              </div>
              <div className="patient-avatar" aria-label={selectedCase.brief.patientName}>
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
                      onClick={toggleVoiceCapture}
                      type="button"
                    >
                      <Mic size={18} />
                      {voiceState === "listening"
                        ? "Stop"
                        : voiceState === "processing"
                          ? "Listening"
                          : "Voice"}
                    </button>
                    <button className="primary-button" onClick={sendPrompt} type="button">
                      <Send size={18} />
                      Send
                    </button>
                  </div>
                  {voiceError ? <p className="voice-error">{voiceError}</p> : null}
                </div>
              </section>

              <div className="room-command-bar">
                {(
                  [
                    ["history", "Ask", Mic],
                    ["examine", "Exam", Stethoscope],
                    ["order_test", "Tests", TestTube2],
                    ["diagnose", "Impression", Brain],
                    ["treatment_plan", "Plan", ClipboardList],
                    ["safety_net", "Safety", ShieldCheck]
                  ] as const
                ).map(([kind, label, Icon]) => (
                  <button key={kind} className="tool-button" onClick={() => runAction(kind)} type="button">
                    <Icon size={18} />
                    <span>{label}</span>
                  </button>
                ))}
                <button className="end-button" onClick={endEncounter} type="button">
                  End
                </button>
              </div>
            </div>
          </section>
        </main>
      )}

      {screen === "debrief" && activeReport && (
        <main className="page-grid">
          <section className="card panel-span-2">
            <div className="section-header">
              <div>
                <p className="eyebrow">Debrief</p>
                <h2>{activeReport.title}</h2>
              </div>
              <span className="score-badge">{formatPercent(activeReport.overallScore)}</span>
            </div>

            <p className="lead">{activeReport.summary}</p>

            <div className="brief-grid">
              <div>
                <h3>Strengths</h3>
                <ul className="compact-list">
                  {activeReport.strengths.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Missed / improve</h3>
                <ul className="compact-list">
                  {activeReport.gaps.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="citations-box">
              <h3>Local citations</h3>
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
              <button className="ghost-button" onClick={resetFlow}>
                Return to case lobby
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
    </div>
  );
}
