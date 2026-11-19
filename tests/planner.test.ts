import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  applyPlan,
  detectConflicts,
  planRenames,
} from "../src/planner.js";
import type { ScannedFile } from "../src/scanner.js";

function files(dir: string, names: string[]): ScannedFile[] {
  return names.map((name) => ({ dir, name }));
}

test("planRenames drops files whose name does not change", () => {
  const dir = "/tmp";
  const plan = planRenames(
    files(dir, ["a.txt", "b.txt"]),
    [{ kind: "prefix", text: "x-" }],
  );
  assert.deepEqual(plan, [
    { dir, from: "a.txt", to: "x-a.txt" },
    { dir, from: "b.txt", to: "x-b.txt" },
  ]);
  const noop = planRenames(files(dir, ["a.txt"]), [
    { kind: "replace", search: "zzz", replacement: "y", regex: false },
  ]);
  assert.deepEqual(noop, []);
});

test("detectConflicts flags duplicate targets", () => {
  const dir = "/tmp";
  // A constant pattern renames two different files to the same target.
  const plan = planRenames(
    files(dir, ["one.txt", "two.txt"]),
    [{ kind: "pattern", template: "same" }],
  );
  assert.deepEqual(plan.map((e) => e.to), ["same.txt", "same.txt"]);
  const conflicts = detectConflicts(plan);
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0]!.reason, /two files would become/);
});

test("detectConflicts flags a target that already exists and stays put", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bulk-rename-"));
  try {
    fs.writeFileSync(path.join(tmp, "a.txt"), "a");
    fs.writeFileSync(path.join(tmp, "keep.txt"), "keep");
    // a.txt -> keep.txt, but keep.txt is not renamed away.
    const plan = planRenames(files(tmp, ["a.txt", "keep.txt"]), [
      { kind: "replace", search: "a", replacement: "keep", regex: false },
    ]);
    const conflicts = detectConflicts(plan);
    assert.equal(conflicts.length, 1);
    assert.match(conflicts[0]!.reason, /already exists/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("detectConflicts allows a target freed by another rename in the plan", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bulk-rename-"));
  try {
    fs.writeFileSync(path.join(tmp, "a.txt"), "a");
    fs.writeFileSync(path.join(tmp, "b.txt"), "b");
    // a swap: a.txt -> b.txt and b.txt -> a.txt. Each target is freed by
    // the other rename, so the plan is safe.
    const plan = [
      { dir: tmp, from: "a.txt", to: "b.txt" },
      { dir: tmp, from: "b.txt", to: "a.txt" },
    ];
    assert.deepEqual(detectConflicts(plan), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("applyPlan handles a two-file swap without losing data", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bulk-rename-"));
  try {
    fs.writeFileSync(path.join(tmp, "a.txt"), "AAA");
    fs.writeFileSync(path.join(tmp, "b.txt"), "BBB");
    applyPlan([
      { dir: tmp, from: "a.txt", to: "b.txt" },
      { dir: tmp, from: "b.txt", to: "a.txt" },
    ]);
    assert.equal(fs.readFileSync(path.join(tmp, "a.txt"), "utf8"), "BBB");
    assert.equal(fs.readFileSync(path.join(tmp, "b.txt"), "utf8"), "AAA");
    assert.deepEqual(fs.readdirSync(tmp).sort(), ["a.txt", "b.txt"]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("applyPlan handles a three-file rotation chain", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bulk-rename-"));
  try {
    for (const [name, body] of [["a.txt", "A"], ["b.txt", "B"], ["c.txt", "C"]] as const) {
      fs.writeFileSync(path.join(tmp, name), body);
    }
    applyPlan([
      { dir: tmp, from: "a.txt", to: "b.txt" },
      { dir: tmp, from: "b.txt", to: "c.txt" },
      { dir: tmp, from: "c.txt", to: "a.txt" },
    ]);
    assert.equal(fs.readFileSync(path.join(tmp, "a.txt"), "utf8"), "C");
    assert.equal(fs.readFileSync(path.join(tmp, "b.txt"), "utf8"), "A");
    assert.equal(fs.readFileSync(path.join(tmp, "c.txt"), "utf8"), "B");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("applyPlan rolls back when a rename fails midway", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bulk-rename-"));
  try {
    fs.writeFileSync(path.join(tmp, "a.txt"), "A");
    fs.writeFileSync(path.join(tmp, "b.txt"), "B");
    assert.throws(
      () =>
        applyPlan([
          { dir: tmp, from: "a.txt", to: "a2.txt" },
          { dir: tmp, from: "missing.txt", to: "m2.txt" },
        ]),
      /rename failed/,
    );
    // a.txt is back where it was, and no temp files leak.
    assert.equal(fs.readFileSync(path.join(tmp, "a.txt"), "utf8"), "A");
    assert.deepEqual(fs.readdirSync(tmp).sort(), ["a.txt", "b.txt"]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
