#!/usr/bin/env node
/**
 * bulk-rename — rename many files at once, safely.
 *
 *   bulk-rename photos/ --prefix "trip-" --case lower --dry-run
 *   bulk-rename . --replace "IMG_" --with "photo_" --number --number-width 3 --yes
 *   bulk-rename . --pattern "{date}_{parent}_{n:02}"
 *   bulk-rename photos/ --undo
 *
 * Safety rules: nothing is renamed until the full plan is conflict-free,
 * `--dry-run` previews the plan, renames apply two-phase (so swaps are
 * safe), and every run writes an undo journal for `bulk-rename --undo`.
 */

import * as fs from "node:fs";
import * as readline from "node:readline/promises";
import * as path from "node:path";
import {
  applyPlan,
  detectConflicts,
  planRenames,
  type RenameEntry,
} from "./planner.js";
import { collectFiles, type ScannedFile } from "./scanner.js";
import {
  deleteJournal,
  readJournal,
  writeJournal,
  type JournalEntry,
} from "./journal.js";
import type { CaseMode, RenameOp } from "./operations.js";

export interface CliOptions {
  directory: string;
  ops: RenameOp[];
  regex: boolean;
  recursive: boolean;
  match?: RegExp;
  extensions?: string[];
  includeHidden: boolean;
  sort: "name" | "mtime" | "size";
  dryRun: boolean;
  yes: boolean;
  undo: boolean;
  number: {
    enabled: boolean;
    start: number;
    step: number;
    width: number;
    separator: string;
    position: "prefix" | "suffix";
  };
}

const CASE_MODES: CaseMode[] = [
  "lower",
  "upper",
  "title",
  "snake",
  "kebab",
  "capitalize",
];

export function usage(): string {
  return `bulk-rename — rename many files at once, safely

Usage:
  bulk-rename [directory] [options]

Options:
  --replace FROM --with TO   replace text in the filename (repeatable)
  --regex                    treat --replace search as a regular expression
  --prefix TEXT              add a prefix to every name
  --suffix TEXT              add a suffix before the extension
  --case MODE                lower | upper | title | snake | kebab | capitalize
  --trim                     strip leading/trailing whitespace from names
  --ext EXT                  set the extension (e.g. png)
  --pattern TEMPLATE         full rename template, e.g. "{date}_{parent}_{n:02}"
  --number                   add a counter (see --number-* below)
    --number-start N         first number (default 1)
    --number-step N          step between numbers (default 1)
    --number-width N         zero-pad width (default 0)
    --number-sep TEXT        separator between number and name (default "-")
    --number-position POS    prefix | suffix (default prefix)
  --recursive                include files in subdirectories
  --match REGEX              only rename files whose name matches
  --only-ext .jpg,.png       only rename files with these extensions
  --include-hidden           include dotfiles
  --sort MODE                plan order: name | mtime | size (default name)
  --dry-run                  show the plan without renaming anything
  --yes                      apply without asking for confirmation
  --undo                     revert the last rename in the directory
  --help                     show this help

Pattern placeholders: {name} {ext} {n} {n:03} {date} {parent}.
A run writes .rename-undo.json in the directory; --undo reverts it.`;
}

function fail(message: string): never {
  throw new Error(message);
}

function takeValue(args: string[], i: number, flag: string): string {
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) {
    fail(`${flag} needs a value`);
  }
  return value;
}

