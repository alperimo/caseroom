import type { EncounterSession } from "@caseroom/simulation-core";

export type PersistedRun<Report> = {
  id: string;
  caseId: string;
  report: Report;
  finishedAt: string;
  transcript: EncounterSession["transcript"] | null;
  session: EncounterSession | null;
  status: "in_progress" | "completed";
};

const storageKey = "caseroom-demo-history";

function getDesktopStore() {
  return window.caseroomDesktop?.sessionStore ?? null;
}

export function getStorageModeLabel(): string {
  return window.caseroomDesktop?.storageMode ?? "browser local storage";
}

export async function loadPersistedRuns<Report>(): Promise<PersistedRun<Report>[]> {
  const desktopStore = getDesktopStore();
  if (desktopStore) {
    return desktopStore.listSessions(8) as Promise<PersistedRun<Report>[]>;
  }

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Array<
      Omit<PersistedRun<Report>, "id" | "transcript" | "session"> & Partial<PersistedRun<Report>>
    >;
    return parsed.map((entry) => ({
      id: entry.id ?? `${entry.caseId}-${entry.finishedAt}`,
      caseId: entry.caseId,
      report: entry.report,
      finishedAt: entry.finishedAt,
      transcript: entry.transcript ?? null,
      session: entry.session ?? null,
      status: entry.status ?? "completed"
    }));
  } catch {
    window.localStorage.removeItem(storageKey);
    return [];
  }
}

export async function savePersistedRun<Report>(
  entry: PersistedRun<Report>,
  currentRuns: PersistedRun<Report>[],
): Promise<PersistedRun<Report>[]> {
  const desktopStore = getDesktopStore();
  if (desktopStore) {
    return desktopStore.saveSession(entry) as Promise<PersistedRun<Report>[]>;
  }

  const nextRuns = [entry, ...currentRuns].slice(0, 8);
  window.localStorage.setItem(storageKey, JSON.stringify(nextRuns));
  return nextRuns;
}

export async function deletePersistedRun<Report>(
  id: string,
  currentRuns: PersistedRun<Report>[],
): Promise<PersistedRun<Report>[]> {
  const desktopStore = getDesktopStore();
  if (desktopStore) {
    return desktopStore.deleteSession(id) as Promise<PersistedRun<Report>[]>;
  }

  const nextRuns = currentRuns.filter((entry) => entry.id !== id);
  window.localStorage.setItem(storageKey, JSON.stringify(nextRuns));
  return nextRuns;
}
