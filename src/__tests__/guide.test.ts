import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execute } from "../gpp.js";
import { ALL_SNIPPETS, GUIDE } from "../../playground/src/guide.js";

// the guide teaches the language, so a snippet that does not run teaches the
// wrong thing. these run every one through the real evaluator.

describe("guide structure", () => {
  test("section ids are unique", () => {
    const ids = GUIDE.map((section) => section.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate section id");
  });

  test("every section has snippets and a blurb", () => {
    for (const section of GUIDE) {
      assert.ok(section.title, `${section.id} has no title`);
      assert.ok(section.blurb, `${section.id} has no blurb`);
      assert.ok(section.snippets.length > 0, `${section.id} has no snippets`);
    }
  });

  test("every snippet has a title and a note", () => {
    for (const { id, snippet } of ALL_SNIPPETS) {
      assert.ok(snippet.title, `${id} has no title`);
      assert.ok(snippet.note, `${id} has no note`);
      assert.ok(snippet.source.trim(), `${id} has no source`);
    }
  });
});

describe("guide snippets run", () => {
  for (const { id, snippet } of ALL_SNIPPETS) {
    test(`${id} runs without error`, () => {
      const result = execute(snippet.source);
      assert.equal(
        result.error,
        null,
        `${id} failed: ${result.error?.message}`,
      );
    });

    // a type warning on a teaching example reads as the language rejecting
    // ordinary code, so the guide must stay clean
    test(`${id} has no type errors`, () => {
      const result = execute(snippet.source);
      assert.deepEqual(
        result.typeErrors.map((e) => `${e.line}:${e.column} ${e.message}`),
        [],
        `${id} produced type errors`,
      );
    });

    test(`${id} prints something`, () => {
      const result = execute(snippet.source);
      assert.ok(result.output.length > 0, `${id} produced no output`);
    });
  }
});
