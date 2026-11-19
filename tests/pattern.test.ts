import assert from "node:assert/strict";
import test from "node:test";
import { formatDate, renderPattern, splitFilename } from "../src/pattern.js";

const ctx = {
  name: "photo",
  ext: "jpg",
  index: 3,
  date: new Date(2026, 10, 19),
  parent: "trips",
};

test("renderPattern replaces every placeholder", () => {
  assert.equal(
    renderPattern("{date}_{parent}_{name}_{n:03}.{ext}", ctx),
    "2026-11-19_trips_photo_003.jpg",
  );
});

test("renderPattern leaves an unpadded counter as-is", () => {
  assert.equal(renderPattern("file-{n}", ctx), "file-3");
});

test("renderPattern pads a counter to the requested width", () => {
  assert.equal(renderPattern("file-{n:2}", ctx), "file-03");
  assert.equal(renderPattern("file-{n:5}", { ...ctx, index: 42 }), "file-00042");
});

test("renderPattern keeps a missing extension empty", () => {
  assert.equal(
    renderPattern("{name}.{ext}", { ...ctx, ext: "" }),
    "photo.",
  );
});

test("renderPattern supports literal braces via doubling", () => {
  assert.equal(renderPattern("{{name}} is {name}", ctx), "{name} is photo");
});

test("renderPattern throws on an unknown placeholder", () => {
  assert.throws(
    () => renderPattern("{unknown}", ctx),
    /unknown placeholder \{unknown\}/,
  );
});

test("formatDate zero-pads month and day", () => {
  assert.equal(formatDate(new Date(2026, 0, 5)), "2026-01-05");
});

test("splitFilename handles extensions, dotfiles and extensionless names", () => {
  assert.deepEqual(splitFilename("photo.jpg"), { stem: "photo", ext: "jpg" });
  assert.deepEqual(splitFilename("archive.tar.gz"), {
    stem: "archive.tar",
    ext: "gz",
  });
  assert.deepEqual(splitFilename("README"), { stem: "README", ext: "" });
  assert.deepEqual(splitFilename(".gitignore"), {
    stem: ".gitignore",
    ext: "",
  });
});
