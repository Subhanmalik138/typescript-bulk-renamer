/**
 * Undo journal.
 *
 * After a successful rename run, the mapping old → new is written to
 * `.rename-undo.json` in the scanned root. `bulk-rename --undo` reads it,
 * reverses the renames (new → old, again two-phase so swaps are safe)
 * and deletes the journal. Only the most recent run is kept — a second
 * rename overwrites the journal, which is the honest behaviour for a
 * single-level undo.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const JOURNAL_FILENAME = ".rename-undo.json";

export interface JournalEntry {
  /** Directory relative to the scanned root ("" for the root itself). */
  dir: string;
  from: string;
  to: string;
}

export interface Journal {
  version: 1;
  createdAt: string;
  entries: JournalEntry[];
}

export function journalPath(root: string): string {
  return path.join(path.resolve(root), JOURNAL_FILENAME);
}

export function writeJournal(root: string, entries: JournalEntry[]): void {
  const journal: Journal = {
    version: 1,
    createdAt: new Date().toISOString(),
    entries,
  };
  fs.writeFileSync(
    journalPath(root),
    `${JSON.stringify(journal, null, 2)}\n`,
    "utf8",
  );
}

export function readJournal(root: string): Journal | null {
  const file = journalPath(root);
  if (!fs.existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`undo journal ${file} is corrupt JSON`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Journal).version !== 1 ||
    !Array.isArray((parsed as Journal).entries)
  ) {
    throw new Error(`undo journal ${file} has an unsupported format`);
  }
  return parsed as Journal;
}

export function deleteJournal(root: string): void {
  const file = journalPath(root);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
