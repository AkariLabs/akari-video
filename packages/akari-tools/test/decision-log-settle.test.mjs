import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectIds, findProposals, findSettled, parseDecisionLogRows, settleDecisionLog } from "../src/decision-log/settle.mjs";

const header = "| 日時 | category | subject | 決定 | 理由 | 決定者 | 関連 checkpoint |\n|---|---|---|---|---|---|---|\n";
const proposal = (id, related = "source-01") => `| 2026-09-07T00:00:00Z | proposal | ${id} | 追加 | 根拠 | machine:director | ${related} |\n`;
async function project(t) {
  const root = await mkdtemp(join(tmpdir(), "decision-log-settle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("three outcomes append exactly once and preserve every existing byte", async (t) => {
  const root = await project(t);
  const item = { source: { path: "a.png", kind: "image" }, id: "kept" };
  const canonical = '{"id":"kept","source":{"kind":"image","path":"a.png"}}';
  const sha = createHash("sha256").update(canonical).digest("hex").slice(0, 8);
  const original = Buffer.from((header + proposal("kept", `source-01 sha:${sha}`) + proposal("c-0001", "sha:00000000") + proposal("gone")).replaceAll("\n", "\r\n"));
  const path = join(root, "decision-log.md");
  await writeFile(path, original);
  await writeFile(join(root, "edit.json"), JSON.stringify({ tracks: [{ items: [item] }] }));
  await writeFile(join(root, "captions.json"), JSON.stringify({ captions: [{ id: "c-0001", text: "変更" }] }));
  const now = new Date("2026-09-07T10:00:00Z");
  assert.deepEqual(await settleDecisionLog({ projectRoot: root, now }), { settled: 3, results: [
    { subject: "kept", result: "残った" }, { subject: "c-0001", result: "直した" }, { subject: "gone", result: "消えた" },
  ] });
  const after = await readFile(path);
  assert.deepEqual(after.subarray(0, original.length), original);
  const appended = after.subarray(original.length).toString();
  assert.equal(appended.trim().split("\n").length, 3);
  assert.ok(appended.includes(`| ${now.toISOString()} | result | kept | 残った | 書き出し時に帳面と edit.json / captions.json を照合 | machine:render-cut | source-01 sha:${sha} |`));
  assert.deepEqual(await settleDecisionLog({ projectRoot: root }), { settled: 0, results: [] });
  assert.deepEqual(await readFile(path), after);
  assert.equal(createHash("sha256").update(await readFile(path)).digest("hex"), createHash("sha256").update(after).digest("hex"));
});

test("no sha keeps nested group items and array-root captions", async (t) => {
  const root = await project(t);
  const edit = { tracks: [{ items: [{ id: "g1", source: { kind: "group" }, items: [{ id: "g2", source: { kind: "group" }, items: [{ id: "inner", z: [2, 1], a: { z: 2, a: 1 } }] }] }] }] };
  assert.equal(collectIds({ edit }).get("inner"), '{"a":{"a":1,"z":2},"id":"inner","z":[2,1]}');
  assert.ok(collectIds({ edit }).has("g2"));
  await writeFile(join(root, "edit.json"), JSON.stringify(edit));
  await writeFile(join(root, "captions.json"), JSON.stringify([{ id: "c-0001" }]));
  await writeFile(join(root, "decision-log.md"), header + proposal("inner") + proposal("c-0001"));
  assert.deepEqual((await settleDecisionLog({ projectRoot: root })).results, [
    { subject: "inner", result: "残った" }, { subject: "c-0001", result: "残った" },
  ]);
});

test("absent log is not created", async (t) => {
  const root = await project(t);
  assert.deepEqual(await settleDecisionLog({ projectRoot: root }), { settled: 0 });
  await assert.rejects(access(join(root, "decision-log.md")), { code: "ENOENT" });
});

test("mixed prose and pipe records are ignored; trailing prose gets one table header", async (t) => {
  const root = await project(t);
  const original = header + proposal("gone") + "自由記述\n2026 | category: proposal | subject: ignored | 決定: 追加 | 理由: 理由 | 決定者: machine:director | 関連: 元\n末尾（改行なし）";
  const rows = parseDecisionLogRows(original);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].line, proposal("gone").trimEnd());
  assert.deepEqual(findProposals(rows).map((row) => row.subject), ["gone"]);
  const path = join(root, "decision-log.md");
  await writeFile(path, original);
  await settleDecisionLog({ projectRoot: root });
  const after = await readFile(path, "utf8");
  assert.equal(after.slice(0, original.length), original);
  assert.ok(after.slice(original.length).startsWith(`\n\n${header}`));
  assert.deepEqual(findSettled(parseDecisionLogRows(after)), new Set(["gone"]));
  await settleDecisionLog({ projectRoot: root });
  assert.equal(await readFile(path, "utf8"), after);
});

test("existing result subjects and duplicate proposals are settled only once", async (t) => {
  const root = await project(t);
  await writeFile(join(root, "decision-log.md"), header + proposal("done") + proposal("new") + proposal("new") + "| now | result | done | 残った | 理由 | human | 元 |\n");
  assert.deepEqual(await settleDecisionLog({ projectRoot: root }), { settled: 1, results: [{ subject: "new", result: "消えた" }] });
});

test("malformed JSON fails without appending", async (t) => {
  const root = await project(t);
  const original = header + proposal("a");
  await writeFile(join(root, "decision-log.md"), original);
  await writeFile(join(root, "edit.json"), "{");
  await assert.rejects(settleDecisionLog({ projectRoot: root }), SyntaxError);
  assert.equal(await readFile(join(root, "decision-log.md"), "utf8"), original);
});
