import assert from "node:assert/strict";
import test from "node:test";
import { mergeCaptionsForApply } from "../src/captions/apply-diff.mjs";

test("counts added, changed, protected, removed and preserves protected objects", () => {
  const protectedRow = { id: "manual", src: "s1", start: 1, end: 2, text: "手直し", edited: true, sourceRef: { segment: 0 }, extra: true };
  const existing = [
    protectedRow,
    { id: "change", src: "s1", start: 3, end: 4, text: "old", sourceRef: { segment: 1 } },
    { id: "remove", src: "s1", start: 8, end: 9, text: "gone", sourceRef: { segment: 8 } }
  ];
  const next = [
    { id: "generated-1", src: "s1", start: 1.5, end: 2.5, text: "generated", sourceRef: { segment: 0 } },
    { id: "change", src: "s1", start: 3, end: 5, text: "new", sourceRef: { segment: 1 } },
    { id: "add", src: "s1", start: 6, end: 7, text: "new", sourceRef: { segment: 2 } }
  ];
  const result = mergeCaptionsForApply(existing, next);
  assert.deepEqual(result.summary, {
    added: 1, changed: 1, protected: 1, removed: 1, total: 3,
    ids: { added: ["add"], changed: ["change"], protected: ["manual"], removed: ["remove"] }
  });
  assert.equal(result.captions[0], protectedRow);
});

test("uses source segment ordinals and retains unmatched edited rows", () => {
  const unmatched = { id: "kept", start: 0, text: "manual", edited: true };
  const existing = [
    { id: "a", src: "s1", start: 2, end: 3, text: "a", sourceRef: { segment: 4 } },
    { id: "b", src: "s1", start: 4, end: 5, text: "b", sourceRef: { segment: 4 } },
    unmatched
  ];
  const next = [
    { id: "a", src: "s1", start: 2, end: 3, text: "a", sourceRef: { segment: 4 } },
    { id: "b", src: "s1", start: 4, end: 6, text: "changed", sourceRef: { segment: 4 } }
  ];
  const result = mergeCaptionsForApply(existing, next);
  assert.equal(result.summary.changed, 1);
  assert.equal(result.summary.protected, 1);
  assert.equal(result.captions[0], unmatched);
});

test("renumbers only unprotected duplicate or invalid ids", () => {
  const protectedRow = { id: "same", src: "s1", start: 3, edited: true, sourceRef: { segment: 9 } };
  const result = mergeCaptionsForApply([protectedRow], [
    { id: "same", start: 1 },
    { id: "same", start: 2 },
    { start: 4 }
  ]);
  assert.equal(result.captions.find(row => row.edited), protectedRow);
  assert.deepEqual(result.captions.map(row => row.id), ["c-0001", "c-0002", "same", "c-0003"]);
});

test("force replaces edited rows and reports no protection", () => {
  const existing = [{ id: "old", start: 0, end: 1, text: "manual", edited: true }];
  const next = [{ id: "old", start: 0, end: 1, text: "generated" }];
  const result = mergeCaptionsForApply(existing, next, { force: true });
  assert.equal(result.summary.protected, 0);
  assert.equal(result.summary.changed, 1);
  assert.equal(result.captions[0], next[0]);
});
