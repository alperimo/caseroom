export type Difficulty = "easy" | "medium" | "hard";
export type RiskLevel = "low" | "elevated" | "high" | "critical";
export type ActionKind =
  | "history"
  | "examine"
  | "order_test"
  | "diagnose"
  | "treatment_plan"
  | "safety_net";

export type TranscriptTurn = {
  id: string;
  speaker: "clinician" | "patient";
  text: string;
};

export type LocalCitation = {
  id: string;
  title: string;
  excerpt: string;
};

export type MedicalScenario = {
  id: string;
  title: string;
  specialty: string;
  difficulty: Difficulty;
  brief: {
    patientName: string;
    age: number;
    chiefComplaint: string;
    timerMinutes?: number;
    visibleVitals: {
      hr: number;
      bp: string;
      rr: number;
      spo2: number;
      temp: number;
    };
    tasks: string[];
  };
  hiddenCase: {
    diagnosis: string;
    patientAffect: string;
    mustAsk: string[];
    redFlags: string[];
    truthTable: Record<string, string>;
    examFindings: string[];
    testResults: string[];
    safetyNet: string[];
  };
  rubric: {
    communication: number;
    history: number;
    clinicalReasoning: number;
    safety: number;
  };
  localCitations: LocalCitation[];
};

export type EncounterProgress = {
  riskLevel: RiskLevel;
  stateLabel: string;
  remainingMinutes: number;
  completionRatio: number;
  missingCriticalTopics: string[];
  escalationReasons: string[];
  needsUrgentEscalation: boolean;
};

export type EncounterSession = {
  id: string;
  scenario: MedicalScenario;
  transcript: TranscriptTurn[];
  actionLog: ActionKind[];
  revealedTopics: string[];
  diagnosisText: string | null;
  planText: string | null;
  latestPatientMood: string;
  progress: EncounterProgress;
  turnCount: number;
  examPerformed: boolean;
  testsOrdered: number;
};

export type DebriefReport = {
  title: string;
  summary: string;
  overallScore: number;
  strengths: string[];
  gaps: string[];
  citations: LocalCitation[];
};

const defaultTimerByDifficulty: Record<Difficulty, number> = {
  easy: 12,
  medium: 10,
  hard: 8
};

function parseSystolic(bp: string): number {
  const [systolic] = bp.split("/");
  return Number.parseInt(systolic ?? "0", 10);
}

function withDerivedState(session: Omit<EncounterSession, "latestPatientMood" | "progress">): EncounterSession {
  const progress = deriveEncounterProgress(session);
  return {
    ...session,
    progress,
    latestPatientMood: derivePatientMood(session, progress)
  };
}

function deriveEncounterProgress(
  session: Omit<EncounterSession, "latestPatientMood" | "progress">,
): EncounterProgress {
  const interactionUnits =
    session.transcript.filter((turn) => turn.speaker === "clinician").length + session.actionLog.length;
  const totalMinutes = session.scenario.brief.timerMinutes ?? defaultTimerByDifficulty[session.scenario.difficulty];
  const remainingMinutes = Math.max(0, totalMinutes - interactionUnits);
  const missingCriticalTopics = session.scenario.hiddenCase.mustAsk.filter(
    (topic) => !session.revealedTopics.includes(topic),
  );

  const escalationReasons: string[] = [];
  const systolic = parseSystolic(session.scenario.brief.visibleVitals.bp);
  const spo2 = session.scenario.brief.visibleVitals.spo2;
  const hr = session.scenario.brief.visibleVitals.hr;

  if (spo2 <= 94) {
    escalationReasons.push("Low oxygen saturation at presentation.");
  }
  if (systolic >= 180) {
    escalationReasons.push("Severely elevated systolic blood pressure.");
  }
  if (hr >= 100) {
    escalationReasons.push("Tachycardia increases immediate concern.");
  }

  const revealedRedFlags = session.scenario.hiddenCase.redFlags.filter((flag) =>
    session.revealedTopics.includes(flag),
  );
  for (const flag of revealedRedFlags) {
    escalationReasons.push(`Red flag revealed: ${flag}.`);
  }

  if (session.examPerformed && session.scenario.hiddenCase.examFindings.length > 0) {
    escalationReasons.push("Physical exam findings now contribute to urgency assessment.");
  }
  if (session.testsOrdered > 0 && session.scenario.hiddenCase.testResults.length > 0) {
    escalationReasons.push("Diagnostic test results are available for interpretation.");
  }

  const needsUrgentEscalation =
    escalationReasons.length >= 3 ||
    revealedRedFlags.length >= 2 ||
    (remainingMinutes <= 3 && missingCriticalTopics.length >= 2);

  const riskLevel: RiskLevel = needsUrgentEscalation
    ? "critical"
    : escalationReasons.length >= 2
      ? "high"
      : escalationReasons.length >= 1
        ? "elevated"
        : "low";

  const coreActionCoverage = new Set(
    session.actionLog.filter((action) =>
      ["history", "examine", "order_test", "diagnose", "treatment_plan"].includes(action),
    ),
  ).size;

  const completionRatio = Math.min(
    1,
    ((session.revealedTopics.length / Math.max(1, session.scenario.hiddenCase.mustAsk.length)) * 0.6) +
      ((coreActionCoverage / 5) * 0.4),
  );

  let stateLabel = "Continue focused history";
  if (riskLevel === "critical") {
    stateLabel = "Stabilize and escalate";
  } else if (riskLevel === "high") {
    stateLabel = "Prioritize red flags and urgent tests";
  } else if (remainingMinutes <= 3) {
    stateLabel = "Time pressure: commit diagnosis and plan";
  } else if (session.testsOrdered > 0 || session.examPerformed) {
    stateLabel = "Synthesize findings into a plan";
  }

  return {
    riskLevel,
    stateLabel,
    remainingMinutes,
    completionRatio,
    missingCriticalTopics,
    escalationReasons,
    needsUrgentEscalation
  };
}

