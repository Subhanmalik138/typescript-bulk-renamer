/**
 * Rename planning, conflict detection and safe application.
 *
 * Planning is pure: given the scanned files and the operations, produce
 * the list of renames (unchanged files are dropped — there is nothing to
 * do for them). Conflicts are detected *before* anything is renamed:
 * duplicate targets, a target that already exists on disk and is not
 * itself being renamed away, and targets that are not valid filenames.
 *
 * Application is two-phase per directory: every file first moves to a
 * unique temporary name, then temp names move to their final targets.
 * That makes swaps (a → b, b → a) and chains safe, and lets a failure
 * roll the directory back to its original state.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { applyOps, validateOp, type RenameOp } from "./operations.js";
import type { ScannedFile } from "./scanner.js";

export interface RenameEntry {
  dir: string;
  from: string;
  to: string;
}

export interface PlanConflict {
  file: string;
  target: string;
  reason: string;
}

/** Build the rename list. Files whose name does not change are dropped. */
export function planRenames(
  files: ScannedFile[],
  ops: RenameOp[],
  date: Date = new Date(),
): RenameEntry[] {
  for (const op of ops) validateOp(op);
  const plan: RenameEntry[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const parent = path.basename(file.dir);
    const to = applyOps(file.name, ops, i + 1, parent, date);
    if (to !== file.name) {
      plan.push({ dir: file.dir, from: file.name, to });
    }
  }
  return plan;
}

/**
 * Find every reason the plan must not run. A target that already exists
 * on disk is only a problem when it is not itself being renamed away
 * by this plan (checked against the plan's own sources).
 */
export function detectConflicts(plan: RenameEntry[]): PlanConflict[] {
  const conflicts: PlanConflict[] = [];
  const plannedFroms = new Set(plan.map((e) => `${e.dir}\u0000${e.from}`));
  const seenTargets = new Map<string, string>();

  for (const entry of plan) {
    const display = path.join(entry.dir, entry.from);
    if (entry.to === "" || entry.to === "." || entry.to === "..") {
      conflicts.push({
        file: display,
        target: entry.to,
        reason: "target name is empty or not a valid filename",
      });
      continue;
    }
    if (/[/\\]/.test(entry.to)) {
      conflicts.push({
        file: display,
        target: entry.to,
        reason: "target contains a path separator",
      });
      continue;
    }
    // Case-insensitive comparison: on macOS/Windows "File.txt" and
    // "file.txt" are the same file, so treat them as a collision.
    const key = `${entry.dir}\u0000${entry.to.toLowerCase()}`;
    const clash = seenTargets.get(key);
    if (clash !== undefined) {
      conflicts.push({
        file: display,
        target: entry.to,
        reason: `two files would become ${entry.to} (also ${clash})`,
      });
      continue;
    }
    seenTargets.set(key, entry.from);

    const targetPath = path.join(entry.dir, entry.to);
    if (
      fs.existsSync(targetPath) &&
      !plannedFroms.has(`${entry.dir}\u0000${entry.to}`)
    ) {
      conflicts.push({
        file: display,
        target: entry.to,
        reason: `${entry.to} already exists and is not being renamed away`,
      });
    }
  }

  return conflicts;
}

interface Staged {
  entry: RenameEntry;
  tempPath: string;
  done: boolean;
}

/** Apply a conflict-free plan, grouped per directory, with rollback. */
export function applyPlan(plan: RenameEntry[]): void {
  const byDir = new Map<string, RenameEntry[]>();
  for (const entry of plan) {
    const list = byDir.get(entry.dir) ?? [];
    list.push(entry);
    byDir.set(entry.dir, list);
  }
  for (const [dir, entries] of byDir) {
    applyInDirectory(dir, entries);
  }
}

function applyInDirectory(dir: string, entries: RenameEntry[]): void {
  const staged: Staged[] = [];
  try {
    for (const entry of entries) {
      const tempPath = path.join(
        dir,
        `.rename-tmp-${process.pid}-${Math.random().toString(36).slice(2)}`,
      );
      fs.renameSync(path.join(dir, entry.from), tempPath);
      staged.push({ entry, tempPath, done: false });
    }
    for (const item of staged) {
      fs.renameSync(item.tempPath, path.join(dir, item.entry.to));
      item.done = true;
    }
  } catch (err) {
    rollback(dir, staged);
    throw new Error(
      `rename failed in ${dir}: ${(err as Error).message} (rolled back)`,
    );
  }
}

function rollback(dir: string, staged: Staged[]): void {
  for (const item of staged) {
    try {
      if (item.done) {
        // Already at its final name: move it back.
        if (fs.existsSync(path.join(dir, item.entry.to))) {
          fs.renameSync(
            path.join(dir, item.entry.to),
            path.join(dir, item.entry.from),
          );
        }
      } else if (fs.existsSync(item.tempPath)) {
        fs.renameSync(item.tempPath, path.join(dir, item.entry.from));
      }
    } catch {
      // Best effort: leave whatever survived in place and report the
      // original error, not the rollback error.
    }
  }
}
