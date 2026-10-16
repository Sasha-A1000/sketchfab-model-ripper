import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanDescription } from "../app/lib/text.js";

test("description becomes readable text with entities and markup removed", () => {
  const description =
    "A &amp; B <b>bold</b> &lt;i&gt;italic&lt;/i&gt; &#128512; &#39;quote&#39;";
  assert.equal(cleanDescription(description), "A & B bold italic 😀 'quote'");
  assert.equal(
    cleanDescription("&amp;lt;b&amp;gt;safe&amp;lt;/b&amp;gt;"),
    "safe",
  );
});

test("description drops script/style content, collapses whitespace, and truncates", () => {
  assert.equal(
    cleanDescription(
      "one<script>alert(1)</script> two<style>.x{}</style> three",
    ),
    "one two three",
  );
  assert.equal(cleanDescription("<p>  alpha\n beta  </p>", 8), "alpha be");
});
