import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class DatabaseConflictError extends Error {
  constructor(currentRevision) {
    super("A base de dados foi alterada por outra janela. Recarrega a aplicação antes de guardar.");
    this.name = "DatabaseConflictError";
    this.currentRevision = currentRevision;
  }
}

export class DatabaseValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "DatabaseValidationError";
  }
}

function validateState(state) {
  if (!state || typeof state !== "object" ||
      Array.isArray(state) || state.version !== 4 ||
      !Array.isArray(state.people) || !Array.isArray(state.availabilities) ||
      !state.weeklyOperatingHours || !Array.isArray(state.exceptions) ||
      !state.workRules || !state.weeklyPresenceRequirements ||
      !Array.isArray(state.presenceExceptions)) {
    throw new DatabaseValidationError("O estado enviado não corresponde ao formato v4 esperado.");
  }

  if (!state.people.every(
    person => person && typeof person.id === "string" &&
      person.id.length > 0 && typeof person.name === "string" &&
      typeof person.active === "boolean"
  )) {
    throw new DatabaseValidationError("Lista de colaboradores inválida.");
  }

  if (new Set(state.people.map(person => person.id)).size !== state.people.length) {
    throw new DatabaseValidationError("Existem colaboradores com o mesmo identificador.");
  }
}

function parseCurrentRow(row) {
  if (!row) return { revision: 0, state: null };
  let state;
  try {
    state = JSON.parse(row.payload);
  } catch {
    throw new Error("A base de dados contém um registo inválido. Não será sobrescrito.");
  }
  validateState(state);
  return { revision: Number(row.revision), state };
}

/**
 * SQLite is local infrastructure only. Scheduling domain logic never depends
 * on this adapter. Each complete application state is revisioned atomically.
 */
export function openScheduleDatabase(path) {
  if (path !== ":memory:") {
    mkdirSync(resolve(path, ".."), { recursive: true });
  }

  const database = new DatabaseSync(path);
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL CHECK (revision > 0),
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS state_history (
      revision INTEGER PRIMARY KEY CHECK (revision > 0),
      payload TEXT NOT NULL,
      saved_at TEXT NOT NULL
    ) STRICT;
  `);

  const select = database.prepare("SELECT revision, payload FROM app_state WHERE id = 1");
  const insert = database.prepare(
    "INSERT INTO app_state (id, revision, payload, updated_at) VALUES (1, ?, ?, ?)"
  );
  const update = database.prepare(
    "UPDATE app_state SET revision = ?, payload = ?, updated_at = ? WHERE id = 1"
  );
  const history = database.prepare(
    "INSERT INTO state_history (revision, payload, saved_at) VALUES (?, ?, ?)"
  );

  return {
    read() {
      return parseCurrentRow(select.get());
    },

    save(nextState, expectedRevision) {
      validateState(nextState);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw new DatabaseValidationError("Revisão de gravação inválida.");
      }

      const nextPayload = JSON.stringify(nextState);
      if (Buffer.byteLength(nextPayload, "utf8") > 2_000_000) {
        throw new DatabaseValidationError("Estado demasiado grande para guardar.");
      }

      database.exec("BEGIN IMMEDIATE");
      try {
        const current = parseCurrentRow(select.get());

        if (current.revision !== expectedRevision) {
          throw new DatabaseConflictError(current.revision);
        }

        if (current.state && current.state.people.length > 0 &&
            nextState.people.length === 0) {
          throw new DatabaseValidationError(
            "A gravação apagaria todos os colaboradores. Operação bloqueada."
          );
        }

        if (current.state &&
            JSON.stringify(current.state) === nextPayload) {
          database.exec("COMMIT");
          return current;
        }

        const revision = current.revision + 1;
        const timestamp = new Date().toISOString();

        if (current.revision === 0) {
          insert.run(revision, nextPayload, timestamp);
        } else {
          update.run(revision, nextPayload, timestamp);
        }
        history.run(revision, nextPayload, timestamp);
        database.exec("COMMIT");

        return { revision, state: nextState };
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },

    listHistory() {
      return database.prepare(
        "SELECT revision, saved_at AS savedAt FROM state_history ORDER BY revision DESC"
      ).all();
    },

    close() {
      database.close();
    },
  };
}

export function openDefaultScheduleDatabase() {
  const directory = process.env.SCHEDULE_ENGINE_DATA_DIR ??
    resolve(process.cwd(), ".schedule-engine-data");
  const path = resolve(directory, "state.sqlite");
  return openScheduleDatabase(path);
}
