/**
 * File collection: gather the files a rename run will consider.
 *
 * Files are returned as `{ dir, name }` pairs (dir is absolute, name is
 * the bare filename) so recursive runs can rename inside subdirectories
 * while keeping every rename inside its own directory. The undo journal
 * is never collected, and hidden files are skipped unless asked for.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { JOURNAL_FILENAME } from "./journal.js";

export interface ScannedFile {
  dir: string;
  name: string;
}

export type SortMode = "name" | "mtime" | "size";

export interface ScanOptions {
  recursive?: boolean;
  /** Extensions to keep, with or without a leading dot, e.g. [".jpg", "png"]. */
  extensions?: string[] | undefined;
  /** Only files whose name matches this regex. */
  match?: RegExp | undefined;
  includeHidden?: boolean;
  sort?: SortMode;
}

function normalizeExtensions(extensions: string[]): Set<string> {
  return new Set(
    extensions.map((e) => {
      const lower = e.toLowerCase();
      return lower.startsWith(".") ? lower : `.${lower}`;
    }),
  );
}

export function collectFiles(
  root: string,
  opts: ScanOptions = {},
): ScannedFile[] {
  const allowedExts =
    opts.extensions !== undefined
      ? normalizeExtensions(opts.extensions)
      : undefined;
  const files: ScannedFile[] = [];

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      throw new Error(
        `cannot read directory ${dir}: ${(err as Error).message}`,
      );
    }
    for (const entry of entries) {
      if (!opts.includeHidden && entry.name.startsWith(".")) continue;
      if (entry.name === JOURNAL_FILENAME) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (opts.recursive) walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (
        allowedExts !== undefined &&
        !allowedExts.has(path.extname(entry.name).toLowerCase())
      ) {
        continue;
      }
      if (opts.match !== undefined && !opts.match.test(entry.name)) {
        continue;
      }
      files.push({ dir, name: entry.name });
    }
  };

  walk(path.resolve(root));

  const sort = opts.sort ?? "name";
  files.sort((a, b) => {
    if (sort === "name") {
      const byDir = a.dir.localeCompare(b.dir);
      return byDir !== 0 ? byDir : a.name.localeCompare(b.name);
    }
    const pa = path.join(a.dir, a.name);
    const pb = path.join(b.dir, b.name);
    const sa = fs.statSync(pa);
    const sb = fs.statSync(pb);
    if (sort === "mtime") return sa.mtimeMs - sb.mtimeMs;
    return sa.size - sb.size;
  });

  return files;
}
