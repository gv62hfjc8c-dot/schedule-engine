import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "vite";

const weekdays = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];

const state = {
  version: 4,
  weeklyOperatingHours: Object.fromEntries(weekdays.map(day => [day, []])),
  exceptions: [],
  people: [
    { id: "one", name: "Colaborador A", active: true },
    { id: "two", name: "Colaborador B", active: true },
    { id: "three", name: "Colaborador C", active: true },
  ],
  availabilities: [],
  workRules: { standardShiftDurationMinutes: 480 },
  weeklyPresenceRequirements: Object.fromEntries(weekdays.map(day => [day, null])),
  presenceExceptions: [],
};

async function openServer() {
  const server = await createServer({
    configFile: join(process.cwd(), "vite.config.ts"),
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    clearScreen: false,
  });
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Não foi possível obter a porta do teste.");
  }
  return { server, url: `http://127.0.0.1:${address.port}/api/state` };
}

test("API SQLite funciona no próprio servidor Vite, incluindo reinício", async () => {
  const folder = mkdtempSync(join(tmpdir(), "schedule-engine-vite-api-"));
  const original = process.env.SCHEDULE_ENGINE_DATA_DIR;
  process.env.SCHEDULE_ENGINE_DATA_DIR = folder;
  let first;
  let second;
  try {
    first = await openServer();
    const initial = await fetch(first.url);
    assert.equal(initial.status, 200);
    assert.deepEqual(await initial.json(), { revision: 0, state: null });

    const write = await fetch(first.url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, expectedRevision: 0 }),
    });
    assert.equal(write.status, 200);
    assert.deepEqual(await write.json(), { revision: 1 });

    const conflict = await fetch(first.url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, expectedRevision: 0 }),
    });
    assert.equal(conflict.status, 409);

    const invalidOrigin = await fetch(first.url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: "https://example.com" },
      body: JSON.stringify({ state, expectedRevision: 1 }),
    });
    assert.equal(invalidOrigin.status, 403);

    await first.server.close();
    first = undefined;

    second = await openServer();
    const reopened = await fetch(second.url);
    assert.equal(reopened.status, 200);
    const persisted = await reopened.json();
    assert.equal(persisted.revision, 1);
    assert.deepEqual(persisted.state.people, state.people);
  } finally {
    if (first) await first.server.close();
    if (second) await second.server.close();
    if (original === undefined) {
      delete process.env.SCHEDULE_ENGINE_DATA_DIR;
    } else {
      process.env.SCHEDULE_ENGINE_DATA_DIR = original;
    }
    rmSync(folder, { recursive: true, force: true });
  }
});