function parseIntFlag(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) fail(`${flag} needs an integer, got "${value}"`);
  return n;
}

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    directory: ".",
    ops: [],
    regex: false,
    recursive: false,
    includeHidden: false,
    sort: "name",
    dryRun: false,
    yes: false,
    undo: false,
    number: {
      enabled: false,
      start: 1,
      step: 1,
      width: 0,
      separator: "-",
      position: "prefix",
    },
  };

  let pendingReplace: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--help":
        console.log(usage());
        process.exit(0);
        break;
      case "--replace":
        pendingReplace = takeValue(argv, i, "--replace");
        i++;
        break;
      case "--with": {
        const replacement = takeValue(argv, i, "--with");
        i++;
        if (pendingReplace === null) {
          fail("--with needs a preceding --replace");
        }
        opts.ops.push({
          kind: "replace",
          search: pendingReplace,
          replacement,
          // Resolved after parsing so --regex works in any position.
          regex: false,
        });
        pendingReplace = null;
        break;
      }
      case "--regex":
        opts.regex = true;
        break;
      case "--prefix":
        opts.ops.push({ kind: "prefix", text: takeValue(argv, i, "--prefix") });
        i++;
        break;
      case "--suffix":
        opts.ops.push({ kind: "suffix", text: takeValue(argv, i, "--suffix") });
        i++;
        break;
      case "--case": {
        const mode = takeValue(argv, i, "--case");
        i++;
        if (!(CASE_MODES as string[]).includes(mode)) {
          fail(`--case must be one of: ${CASE_MODES.join(", ")}`);
        }
        opts.ops.push({ kind: "case", mode: mode as CaseMode });
        break;
      }
      case "--trim":
        opts.ops.push({ kind: "trim" });
        break;
      case "--ext":
        opts.ops.push({
          kind: "extension",
          ext: takeValue(argv, i, "--ext"),
        });
        i++;
        break;
      case "--pattern":
        opts.ops.push({
          kind: "pattern",
          template: takeValue(argv, i, "--pattern"),
        });
        i++;
        break;
      case "--number":
        opts.number.enabled = true;
        break;
      case "--number-start":
        opts.number.enabled = true;
        opts.number.start = parseIntFlag(takeValue(argv, i, "--number-start"), "--number-start");
        i++;
        break;
      case "--number-step":
        opts.number.enabled = true;
        opts.number.step = parseIntFlag(takeValue(argv, i, "--number-step"), "--number-step");
        i++;
        break;
      case "--number-width":
        opts.number.enabled = true;
        opts.number.width = parseIntFlag(takeValue(argv, i, "--number-width"), "--number-width");
        i++;
        break;
      case "--number-sep":
        opts.number.enabled = true;
        opts.number.separator = takeValue(argv, i, "--number-sep");
        i++;
        break;
      case "--number-position": {
        const pos = takeValue(argv, i, "--number-position");
        i++;
        if (pos !== "prefix" && pos !== "suffix") {
          fail('--number-position must be "prefix" or "suffix"');
        }
        opts.number.enabled = true;
        opts.number.position = pos;
        break;
      }
      case "--recursive":
        opts.recursive = true;
        break;
      case "--match": {
        const src = takeValue(argv, i, "--match");
        i++;
        try {
          opts.match = new RegExp(src);
        } catch {
          fail(`--match is not a valid regular expression: "${src}"`);
        }
        break;
      }
      case "--only-ext":
        opts.extensions = takeValue(argv, i, "--only-ext")
          .split(",")
          .map((e) => e.trim())
          .filter((e) => e !== "");
        i++;
        break;
      case "--include-hidden":
        opts.includeHidden = true;
        break;
      case "--sort": {
        const mode = takeValue(argv, i, "--sort");
        i++;
        if (mode !== "name" && mode !== "mtime" && mode !== "size") {
          fail('--sort must be "name", "mtime" or "size"');
        }
        opts.sort = mode;
        break;
      }
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--yes":
        opts.yes = true;
        break;
      case "--undo":
        opts.undo = true;
        break;
      default:
        if (arg.startsWith("-")) {
          fail(`unknown option: ${arg}\n\n${usage()}`);
        }
        if (opts.directory !== ".") {
          fail(`unexpected extra argument: ${arg}`);
        }
        opts.directory = arg;
    }
  }

  if (pendingReplace !== null) {
    fail(`--replace "${pendingReplace}" needs a matching --with`);
  }
  if (opts.regex) {
    for (const op of opts.ops) {
      if (op.kind === "replace") {
        op.regex = true;
        op.flags = "g";
      }
    }
  }
  if (opts.number.enabled) {
    opts.ops.push({
      kind: "number",
      start: opts.number.start,
      step: opts.number.step,
      width: opts.number.width,
      position: opts.number.position,
      separator: opts.number.separator,
    });
  }
  return opts;
}

