import { describe, expect, it } from "vitest";
import { medicalCasePack } from "@caseroom/case-packs-medical-osce";
import { createSession } from "@caseroom/simulation-core";
import { buildVoiceContextPhrases } from "./index";

function sessionFor(caseId: string) {
  const scenario = medicalCasePack.find((entry) => entry.id === caseId);
  if (!scenario) {
    throw new Error(`Missing seed case ${caseId}`);
  }
  return createSession(scenario);
}

describe("qvac-runtime voice context", () => {
  it("derives ASR context phrases from the active medical case", () => {
    const utiContext = buildVoiceContextPhrases(sessionFor("gp-uti-001"));
    const anemiaContext = buildVoiceContextPhrases(sessionFor("gp-fatigue-001"));

    expect(utiContext).toEqual(expect.arrayContaining(["pregnancy", "pregnant", "flank pain"]));
    expect(anemiaContext).toEqual(expect.arrayContaining(["clots", "clot", "menstruation"]));
  });

  it("excludes common stopwords from the ASR context phrases", () => {
    const chestPainContext = buildVoiceContextPhrases(sessionFor("ed-chest-001"));
    
    // Stopwords should not be standalone entries in the context phrases
    expect(chestPainContext).not.toContain("of");
    expect(chestPainContext).not.toContain("and");
    expect(chestPainContext).not.toContain("the");
  });

  it("contains expanded clinical synonyms", () => {
    const chestPainContext = buildVoiceContextPhrases(sessionFor("ed-chest-001"));

    // Check mapping/expansions for 'radiation' and 'sweating'
    expect(chestPainContext).toEqual(expect.arrayContaining(["spread", "radiating", "clammy"]));
  });
});
