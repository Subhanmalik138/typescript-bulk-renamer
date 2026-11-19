import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { collectFiles } from "../src/scanner.js";

function makeTree(structure: Record<string, string | null>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bulk-rename-"));
  for (const [rel, body] of Object.entries(structure)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (body !== null) fs.writeFileSync(full, body);
  }
  return root;
}

test("collectFiles lists files sorted by name by default", () => {
  const root = makeTree({ "b.txt": "b", "a.txt": "a", "c.md": "c" });
  try {
    assert.deepEqual(
      collectFiles(root).map((f) => f.name),
      ["a.txt", "b.txt", "c.md"],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("collectFiles filters by extension, case-insensitively", () => {
  const root = makeTree({ "a.JPG": "a", "b.jpg": "b", "c.png": "c" });
  try {
    assert.deepEqual(
      collectFiles(root, { extensions: [".jpg"] }).map((f) => f.name),
      ["a.JPG", "b.jpg"],
    );
    assert.deepEqual(
      collectFiles(root, { extensions: ["png"] }).map((f) => f.name),
      ["c.png"],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("collectFiles honours a name regex and skips hidden files", () => {
  const root = makeTree({
    "IMG_01.jpg": "a",
    "IMG_02.jpg": "b",
    "photo.jpg": "c",
    ".hidden.jpg": "d",
  });
  try {
    assert.deepEqual(
      collectFiles(root, { match: /^IMG_/ }).map((f) => f.name),
      ["IMG_01.jpg", "IMG_02.jpg"],
    );
    assert.deepEqual(
      collectFiles(root, { includeHidden: true }).map((f) => f.name),
      [".hidden.jpg", "IMG_01.jpg", "IMG_02.jpg", "photo.jpg"],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("collectFiles recurses only when asked and groups by directory", () => {
  const root = makeTree({
    "top.txt": "t",
    "sub/nested.txt": "n",
    "sub/other.txt": "o",
  });
  try {
    assert.deepEqual(
      collectFiles(root).map((f) => f.name),
      ["top.txt"],
    );
    const recursive = collectFiles(root, { recursive: true });
    assert.deepEqual(
      recursive.map((f) => f.name),
      ["top.txt", "nested.txt", "other.txt"],
    );
    assert.equal(recursive.filter((f) => f.dir !== root).length, 2);
    assert.ok(
      recursive.every(
        (f) => f.dir === root || f.dir === path.join(root, "sub"),
      ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("collectFiles never picks up the undo journal", () => {
  const root = makeTree({ "a.txt": "a", ".rename-undo.json": "{}" });
  try {
    assert.deepEqual(
      collectFiles(root, { includeHidden: true }).map((f) => f.name),
      ["a.txt"],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("collectFiles throws a readable error for a missing directory", () => {
  assert.throws(
    () => collectFiles(path.join(os.tmpdir(), "definitely-not-here-12345")),
    /cannot read directory/,
  );
});
