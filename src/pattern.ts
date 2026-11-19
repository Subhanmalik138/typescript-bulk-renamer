/**
 * Filename template engine.
 *
 * Templates are plain strings with `{placeholder}` slots:
 *
 *   {name}    file stem (name without extension)
 *   {ext}     extension without the dot ("" when there is none)
 *   {n}       1-based position of the file in the planned list
 *   {n:03}    same, zero-padded to the given width
 *   {date}    today's date as YYYY-MM-DD
 *   {parent}  name of the file's parent directory
 *
 * A literal brace is written doubled: `{{` renders as `{`, `}}` as `}`.
 * Unknown placeholders are a hard error — a typo in a template must never
 * silently rename a file to something unintended.
 */

export interface PatternContext {
  name: string;
  ext: string;
  index: number;
  date: Date;
  parent: string;
}

const PLACEHOLDER = /\{([^{}]+)\}/g;
const ESC_OPEN = "\u0000BRACE-OPEN\u0000";
const ESC_CLOSE = "\u0000BRACE-CLOSE\u0000";

export function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Split a filename into stem and extension (without the dot). */
export function splitFilename(filename: string): { stem: string; ext: string } {
  const dot = filename.lastIndexOf(".");
  // No dot, or a leading dot (dotfile): the whole name is the stem.
  if (dot <= 0) return { stem: filename, ext: "" };
  return { stem: filename.slice(0, dot), ext: filename.slice(dot + 1) };
}

export function renderPattern(template: string, ctx: PatternContext): string {
  const escaped = template
    .replaceAll("{{", ESC_OPEN)
    .replaceAll("}}", ESC_CLOSE);

  const rendered = escaped.replace(PLACEHOLDER, (_match, key: string) => {
    if (key === "name") return ctx.name;
    if (key === "ext") return ctx.ext;
    if (key === "date") return formatDate(ctx.date);
    if (key === "parent") return ctx.parent;
    if (key === "n") return String(ctx.index);
    const padded = /^n:(\d+)$/.exec(key);
    if (padded?.[1] !== undefined) {
      return String(ctx.index).padStart(Number(padded[1]), "0");
    }
    throw new Error(
      `unknown placeholder {${key}} in pattern "${template}"`,
    );
  });

  return rendered.replaceAll(ESC_OPEN, "{").replaceAll(ESC_CLOSE, "}");
}
