import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  deleteJournal,
  JOURNAL_FILENAME,
  readJournal,
  writeJournal,
} from "../src/journal.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bulk-rename-"));
}

test("writeJournal and readJournal round-trip entries", () => {
  const root = tmpDir();
  try {
    assert.equal(readJournal(root), null);
    writeJournal(root, [
      { dir: "", from: "a.txt", to: "b.txt" },
      { dir: "sub", from: "c.txt", to: "d.txt" },
    ]);
    const journal = readJournal(root);
    assert.equal(journal?.version, 1);
    assert.deepEqual(journal?.entries, [
      { dir: "", from: "a.txt", to: "b.txt" },
      { dir: "sub", from: "c.txt", to: "d.txt" },
    ]);
    assert.ok(fs.existsSync(path.join(root, JOURNAL_FILENAME)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("deleteJournal removes the file and readJournal goes back to null", () => {
  const root = tmpDir();
  try {
    writeJournal(root, [{ dir: "", from: "a.txt", to: "b.txt" }]);
    deleteJournal(root);
    assert.equal(readJournal(root), null);
    deleteJournal(root); // deleting twice must not throw
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("readJournal throws on corrupt JSON", () => {
  const root = tmpDir();
  try {
    fs.writeFileSync(path.join(root, JOURNAL_FILENAME), "{not json");
    assert.throws(() => readJournal(root), /corrupt JSON/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("readJournal throws on an unsupported journal version", () => {
  const root = tmpDir();
  try {
    fs.writeFileSync(
      path.join(root, JOURNAL_FILENAME),
      JSON.stringify({ version: 99, entries: [] }),
    );
    assert.throws(() => readJournal(root), /unsupported format/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
