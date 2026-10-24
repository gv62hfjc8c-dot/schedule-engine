import {
  DatabaseConflictError,
  DatabaseValidationError,
  openDefaultScheduleDatabase,
} from "./sqliteStateDatabase.mjs";

const MAX_BODY_BYTES = 2_200_000;

function respond(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(body));
}

function localConnection(request) {
  const remote = request.socket.remoteAddress ?? "";
  return remote === "::1" || remote === "127.0.0.1" ||
    remote === "::ffff:127.0.0.1";
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true; // Native clients and tests can omit Origin.
  const host = request.headers.host;
  return typeof host === "string" &&
    (origin === `http://${host}` || origin === `https://${host}`);
}

async function jsonBody(request) {
  if (!(request.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new DatabaseValidationError("O pedido tem de enviar JSON.");
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      throw new DatabaseValidationError("O pedido excede o tamanho máximo.");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DatabaseValidationError("JSON inválido.");
  }
}

function configureApiServer(server) {
  let storage;
  let closed = false;

  const getStorage = () => {
    if (closed) throw new Error("A ligação à base de dados está encerrada.");
    if (!storage) storage = openDefaultScheduleDatabase();
    return storage;
  };

  server.middlewares.use((request, response, next) => {
    if ((request.url ?? "").split("?")[0] !== "/api/state") {
      next();
      return;
    }

    void (async () => {
      if (!localConnection(request)) {
        respond(response, 403, { error: "O armazenamento local só está disponível neste computador." });
        return;
      }

      if (!sameOrigin(request)) {
        respond(response, 403, { error: "Origem de pedido não autorizada." });
        return;
      }

      if (request.method === "GET") {
        respond(response, 200, getStorage().read());
        return;
      }

      if (request.method === "PUT") {
        const payload = await jsonBody(request);
        if (!payload || typeof payload !== "object") {
          throw new DatabaseValidationError("Pedido de gravação inválido.");
        }
        const saved = getStorage().save(payload.state, payload.expectedRevision);
        respond(response, 200, { revision: saved.revision });
        return;
      }

      respond(response, 405, { error: "Método não permitido." });
    })().catch((error) => {
      if (response.writableEnded) return;

      if (error instanceof DatabaseConflictError) {
        respond(response, 409, {
          error: error.message,
          currentRevision: error.currentRevision,
        });
      } else if (error instanceof DatabaseValidationError) {
        respond(response, 400, { error: error.message });
      } else {
        console.error("[Schedule Engine SQLite]", error);
        respond(response, 500, {
          error: "Não foi possível aceder à base de dados SQLite. Os dados anteriores foram preservados.",
        });
      }
    });
  });

  server.httpServer?.once("close", () => {
    closed = true;
    storage?.close();
  });
}

/**
 * Installs the SQLite API into Vite's existing dev/preview HTTP server.
 * There is no separate process, port, or independently started backend.
 */
export function scheduleDatabasePlugin() {
  return {
    name: "schedule-engine-local-sqlite",
    configureServer: configureApiServer,
    configurePreviewServer: configureApiServer,
  };
}
