const fs = require("node:fs/promises");
const path = require("node:path");
const initSqlJs = require("sql.js");

const WASM_DIR = path.dirname(require.resolve("sql.js/dist/sql-wasm.wasm"));

async function createSessionStore(baseDir) {
  const SQL = await initSqlJs({
    locateFile(file) {
      return path.join(WASM_DIR, file);
    }
  });

  const dbPath = path.join(baseDir, "caseroom-sessions.sqlite");
  let database;

  try {
    const file = await fs.readFile(dbPath);
    database = new SQL.Database(file);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
    database = new SQL.Database();
  }

  database.run(`
    CREATE TABLE IF NOT EXISTS encounter_sessions (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      report_json TEXT NOT NULL,
      transcript_json TEXT,
      session_json TEXT
    );
  `);
  database.run(`
    CREATE INDEX IF NOT EXISTS idx_encounter_sessions_finished_at
    ON encounter_sessions(finished_at DESC);
  `);

  async function persist() {
    const bytes = database.export();
    await fs.mkdir(baseDir, { recursive: true });
    await fs.writeFile(dbPath, Buffer.from(bytes));
  }

  function mapRows(limit = 8) {
    const statement = database.prepare(`
      SELECT id, case_id, finished_at, report_json, transcript_json, session_json
      FROM encounter_sessions
      ORDER BY finished_at DESC
      LIMIT ?;
    `);

    statement.bind([limit]);
    const sessions = [];
    while (statement.step()) {
      const row = statement.getAsObject();
      sessions.push({
        id: String(row.id),
        caseId: String(row.case_id),
        finishedAt: String(row.finished_at),
        report: JSON.parse(String(row.report_json)),
        transcript: row.transcript_json ? JSON.parse(String(row.transcript_json)) : null,
        session: row.session_json ? JSON.parse(String(row.session_json)) : null
      });
    }
    statement.free();
    return sessions;
  }

  return {
    async listSessions(limit = 8) {
      return mapRows(limit);
    },
    async saveSession(entry) {
      database.run(
        `
          INSERT OR REPLACE INTO encounter_sessions
            (id, case_id, finished_at, report_json, transcript_json, session_json)
          VALUES (?, ?, ?, ?, ?, ?);
        `,
        [
          entry.id,
          entry.caseId,
          entry.finishedAt,
          JSON.stringify(entry.report),
          entry.transcript ? JSON.stringify(entry.transcript) : null,
          entry.session ? JSON.stringify(entry.session) : null
        ]
      );
      await persist();
      return mapRows(8);
    }
  };
}

module.exports = {
  createSessionStore
};
