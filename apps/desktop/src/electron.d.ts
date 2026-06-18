type StoredEncounterSession = {
  id: string;
  caseId: string;
  finishedAt: string;
  report: unknown;
  transcript: unknown[] | null;
  session: unknown | null;
};

type CaseRoomDesktopApi = {
  platform: string;
  shell: "electron";
  storageMode: string;
  sessionStore: {
    listSessions(limit?: number): Promise<StoredEncounterSession[]>;
    saveSession(entry: StoredEncounterSession): Promise<StoredEncounterSession[]>;
  };
  evidenceStore: {
    saveArtifact(payload: {
      content: string;
      defaultFileName: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    }): Promise<{ cancelled: boolean; filePath?: string }>;
  };
};

declare global {
  interface Window {
    caseroomDesktop?: CaseRoomDesktopApi;
  }
}

export {};
