import assert from "node:assert/strict";
import test from "node:test";
import { applyCase, applyOps, validateOp } from "../src/operations.js";

test("literal replace swaps every occurrence in the stem only", () => {
  assert.equal(
    applyOps("IMG_2024_2024.jpg", [
      { kind: "replace", search: "2024", replacement: "25", regex: false },
    ], 1, "photos"),
    "IMG_25_25.jpg",
  );
});

test("regex replace supports capture groups", () => {
  assert.equal(
    applyOps("IMG_001.jpg", [
      {
        kind: "replace",
        search: "IMG_(\\d+)",
        replacement: "photo-$1",
        regex: true,
        flags: "g",
      },
    ], 1, "photos"),
    "photo-001.jpg",
  );
});

test("prefix and suffix compose in order", () => {
  assert.equal(
    applyOps("cat.png", [
      { kind: "prefix", text: "trip-" },
      { kind: "suffix", text: "-final" },
    ], 1, "photos"),
    "trip-cat-final.png",
  );
});

test("case transforms cover lower, upper, title, snake and kebab", () => {
  assert.equal(
    applyOps("My Photo.JPG", [{ kind: "case", mode: "lower" }], 1, "d"),
    "my photo.JPG",
  );
  assert.equal(
    applyOps("My Photo.JPG", [{ kind: "case", mode: "upper" }], 1, "d"),
    "MY PHOTO.JPG",
  );
  assert.equal(
    applyOps("my_photo-name.JPG", [{ kind: "case", mode: "title" }], 1, "d"),
    "My Photo Name.JPG",
  );
  assert.equal(
    applyOps("My Photo Name.JPG", [{ kind: "case", mode: "snake" }], 1, "d"),
    "my_photo_name.JPG",
  );
  assert.equal(
    applyOps("My Photo Name.JPG", [{ kind: "case", mode: "kebab" }], 1, "d"),
    "my-photo-name.JPG",
  );
  assert.equal(
    applyOps("camelCaseName.txt", [{ kind: "case", mode: "snake" }], 1, "d"),
    "camel_case_name.txt",
  );
});

test("applyCase capitalize touches only the first letter", () => {
  assert.equal(applyCase("hELLO WORLD", "capitalize"), "Hello world");
});

test("trim strips surrounding whitespace from the stem", () => {
  assert.equal(
    applyOps("  spaced  .txt", [{ kind: "trim" }], 1, "d"),
    "spaced.txt",
  );
});

test("extension op swaps the extension and accepts a leading dot", () => {
  assert.equal(
    applyOps("photo.jpeg", [{ kind: "extension", ext: "png" }], 1, "d"),
    "photo.png",
  );
  assert.equal(
    applyOps("photo.jpeg", [{ kind: "extension", ext: ".webp" }], 1, "d"),
    "photo.webp",
  );
});

test("number op prefixes a padded counter and honours start/step", () => {
  const op = {
    kind: "number",
    start: 10,
    step: 5,
    width: 3,
    position: "prefix",
    separator: "_",
  } as const;
  assert.equal(applyOps("a.txt", [op], 1, "d"), "010_a.txt");
  assert.equal(applyOps("b.txt", [op], 2, "d"), "015_b.txt");
  const suffix = { ...op, position: "suffix" } as const;
  assert.equal(applyOps("a.txt", [suffix], 1, "d"), "a_010.txt");
});

test("pattern op uses placeholders and keeps the extension when absent", () => {
  const date = new Date(2026, 10, 19);
  assert.equal(
    applyOps("IMG_1.jpg", [
      { kind: "pattern", template: "{date}_{parent}_{n:02}" },
    ], 1, "trips", date),
    "2026-11-19_trips_01.jpg",
  );
  assert.equal(
    applyOps("IMG_1.jpg", [
      { kind: "pattern", template: "{name}-copy.png" },
    ], 1, "trips", date),
    "IMG_1-copy.png",
  );
});

test("operations apply in the order given", () => {
  assert.equal(
    applyOps("Hello World.txt", [
      { kind: "case", mode: "snake" },
      { kind: "prefix", text: "2026-" },
    ], 1, "d"),
    "2026-hello_world.txt",
  );
});

test("validateOp rejects an empty search, a bad regex and a dotted extension", () => {
  assert.throws(
    () => validateOp({ kind: "replace", search: "", replacement: "x", regex: false }),
    /must not be empty/,
  );
  assert.throws(
    () => validateOp({ kind: "replace", search: "([", replacement: "x", regex: true }),
    /Invalid regular expression/,
  );
  assert.throws(
    () => validateOp({ kind: "extension", ext: "tar.gz" }),
    /without a dot/,
  );
  assert.throws(
    () => validateOp({ kind: "prefix", text: "a/b" }),
    /path separator/,
  );
  assert.throws(
    () =>
      validateOp({
        kind: "number",
        start: 1,
        step: 0,
        width: 2,
        position: "prefix",
        separator: "-",
      }),
    /step must be a positive integer/,
  );
});