function printPreview(root: string, plan: RenameEntry[], unchanged: number): void {
  if (plan.length === 0) {
    console.log("Nothing to rename.");
    return;
  }
  const width = Math.max(...plan.map((e) => e.from.length));
  for (const entry of plan) {
    const relDir = path.relative(root, entry.dir);
    const location = relDir === "" ? "" : `${relDir}/`;
    console.log(
      `${location}${entry.from.padEnd(width)}  ->  ${entry.to}`,
    );
  }
  console.log(
    `\n${plan.length} file(s) to rename` +
      (unchanged > 0 ? `, ${unchanged} unchanged` : "") +
      ".",
  );
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function runUndo(root: string): Promise<number> {
  const journal = readJournal(root);
  if (journal === null || journal.entries.length === 0) {
    console.error(`No undo journal found in ${path.resolve(root)}.`);
    return 1;
  }
  const reversed: RenameEntry[] = journal.entries.map((e) => ({
    dir: path.resolve(root, e.dir),
    from: e.to,
    to: e.from,
  }));
  const missing = reversed.filter(
    (e) => !fileExists(e.dir, e.from),
  );
  if (missing.length > 0) {
    console.error(
      `Cannot undo: ${missing.length} file(s) from the last run are gone, e.g. ${missing[0]!.from}.`,
    );
    return 1;
  }
  applyPlan(reversed);
  deleteJournal(root);
  console.log(`Undid ${reversed.length} rename(s).`);
  return 0;
}

function fileExists(dir: string, name: string): boolean {
  return fs.existsSync(path.join(dir, name));
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let opts: CliOptions;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    return 2;
  }

  const root = path.resolve(opts.directory);

  if (opts.undo) {
    try {
      return await runUndo(root);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      return 1;
    }
  }

  if (opts.ops.length === 0) {
    console.error("Error: no rename operation given.\n");
    console.log(usage());
    return 2;
  }

  let files: ScannedFile[];
  try {
    files = collectFiles(root, {
      recursive: opts.recursive,
      extensions: opts.extensions,
      match: opts.match,
      includeHidden: opts.includeHidden,
      sort: opts.sort,
    });
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    return 1;
  }

  if (files.length === 0) {
    console.log("No matching files found.");
    return 0;
  }

  let plan: RenameEntry[];
  try {
    plan = planRenames(files, opts.ops);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    return 1;
  }

  const conflicts = detectConflicts(plan);
  if (conflicts.length > 0) {
    console.error("Refusing to rename — conflicts found:");
    for (const c of conflicts) {
      console.error(`  ${c.file} -> ${c.target}: ${c.reason}`);
    }
    return 1;
  }

  printPreview(root, plan, files.length - plan.length);
  if (plan.length === 0) return 0;
  if (opts.dryRun) {
    console.log("(dry run — nothing was renamed)");
    return 0;
  }

  if (!opts.yes) {
    const ok = await confirm(
      `Apply ${plan.length} rename(s)? [y/N] `,
    );
    if (!ok) {
      console.log("Aborted — nothing was renamed.");
      return 0;
    }
  }

  try {
    applyPlan(plan);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    return 1;
  }

  const journalEntries: JournalEntry[] = plan.map((e) => ({
    dir: path.relative(root, e.dir),
    from: e.from,
    to: e.to,
  }));
  writeJournal(root, journalEntries);
  console.log(
    `Renamed ${plan.length} file(s). Undo with: bulk-rename ${opts.directory} --undo`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
