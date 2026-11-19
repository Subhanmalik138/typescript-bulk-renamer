# bulk-rename

A zero-dependency TypeScript CLI that renames many files at once — and
refuses to do anything unsafe. Rename a whole photo folder, a batch of
downloads, or a set of reports with one command, preview the result
first, and undo it if you change your mind.

```sh
# Preview: what would "IMG_01.jpg" become?
bulk-rename photos/ --replace IMG_ --with photo_ --dry-run

# Actually do it (asks first unless you pass --yes)
bulk-rename photos/ --prefix trip- --case lower --yes

# Number a folder of scans, zero-padded, in name order
bulk-rename scans/ --pattern "{date}_scan_{n:03}" --yes

# Changed your mind?
bulk-rename photos/ --undo
```

## Why this exists

Bulk renaming is a classic foot-gun: a bad pattern overwrites files,
two files collide on the same target, or a swap (`a → b`, `b → a`)
loses one of them. This tool treats a rename run as a transaction:

1. **Plan first.** Every new name is computed up front; files whose
   name would not change are left alone.
2. **Check conflicts before touching anything.** Duplicate targets,
   a target that already exists on disk, and invalid names all abort
   the run with a clear message — nothing is renamed.
3. **Two-phase apply.** Files first move to unique temporary names,
   then to their final names, so swaps and rotation chains are safe.
   If anything fails midway, the directory is rolled back.
4. **Undo journal.** Every run writes `.rename-undo.json` in the
   directory; `bulk-rename <dir> --undo` reverses the last run.

## Design decisions

- **Operations compose in order.** `--case snake --prefix 2026-` is
  not the same as `--prefix 2026- --case snake`; the CLI applies
  exactly what you typed, left to right.
- **Replacements are stem-only.** `--replace jpg --with png` changes
  a file called `jpg-notes.txt`, not the `.jpg` extension — use
  `--ext png` when you mean the extension.
- **Case-insensitive collision check.** On macOS/Windows `File.txt`
  and `file.txt` are the same file, so the planner treats them as a
  collision even on Linux, where they are technically distinct.
- **No dependencies, no config file.** The whole tool is `node:fs`
  plus argument parsing, so there is nothing to install beyond Node
  itself and nothing to configure.

## Usage

```
bulk-rename [directory] [options]
```

| Option | What it does |
| --- | --- |
| `--replace FROM --with TO` | Replace text in the name (repeatable) |
| `--regex` | Treat `--replace` searches as regular expressions |
| `--prefix TEXT` | Add a prefix to every name |
| `--suffix TEXT` | Add a suffix before the extension |
| `--case MODE` | `lower` `upper` `title` `snake` `kebab` `capitalize` |
| `--trim` | Strip leading/trailing whitespace from names |
| `--ext EXT` | Set the extension, e.g. `png` |
| `--pattern TEMPLATE` | Full rename template (see below) |
| `--number` (+ `--number-start`, `--number-step`, `--number-width`, `--number-sep`, `--number-position`) | Add a counter |
| `--recursive` | Include files in subdirectories |
| `--match REGEX` | Only rename files whose name matches |
| `--only-ext .jpg,.png` | Only rename files with these extensions |
| `--include-hidden` | Include dotfiles |
| `--sort MODE` | Plan order: `name` `mtime` `size` (default `name`) |
| `--dry-run` | Show the plan without renaming anything |
| `--yes` | Apply without asking for confirmation |
| `--undo` | Revert the last rename in the directory |
| `--help` | Show help |

### Pattern templates

`--pattern` renames the whole filename from a template:

| Placeholder | Meaning |
| --- | --- |
| `{name}` | File stem (name without extension) |
| `{ext}` | Extension without the dot |
| `{n}` | 1-based position in the planned list |
| `{n:03}` | Same, zero-padded to 3 digits |
| `{date}` | Today's date as `YYYY-MM-DD` |
| `{parent}` | Name of the file's parent directory |

A template without an extension keeps the original one, so
`--pattern "{name}_final"` turns `photo.jpg` into `photo_final.jpg`.
Write a literal brace doubled: `{{name}}`. Unknown placeholders are
an error, not a silent rename.

## Examples

```sh
# Clean up camera files: IMG_0042.jpg -> 2026-11-19_trip_042.jpg
bulk-rename trip-photos/ --pattern "{date}_{parent}_{n:03}" --yes

# Lowercase everything and swap spaces for underscores
bulk-rename docs/ --case snake --yes

# Rename only PDFs whose name starts with "draft", add a version suffix
bulk-rename reports/ --only-ext .pdf --match "^draft" --suffix "-v2" --yes

# Number a folder starting at 100, stepping by 10, after the name
bulk-rename scans/ --number --number-start 100 --number-step 10 \
  --number-position suffix --yes

# Regex: collapse repeated separators in one pass
bulk-rename . --regex --replace "[_\\-]+" --with "-" --yes
```

## Install and run

```sh
npm install
npm run build
node dist/src/cli.js --help
# or, after npm link:
bulk-rename --help
```

## Tests

```sh
npm test
```

The suite (Node's built-in test runner, no test framework) covers the
pattern engine, every operation, conflict detection, two-phase apply
including swaps and rollback, file collection, the undo journal, and
end-to-end CLI runs in temporary directories.

## Tech stack

TypeScript (strict mode), Node.js ≥ 22, zero runtime dependencies.
