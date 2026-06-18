import { describe, expect, it } from "vitest";
import {
  addAction,
  createSession,
  evaluateEncounter,
  revealTopic,
  setPlan,
  type MedicalScenario
} from "./index";

const scenario: MedicalScenario = {
  id: "test-chest-001",
  title: "Chest pain after stairs",
  specialty: "Emergency / Internal Medicine",
  difficulty: "hard",
  brief: {
    patientName: "Test Patient",
    age: 58,
    chiefComplaint: "Heavy chest pain after climbing stairs.",
    timerMinutes: 8,
    visibleVitals: { hr: 108, bp: "182/104", rr: 20, spo2: 96, temp: 36.8 },
    tasks: ["Take urgent focused history", "Recognize red flags", "Make a safe plan"]
  },
  hiddenCase: {
    diagnosis: "possible acute coronary syndrome",
    patientAffect: "anxious but cooperative",
    mustAsk: ["radiation", "shortness of breath", "sweating", "cardiac history"],
    redFlags: ["acute coronary syndrome", "shortness of breath", "radiation"],
    truthTable: {
      radiation: "It went into my left arm.",
      "shortness of breath": "Yes, I was short of breath.",
      sweating: "I became clammy.",
      "cardiac history": "My father had a heart attack."
    },
    examFindings: ["Clammy appearance."],
    testResults: ["ECG abnormal."],
    safetyNet: ["worsening chest pain", "collapse"]
  },
  rubric: { communication: 20, history: 30, clinicalReasoning: 30, safety: 20 },
  localCitations: []
};

describe("simulation-core encounter transitions", () => {
  it("escalates risk when red flags and urgent vitals accumulate", () => {
    let session = createSession(scenario);
    expect(session.progress.riskLevel).toBe("high");

    session = revealTopic(session, "radiation");
    session = revealTopic(session, "shortness of breath");

    expect(session.progress.riskLevel).toBe("critical");
    expect(session.progress.needsUrgentEscalation).toBe(true);
    expect(session.latestPatientMood).toContain("more alarmed");
  });

  it("reduces remaining time and advances completion with actions", () => {
    let session = createSession(scenario);
    const initialMinutes = session.progress.remainingMinutes;

    session = revealTopic(session, "radiation");
    session = addAction(session, "examine");
    session = addAction(session, "order_test");

    expect(session.progress.remainingMinutes).toBeLessThan(initialMinutes);
    expect(session.progress.completionRatio).toBeGreaterThan(0.3);
    expect(session.progress.stateLabel).toMatch(/stabilize|prioritize|synthesize/i);
  });

  it("rewards urgent plans in debrief when escalation is needed", () => {
    let session = createSession(scenario);
    session = revealTopic(session, "radiation");
    session = revealTopic(session, "shortness of breath");
    session = addAction(session, "order_test");
    session = setPlan(session, "Urgent same-day escalation and hospital assessment were explained.");

    const report = evaluateEncounter(session);

    expect(report.strengths).toContain("Urgent escalation was recognized and reflected in the plan.");
    expect(report.gaps).not.toContain(
      "The encounter suggested urgent escalation, but the final plan did not clearly act on it.",
    );
  });
});