function derivePatientMood(
  session: Omit<EncounterSession, "latestPatientMood" | "progress">,
  progress: EncounterProgress,
): string {
  if (progress.riskLevel === "critical") {
    return `${session.scenario.hiddenCase.patientAffect}; now visibly more alarmed by the situation`;
  }
  if (progress.riskLevel === "high") {
    return `${session.scenario.hiddenCase.patientAffect}; increasingly tense while waiting for direction`;
  }
  if (progress.remainingMinutes <= 2) {
    return `${session.scenario.hiddenCase.patientAffect}; noticing the urgency and pace of the encounter`;
  }
  return session.scenario.hiddenCase.patientAffect;
}

export function createSession(scenario: MedicalScenario): EncounterSession {
  return withDerivedState({
    id: `${scenario.id}-${Date.now()}`,
    scenario,
    transcript: [
      {
        id: crypto.randomUUID(),
        speaker: "patient",
        text: `Hello doctor. ${scenario.brief.chiefComplaint}`
      }
    ],
    actionLog: [],
    revealedTopics: [],
    diagnosisText: null,
    planText: null,
    turnCount: 1,
    examPerformed: false,
    testsOrdered: 0
  });
}

export function appendTurn(
  session: EncounterSession,
  speaker: TranscriptTurn["speaker"],
  text: string,
): EncounterSession {
  return withDerivedState({
    ...session,
    transcript: [...session.transcript, { id: crypto.randomUUID(), speaker, text }],
    turnCount: session.turnCount + 1
  });
}

export function addAction(session: EncounterSession, action: ActionKind): EncounterSession {
  return withDerivedState({
    ...session,
    actionLog: [...session.actionLog, action],
    examPerformed: session.examPerformed || action === "examine",
    testsOrdered: session.testsOrdered + (action === "order_test" ? 1 : 0)
  });
}

export function revealTopic(session: EncounterSession, topic: string): EncounterSession {
  if (session.revealedTopics.includes(topic)) {
    return session;
  }
  return withDerivedState({
    ...session,
    revealedTopics: [...session.revealedTopics, topic]
  });
}

export function setDiagnosis(session: EncounterSession, text: string): EncounterSession {
  return withDerivedState({
    ...session,
    diagnosisText: text
  });
}

export function setPlan(session: EncounterSession, text: string): EncounterSession {
  return withDerivedState({
    ...session,
    planText: text
  });
}

function normalizedTranscript(session: EncounterSession): string {
  return session.transcript.map((turn) => turn.text.toLowerCase()).join(" ");
}

export function evaluateEncounter(session: EncounterSession): DebriefReport {
  const transcript = normalizedTranscript(session);
  const mustAskHits = session.scenario.hiddenCase.mustAsk.filter((item) => transcript.includes(item));
  const actionCoverage = new Set(session.actionLog);
  const diagnosisMatch =
    session.diagnosisText?.toLowerCase().includes(session.scenario.hiddenCase.diagnosis.toLowerCase()) ?? false;
  const planIncluded = Boolean(session.planText);
  const escalationBonus =
    session.progress.needsUrgentEscalation && planIncluded && session.planText?.toLowerCase().includes("urgent")
      ? 10
      : 0;

  const score =
    Math.round(
      ((mustAskHits.length / session.scenario.hiddenCase.mustAsk.length) * 40 +
        (actionCoverage.size / 5) * 20 +
        (diagnosisMatch ? 15 : 0) +
        (planIncluded ? 15 : 0) +
        escalationBonus +
        (session.progress.remainingMinutes > 0 ? 0 : -5)) * 100,
    ) / 100;

  const strengths = [
    mustAskHits.length >= 2 ? "Focused history captured multiple required questions." : null,
    actionCoverage.has("order_test") ? "You used the action system to gather additional evidence." : null,
    diagnosisMatch ? "Final diagnosis matched the hidden case." : null,
    planIncluded ? "A treatment or management plan was documented." : null,
    session.progress.needsUrgentEscalation && escalationBonus > 0
      ? "Urgent escalation was recognized and reflected in the plan."
      : null
  ].filter(Boolean) as string[];

  const gaps = [
    ...session.progress.missingCriticalTopics.map((item) => `Missed key history area: ${item}.`),
    ...(!diagnosisMatch ? ["Final diagnosis did not clearly match the scenario truth."] : []),
    ...(!planIncluded ? ["No explicit management plan was recorded."] : []),
    ...(session.progress.needsUrgentEscalation && escalationBonus === 0
      ? ["The encounter suggested urgent escalation, but the final plan did not clearly act on it."]
      : []),
    ...(session.progress.remainingMinutes === 0
      ? ["Time management slipped; the encounter ran out of structured room time."]
      : [])
  ];

  return {
    title: session.scenario.title,
    summary:
      score >= 70
        ? "A solid, clinically structured encounter with room to sharpen completeness and safety."
        : "The encounter stayed on track, but several core rubric items were missed or left implicit.",
    overallScore: score,
    strengths: strengths.length > 0 ? strengths : ["You completed the encounter and produced a usable action log."],
    gaps,
    citations: session.scenario.localCitations
  };
}

export function buildDebriefHighlights(report: DebriefReport) {
  return {
    title: report.title,
    summary: report.summary,
    overallScore: report.overallScore,
    strengths: report.strengths,
    gaps: report.gaps,
    citations: report.citations.map((item) => `${item.title} (${item.id}): ${item.excerpt}`)
  };
}

export function formatPercent(score: number): string {
  return `${Math.round(score)}%`;
}
