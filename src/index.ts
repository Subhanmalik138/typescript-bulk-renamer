/**
 * bulk-rename — public API for programmatic use.
 * The CLI in ./cli.js is the main entry point.
 */

export { renderPattern, splitFilename, formatDate } from "./pattern.js";
export type { PatternContext } from "./pattern.js";
export {
  applyCase,
  applyOps,
  validateOp,
} from "./operations.js";
export type { CaseMode, RenameOp } from "./operations.js";
export { collectFiles } from "./scanner.js";
export type { ScannedFile, ScanOptions, SortMode } from "./scanner.js";
export {
  applyPlan,
  detectConflicts,
  planRenames,
} from "./planner.js";
export type { RenameEntry, PlanConflict } from "./planner.js";
export {
  JOURNAL_FILENAME,
  deleteJournal,
  readJournal,
  writeJournal,
} from "./journal.js";
export type { Journal, JournalEntry } from "./journal.js";
export { main as runCli, parseArgs, usage } from "./cli.js";
export type { CliOptions } from "./cli.js";
