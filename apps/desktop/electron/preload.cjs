const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("caseroomDesktop", {
  platform: process.platform,
  shell: "electron",
  storageMode: "local SQLite sessions",
  sessionStore: {
    listSessions(limit) {
      return ipcRenderer.invoke("sessions:list", limit);
    },
    saveSession(entry) {
      return ipcRenderer.invoke("sessions:save", entry);
    },
    deleteSession(id) {
      return ipcRenderer.invoke("sessions:delete", id);
    }
  },
  evidenceStore: {
    saveArtifact(payload) {
      return ipcRenderer.invoke("evidence:save", payload);
    }
  }
});
