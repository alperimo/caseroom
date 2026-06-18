import type { EncounterSession } from "@caseroom/simulation-core";
import type { PersistedRun } from "./sessionStore";

type DebriefReport = PersistedRun<{
  title: string;
  summary: string;
  overallScore: number;
  strengths: string[];
  gaps: string[];
  citations: string[];
}>["report"];

type DebriefRun = PersistedRun<DebriefReport>;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatTranscript(session: EncounterSession | null, transcript: EncounterSession["transcript"] | null): string {
  const turns = transcript ?? session?.transcript ?? [];
  if (turns.length === 0) {
    return "- No transcript captured.";
  }

  return turns
    .map((turn) => `- **${turn.speaker === "clinician" ? "Clinician" : "Patient"}**: ${turn.text}`)
    .join("\n");
}

export function buildEvidenceMarkdown(run: DebriefRun): string {
  return [
    `# ${run.report.title}`,
    "",
    `- Completed: ${formatDate(run.finishedAt)}`,
    `- Case ID: ${run.caseId}`,
    `- Score: ${Math.round(run.report.overallScore)}%`,
    "",
    "## Summary",
    "",
    run.report.summary,
    "",
    "## Strengths",
    "",
    ...run.report.strengths.map((item) => `- ${item}`),
    "",
    "## Improve Next Time",
    "",
    ...run.report.gaps.map((item) => `- ${item}`),
    "",
    "## Local Citations",
    "",
    ...run.report.citations.map((item) => `- ${item}`),
    "",
    "## Encounter Transcript",
    "",
    formatTranscript(run.session, run.transcript)
  ].join("\n");
}

export async function saveEvidenceArtifact(run: DebriefRun): Promise<{ saved: boolean; location?: string }> {
  const content = buildEvidenceMarkdown(run);
  const defaultFileName = `${slugify(run.report.title)}-${run.finishedAt.slice(0, 10)}.md`;

  if (window.caseroomDesktop?.evidenceStore) {
    const result = await window.caseroomDesktop.evidenceStore.saveArtifact({
      content,
      defaultFileName,
      filters: [{ name: "Markdown report", extensions: ["md"] }]
    });

    return result.cancelled
      ? { saved: false }
      : { saved: true, location: result.filePath };
  }

  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = defaultFileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return { saved: true };
}
