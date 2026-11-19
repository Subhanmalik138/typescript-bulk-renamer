import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/cli.js";

const CLI = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "cli.js",
);

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { cwd },
      (error, stdout, stderr) => {
        resolve({
          code:
            error === null
              ? 0
              : typeof error.code === "number"
                ? error.code
                : 1,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        });
      },
    );
  });
}

function makeTree(files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bulk-rename-cli-"));
  for (const name of files) {
    fs.writeFileSync(path.join(root, name), name);
  }
  return root;
}

test("parseArgs builds replace, prefix and numbering ops", () => {
  const opts = parseArgs([
    ".",
    "--replace",
    "IMG_",
    "--with",
    "photo_",
    "--prefix",
    "x-",
    "--number",
    "--number-width",
    "3",
    "--dry-run",
  ]);
  assert.equal(opts.ops.length, 3);
  assert.deepEqual(opts.ops[0], {
    kind: "replace",
    search: "IMG_",
    replacement: "photo_",
    regex: false,
  });
  assert.deepEqual(opts.ops[1], { kind: "prefix", text: "x-" });
  assert.deepEqual(opts.ops[2], {
    kind: "number",
    start: 1,
    step: 1,
    width: 3,
    position: "prefix",
    separator: "-",
  });
  assert.equal(opts.dryRun, true);
});

test("parseArgs applies --regex to replace ops regardless of position", () => {
  const opts = parseArgs([
    "--replace",
    "IMG_(\\d+)",
    "--with",
    "photo-$1",
    "--regex",
  ]);
  assert.equal(opts.ops[0]?.kind, "replace");
  if (opts.ops[0]?.kind === "replace") {
    assert.equal(opts.ops[0].regex, true);
    assert.equal(opts.ops[0].flags, "g");
  }
});

test("parseArgs rejects a --replace without --with and unknown flags", () => {
  assert.throws(() => parseArgs(["--replace", "a"]), /needs a matching --with/);
  assert.throws(() => parseArgs(["--nope"]), /unknown option/);
  assert.throws(() => parseArgs(["--case", "weird"]), /must be one of/);
});

test("CLI dry-run previews without touching files", async () => {
  const root = makeTree(["IMG_01.jpg", "IMG_02.jpg"]);
  try {
    const result = await runCli(
      [root, "--replace", "IMG_", "--with", "photo_", "--dry-run"],
      root,
    );
    assert.equal(result.code, 0);
    assert.match(result.stdout, /IMG_01\.jpg\s+->\s+photo_01\.jpg/);
    assert.match(result.stdout, /dry run/);
    assert.deepEqual(fs.readdirSync(root).sort(), ["IMG_01.jpg", "IMG_02.jpg"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI renames for real with --yes and writes an undo journal", async () => {
  const root = makeTree(["IMG_01.jpg", "IMG_02.jpg", "notes.txt"]);
  try {
    const result = await runCli(
      [root, "--only-ext", ".jpg", "--prefix", "trip-", "--yes"],
      root,
    );
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Renamed 2 file\(s\)/);
    assert.deepEqual(fs.readdirSync(root).sort(), [
      ".rename-undo.json",
      "notes.txt",
      "trip-IMG_01.jpg",
      "trip-IMG_02.jpg",
    ]);
    assert.equal(fs.readFileSync(path.join(root, "trip-IMG_01.jpg"), "utf8"), "IMG_01.jpg");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI --undo restores the previous names and removes the journal", async () => {
  const root = makeTree(["a.txt", "b.txt"]);
  try {
    const renamed = await runCli([root, "--suffix", "-v2", "--yes"], root);
    assert.equal(renamed.code, 0);
    assert.deepEqual(fs.readdirSync(root).sort(), [
      ".rename-undo.json",
      "a-v2.txt",
      "b-v2.txt",
    ]);
    const undone = await runCli([root, "--undo"], root);
    assert.equal(undone.code, 0);
    assert.match(undone.stdout, /Undid 2 rename\(s\)/);
    assert.deepEqual(fs.readdirSync(root).sort(), ["a.txt", "b.txt"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI refuses a conflicting plan and renames nothing", async () => {
  const root = makeTree(["a.txt", "keep.txt"]);
  try {
    const result = await runCli(
      [root, "--replace", "a", "--with", "keep", "--yes"],
      root,
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /already exists/);
    assert.deepEqual(fs.readdirSync(root).sort(), ["a.txt", "keep.txt"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI refuses to apply without --yes when stdin is not a TTY", async () => {
  const root = makeTree(["a.txt"]);
  try {
    const result = await runCli([root, "--prefix", "x-"], root);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Aborted/);
    assert.deepEqual(fs.readdirSync(root), ["a.txt"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI --undo with no journal exits non-zero", async () => {
  const root = makeTree(["a.txt"]);
  try {
    const result = await runCli([root, "--undo"], root);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /No undo journal/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI pattern rename numbers files in sorted order", async () => {
  const root = makeTree(["b.jpg", "a.jpg", "c.jpg"]);
  try {
    const result = await runCli(
      [root, "--pattern", "photo-{n:02}", "--yes"],
      root,
    );
    assert.equal(result.code, 0);
    assert.deepEqual(fs.readdirSync(root).sort(), [
      ".rename-undo.json",
      "photo-01.jpg",
      "photo-02.jpg",
      "photo-03.jpg",
    ]);
    assert.equal(
      fs.readFileSync(path.join(root, "photo-01.jpg"), "utf8"),
      "a.jpg",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
