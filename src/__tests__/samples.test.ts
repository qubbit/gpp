import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execute } from "../gpp.js";
import { SAMPLES } from "../../playground/src/samples.js";

// the playground preloads these, so a broken one is visible on first paint.
// running them through the real evaluator here keeps that from shipping.

describe("playground samples", () => {
  test("every sample has the fields the ui needs", () => {
    for (const sample of SAMPLES) {
      assert.ok(sample.id, "a sample is missing an id");
      assert.ok(sample.name, `${sample.id} is missing a name`);
      assert.ok(sample.description, `${sample.id} is missing a description`);
      assert.ok(sample.source.trim(), `${sample.id} has no source`);
    }
  });

  test("sample ids are unique", () => {
    const ids = SAMPLES.map((sample) => sample.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate sample id");
  });

  for (const sample of SAMPLES) {
    test(`${sample.id} runs without error`, () => {
      const result = execute(sample.source);
      assert.equal(
        result.error,
        null,
        `${sample.id} failed: ${result.error?.message}`,
      );
    });

    test(`${sample.id} prints something`, () => {
      // a sample that produces no output looks broken in the playground
      const result = execute(sample.source);
      assert.ok(
        result.output.length > 0,
        `${sample.id} produced no output`,
      );
    });

    test(`${sample.id} parses to a tree the ast view can render`, () => {
      const result = execute(sample.source);
      assert.ok(result.ast, `${sample.id} produced no ast`);
      assert.ok(result.ast!.body.length > 0);
    });

    // gradual typing means a sample should never show a type warning, since
    // that is what a reader would take as the language rejecting normal code
    test(`${sample.id} has no type errors`, () => {
      const result = execute(sample.source);
      assert.deepEqual(
        result.typeErrors.map((e) => `${e.line}:${e.column} ${e.message}`),
        [],
        `${sample.id} produced type errors`,
      );
    });
  }
});

describe("share encoding", () => {
  // the playground stores the program in the url fragment. this mirrors the
  // implementation in playground/src/share.ts, which cannot be imported here
  // because it touches window.
  const encode = (source: string) => {
    const bytes = new TextEncoder().encode(source);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return Buffer.from(binary, "binary")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  };

  const decode = (encoded: string) => {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = Buffer.from(padded, "base64").toString("binary");
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  };

  test("every sample round trips through a share link", () => {
    for (const sample of SAMPLES) {
      assert.equal(decode(encode(sample.source)), sample.source, sample.id);
    }
  });

  test("non ascii source survives the round trip", () => {
    const source = 'println("héllo ✨ 日本語")';
    assert.equal(decode(encode(source)), source);
  });

  test("the encoding is url safe", () => {
    for (const sample of SAMPLES) {
      const encoded = encode(sample.source);
      assert.doesNotMatch(encoded, /[+/=]/, `${sample.id} needs escaping`);
      assert.equal(encodeURIComponent(encoded), encoded, sample.id);
    }
  });
});
