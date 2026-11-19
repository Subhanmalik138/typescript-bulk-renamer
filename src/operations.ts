/**
 * Rename operations.
 *
 * Operations are applied in order to one filename at a time. Every
 * operation works on the stem (the name without extension) except
 * `extension` and `pattern`, which may set the extension. Keeping
 * replacements stem-only is deliberate: a replace of "jpg" should not
 * silently rewrite `.jpg` extensions as well.
 *
 * `index` is the file's 1-based position in the planned list, so
 * numbering is stable and predictable across a run.
 */

import {
  renderPattern,
  splitFilename,
  type PatternContext,
} from "./pattern.js";

export type CaseMode =
  | "lower"
  | "upper"
  | "title"
  | "snake"
  | "kebab"
  | "capitalize";

export type RenameOp =
  | {
      kind: "replace";
      search: string;
      replacement: string;
      regex: boolean;
      flags?: string;
    }
  | { kind: "prefix"; text: string }
  | { kind: "suffix"; text: string }
  | { kind: "case"; mode: CaseMode }
  | { kind: "trim" }
  | { kind: "extension"; ext: string }
  | {
      kind: "number";
      start: number;
      step: number;
      width: number;
      position: "prefix" | "suffix";
      separator: string;
    }
  | { kind: "pattern"; template: string };

export function validateOp(op: RenameOp): void {
  switch (op.kind) {
    case "replace": {
      if (op.search === "") {
        throw new Error("replace: search string must not be empty");
      }
      if (op.regex) {
        // Throws SyntaxError on an invalid pattern — fail before renaming.
        new RegExp(op.search, op.flags ?? "g");
      }
      break;
    }
    case "prefix":
    case "suffix": {
      if (op.text === "") {
        throw new Error(`${op.kind}: text must not be empty`);
      }
      if (/[/\\]/.test(op.text)) {
        throw new Error(`${op.kind}: text must not contain a path separator`);
      }
      break;
    }
    case "extension": {
      if (op.ext === "") {
        throw new Error("extension: extension must not be empty");
      }
      if (/[/\\.]/.test(op.ext)) {
        throw new Error(
          "extension: give the extension without a dot or separator (e.g. \"png\")",
        );
      }
      break;
    }
    case "number": {
      if (!Number.isInteger(op.start) || op.start < 0) {
        throw new Error("number: start must be a non-negative integer");
      }
      if (!Number.isInteger(op.step) || op.step <= 0) {
        throw new Error("number: step must be a positive integer");
      }
      if (!Number.isInteger(op.width) || op.width < 0) {
        throw new Error("number: width must be a non-negative integer");
      }
      break;
    }
    case "pattern": {
      if (op.template === "") {
        throw new Error("pattern: template must not be empty");
      }
      break;
    }
    case "case":
    case "trim":
      break;
  }
}

/** Apply a case transform to a stem. Words are split on spaces, `_` and `-`. */
export function applyCase(value: string, mode: CaseMode): string {
  switch (mode) {
    case "lower":
      return value.toLowerCase();
    case "upper":
      return value.toUpperCase();
    case "capitalize":
      return value.length === 0
        ? value
        : value[0]!.toUpperCase() + value.slice(1).toLowerCase();
    case "title": {
      return value
        .split(/[\s_-]+/)
        .filter((w) => w !== "")
        .map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    }
    case "snake":
      return toSeparated(value, "_");
    case "kebab":
      return toSeparated(value, "-");
  }
}

function toSeparated(value: string, sep: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, `$1${sep}$2`) // camelCase boundary
    .replace(/[\s-]+/g, sep)
    .replace(/_+/g, sep)
    .toLowerCase()
    .replace(new RegExp(`^${sep}+|${sep}+$`, "g"), "");
}

/**
 * Apply a list of operations to one filename.
 * `parent` is the name of the file's parent directory (for {parent}).
 */
export function applyOps(
  filename: string,
  ops: RenameOp[],
  index: number,
  parent: string,
  date: Date = new Date(),
): string {
  let { stem, ext } = splitFilename(filename);

  for (const op of ops) {
    switch (op.kind) {
      case "replace": {
        stem = op.regex
          ? stem.replace(
              new RegExp(op.search, op.flags ?? "g"),
              op.replacement,
            )
          : stem.split(op.search).join(op.replacement);
        break;
      }
      case "prefix":
        stem = op.text + stem;
        break;
      case "suffix":
        stem = stem + op.text;
        break;
      case "case":
        stem = applyCase(stem, op.mode);
        break;
      case "trim":
        stem = stem.trim();
        break;
      case "extension":
        ext = op.ext.replace(/^\./, "");
        break;
      case "number": {
        const num = String(op.start + (index - 1) * op.step).padStart(
          op.width,
          "0",
        );
        stem =
          op.position === "prefix"
            ? `${num}${op.separator}${stem}`
            : `${stem}${op.separator}${num}`;
        break;
      }
      case "pattern": {
        const ctx: PatternContext = { name: stem, ext, index, date, parent };
        const rendered = renderPattern(op.template, ctx);
        const parts = splitFilename(rendered);
        stem = parts.stem;
        // A template without an extension keeps the original one, so
        // "{name}_final" does not silently drop ".jpg".
        if (parts.ext !== "" || rendered.includes(".")) {
          ext = parts.ext;
        }
        break;
      }
    }
  }

  return ext === "" ? stem : `${stem}.${ext}`;
}
