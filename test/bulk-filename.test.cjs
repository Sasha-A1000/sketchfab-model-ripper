const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  sanitizeBulkFileName,
} = require("../app/main/bulk-filename.js");

test("bulk file names lose characters Windows forbids", () => {
  assert.equal(sanitizeBulkFileName("Model: Ruins v2?"), "Model Ruins v2");
  assert.equal(
    sanitizeBulkFileName('a<b>c:d"e/f\\g|h?i*j.zip'),
    "abcdefghij.zip",
  );
  assert.equal(sanitizeBulkFileName("Model: Ruins v2?.zip"), "Model Ruins v2.zip");
});

test("control characters are removed from bulk file names", () => {
  assert.equal(
    sanitizeBulkFileName("bad\u0000na\u001fme.zip"),
    "badname.zip",
  );
  assert.equal(sanitizeBulkFileName("tab\tname\n.zip"), "tabname.zip");
});

test("a name that cleans up to nothing falls back to the model UID", () => {
  assert.equal(sanitizeBulkFileName(":", "1a2b3c4d"), "model_1a2b3c4d");
  assert.equal(sanitizeBulkFileName(":?*", "uid9"), "model_uid9");
  assert.equal(sanitizeBulkFileName(""), "model");
  assert.equal(sanitizeBulkFileName(" . "), "model");
});

test("reserved Windows device names get a leading underscore", () => {
  assert.equal(sanitizeBulkFileName("con.zip"), "_con.zip");
  assert.equal(sanitizeBulkFileName("COM1.zip"), "_COM1.zip");
  assert.equal(sanitizeBulkFileName("lpt9.tar.zip"), "_lpt9.tar.zip");
  assert.equal(sanitizeBulkFileName("CON"), "_CON");
});

test("trailing dots and spaces are trimmed", () => {
  assert.equal(sanitizeBulkFileName("Model. . "), "Model");
  assert.equal(sanitizeBulkFileName("Model name... "), "Model name");
});

test("already valid names stay byte-for-byte unchanged", () => {
  for (const name of [
    "Model Ruins v2-1a2b3c4d.zip",
    "My  Model (final).zip",
    "model_name-v2.zip",
  ]) {
    assert.equal(sanitizeBulkFileName(name, "ignored"), name);
  }
});
