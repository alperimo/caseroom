const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createSessionStore } = require("./session-store.cjs");

const devServerUrl = process.env.CASE_ROOM_DEV_SERVER_URL;
const smokeMode = process.env.CASE_ROOM_ELECTRON_SMOKE === "1";
let sessionStore;

function createWindow() {
  const window = new BrowserWindow({
    width: 1520,
    height: 980,
    minWidth: 1200,
    minHeight: 800,
    backgroundColor: "#0b1217",
    title: "CaseRoom",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    void window.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  if (smokeMode) {
    window.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        app.quit();
      }, 1000);
    });
  }

  return window;
}

app.whenReady().then(async () => {
  sessionStore = await createSessionStore(app.getPath("userData"));

  ipcMain.handle("sessions:list", async (_event, limit = 8) => {
    return sessionStore.listSessions(limit);
  });
  ipcMain.handle("sessions:save", async (_event, entry) => {
    return sessionStore.saveSession(entry);
  });
  ipcMain.handle("evidence:save", async (_event, payload) => {
    const result = await dialog.showSaveDialog({
      title: "Save CaseRoom report",
      defaultPath: payload.defaultFileName,
      filters: payload.filters ?? [
        { name: "Markdown report", extensions: ["md"] },
        { name: "Text report", extensions: ["txt"] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return { cancelled: true };
    }

    await fs.writeFile(result.filePath, payload.content, "utf8");
    return {
      cancelled: false,
      filePath: result.filePath
    };
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
