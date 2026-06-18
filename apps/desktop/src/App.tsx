import { useEffect, useMemo, useRef, useState } from "react";
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
  type VoiceCaptureController,
  type RuntimeStatus
} from "@caseroom/qvac-runtime";
import {
  getStorageModeLabel,
  loadPersistedRuns,
  savePersistedRun,
  type PersistedRun
} from "./sessionStore";
import { saveEvidenceArtifact } from "./exportArtifacts";

type Screen = "lobby" | "brief" | "room" | "debrief";
type DebriefRun = PersistedRun<ReturnType<typeof buildDebriefHighlights>>;

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

  function productizeStatusLabel(label: string): string {
    if (label.includes("QVAC") || label.includes("model")) {
      return "Private AI ready";
    }
    if (label.includes("fallback")) {
      return "Private mode";
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
      return "Voice available";
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
    }

    void refreshRuntime();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      voiceControllerRef.current?.cancel();
      voiceControllerRef.current = null;
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function chooseCase(scenario: MedicalScenario) {
    setSelectedCase(scenario);
    setSession(createSession(scenario));
    setActiveRun(null);
    setActiveReport(null);
    setExportState("idle");
    setExportMessage(null);
    setScreen("brief");
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
    const response = await generatePatientTurn(session, "", kind);
    setSession(response.session);
  }

  async function endEncounter() {
    if (!session) {
      return;
    }

    const report = await finishEncounter(session);
    const entry = {
      id: session.id,
      caseId: session.scenario.id,
      report: buildDebriefHighlights(report),
      finishedAt: new Date().toISOString(),
      transcript: session.transcript,
      session
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
    setMessage("");
    setVoiceState("idle");
    setVoiceError(null);
    setActiveRun(null);
    setActiveReport(null);
    setExportState("idle");
    setExportMessage(null);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">CaseRoom</p>
          <h1>Private clinical rehearsal for difficult patient encounters</h1>
        </div>
        <div className="status-strip">
          <span className="status-pill success">{productizeStatusLabel(runtime.modelMode)}</span>
          <span className="status-pill neutral">{productizeStatusLabel(runtime.completionMode)}</span>
          <span className="status-pill neutral">{productizeStatusLabel(runtime.retrievalMode)}</span>
          <span className="status-pill warning">{productizeStatusLabel(runtime.storageMode)}</span>
        </div>
      </header>

      <section className="hero-grid">
        <div className="hero-copy card">
          <p className="eyebrow">Today&apos;s Room</p>
          <h2>Step into a consultation, read the doorway brief, and manage the encounter end to end.</h2>
          <p>
            Practice focused questioning, urgent triage, bedside explanation, and safe planning in
            a calm room designed for repeated rehearsal.
          </p>
        </div>
        <div className="hero-copy card">
          <p className="eyebrow">What You Can Do</p>
          <ul className="compact-list">
            <li>Choose from curated clinic, emergency, internal medicine, and respiratory cases</li>
            <li>Speak or type naturally, then examine, test, diagnose, and plan</li>
            <li>Finish with a structured debrief and source-backed feedback</li>
          </ul>
        </div>
      </section>

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
                </button>
              ))}
            </div>
          </section>

          <aside className="card">
            <p className="eyebrow">Recent Sessions</p>
            <h2>Your recent debriefs</h2>
            {history.length === 0 ? (
              <p className="muted">Completed encounters will appear here.</p>
            ) : (
              <ul className="history-list">
                {history.map((item) => (
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
              <button className="primary-button" onClick={() => setScreen("room")}>
                Enter room
              </button>
            </div>
          </section>
        </main>
      )}

      {screen === "room" && selectedCase && session && (
        <main className="room-grid">
          <section className="card room-scene">
            <div className="scene-banner">
              <p className="eyebrow">2.5D Consultation Room</p>
              <span className="status-pill neutral">
                Persona affect: {selectedCase.hiddenCase.patientAffect}
              </span>
            </div>
            <div className="scene-stage">
              <div className="room-plane">
                <div className="monitor-panel">
                  <strong>Vitals Monitor</strong>
                  <span>{selectedCase.brief.visibleVitals.bp}</span>
                  <span>{selectedCase.brief.visibleVitals.hr} bpm</span>
                  <span>{session.progress.remainingMinutes} min left</span>
                </div>
                <div className="patient-panel">
                  <p className="eyebrow">Patient</p>
                  <h3>{selectedCase.brief.patientName}</h3>
                  <p>{session.latestPatientMood}</p>
                  <span className="voice-indicator">{runtime.voiceMode}</span>
                  <span className={`status-pill risk-${session.progress.riskLevel}`}>
                    Risk {session.progress.riskLevel}
                  </span>
                  {voiceError ? <p className="voice-error">{voiceError}</p> : null}
                </div>
                <div className="desk-panel">
                  <strong>Clinician station</strong>
                  <p>{session.actionLog.length} logged actions</p>
                  <p>{session.progress.stateLabel}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="card transcript-panel">
            <div className="section-header">
              <div>
                <p className="eyebrow">Live Conversation</p>
                <h2>{selectedCase.title}</h2>
              </div>
              <button className="ghost-button" onClick={endEncounter}>
                End encounter
              </button>
            </div>

            <div className="transcript-log">
              {session.transcript.map((turn) => (
                <article key={turn.id} className={`turn turn-${turn.speaker}`}>
                  <span>{turn.speaker === "clinician" ? "You" : selectedCase.brief.patientName}</span>
                  <p>{turn.text}</p>
                </article>
              ))}
            </div>

            <div className="composer">
              <label htmlFor="prompt">Ask the patient</label>
              <textarea
                id="prompt"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Ask about symptoms, risk factors, what changed, or explain your plan."
              />
              <div className="composer-actions">
                <button
                  className={voiceState === "listening" ? "secondary-button" : "ghost-button"}
                  onClick={toggleVoiceCapture}
                  type="button"
                >
                  {voiceState === "listening"
                    ? "Stop listening"
                    : voiceState === "processing"
                      ? "Listening..."
                      : "Speak"}
                </button>
                <button className="primary-button" onClick={sendPrompt} type="button">
                  Send
                </button>
              </div>
              <p className="muted">
                Voice state: {voiceState}. You can switch between speaking and typing at any time.
              </p>
            </div>
          </section>

          <aside className="card chart-panel">
            <p className="eyebrow">Patient Record</p>
            <h2>Clinical actions</h2>
            <div className="action-stack">
              {(
                [
                  ["history", "Prompt patient"],
                  ["examine", "Perform exam"],
                  ["order_test", "Order test"],
                  ["diagnose", "Commit diagnosis"],
                  ["treatment_plan", "State plan"],
                  ["safety_net", "Safety-net advice"]
                ] as const
              ).map(([kind, label]) => (
                <button key={kind} className="secondary-button" onClick={() => runAction(kind)}>
                  {label}
                </button>
              ))}
            </div>

            <div className="notes-box">
              <h3>Focus prompts</h3>
              <ul className="compact-list">
                {selectedCase.hiddenCase.mustAsk.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="notes-box">
              <h3>Clinical focus</h3>
              <ul className="compact-list">
                <li>Next focus: {session.progress.stateLabel}</li>
                <li>Remaining time: {session.progress.remainingMinutes} minutes</li>
                <li>Encounter progress: {Math.round(session.progress.completionRatio * 100)}%</li>
                <li>Key areas still open: {session.progress.missingCriticalTopics.length}</li>
              </ul>
              {session.progress.escalationReasons.length > 0 ? (
                <ul className="compact-list">
                  {session.progress.escalationReasons.slice(0, 3).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No urgent escalation signals surfaced yet.</p>
              )}
            </div>
          </aside>
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
