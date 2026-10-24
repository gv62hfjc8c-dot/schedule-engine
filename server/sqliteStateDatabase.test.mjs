import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  openScheduleDatabase,
  DatabaseConflictError,
  DatabaseValidationError,
} from "./sqliteStateDatabase.mjs";

function fixture() {
  return {
    version: 4,
    weeklyOperatingHours: {
      monday: [{ start: "08:00", end: "20:00" }],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    },
    exceptions: [],
    people: [
      { id: "person-1", name: "Colaborador A", active: true },
      { id: "person-2", name: "Colaborador B", active: true },
      { id: "person-3", name: "Colaborador C", active: true },
    ],
    availabilities: [],
    workRules: { standardShiftDurationMinutes: 480 },
    weeklyPresenceRequirements: Object.fromEntries(
      ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]
        .map((day) => [day, null])
    ),
    presenceExceptions: [],
  };
}

test("SQLite preserva os três colaboradores após fechar e reabrir", () => {
  const folder = mkdtempSync(join(tmpdir(), "schedule-engine-sqlite-"));
  const filename = join(folder, "state.sqlite");
  try {
    const first = openScheduleDatabase(filename);
    assert.deepEqual(first.read(), { revision: 0, state: null });

    const saved = first.save(fixture(), 0);
    assert.equal(saved.revision, 1);
    assert.equal(saved.state.people.length, 3);
    assert.equal(first.listHistory().length, 1);
    first.close();

    assert.ok(existsSync(filename));
    const second = openScheduleDatabase(filename);
    assert.equal(second.read().revision, 1);
    assert.equal(second.read().state.people[2].name, "Colaborador C");
    const next = { ...fixture(), workRules: { standardShiftDurationMinutes: 360 } };
    second.save(next, 1);
    assert.equal(second.listHistory().length, 2);
    assert.deepEqual(second.listHistory().map((entry) => entry.revision), [2, 1]);
    second.close();

    const third = openScheduleDatabase(filename);
    assert.equal(third.read().revision, 2);
    assert.equal(third.read().state.people.length, 3);
    assert.equal(third.read().state.workRules.standardShiftDurationMinutes, 360);
    third.close();
  } finally {
    rmSync(folder, { force: true, recursive: true });
  }
});

test("SQLite bloqueia revisões concorrentes e eliminações acidentais", () => {
  const db = openScheduleDatabase(":memory:");
  try {
    db.save(fixture(), 0);

    assert.throws(
      () => db.save({ ...fixture(), workRules: { standardShiftDurationMinutes: 300 } }, 0),
      DatabaseConflictError
    );
    assert.equal(db.read().revision, 1);

    assert.throws(
      () => db.save({ ...fixture(), people: [] }, 1),
      DatabaseValidationError
    );
    assert.equal(db.read().state.people.length, 3);
    assert.equal(db.listHistory().length, 1);

    assert.throws(() => db.save({ ...fixture(), version: 5 }, 1), DatabaseValidationError);
    assert.throws(() => db.save({ ...fixture(), people: [fixture().people[0], fixture().people[0]] }, 1), DatabaseValidationError);
    assert.throws(() => db.save(fixture(), -1), DatabaseValidationError);

    assert.equal(db.save(fixture(), 1).revision, 1);
    assert.equal(db.listHistory().length, 1);
  } finally {
    db.close();
  }
});
