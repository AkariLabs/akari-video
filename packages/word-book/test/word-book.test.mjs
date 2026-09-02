import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  addEntry,
  applyWordBook,
  buildMatcher,
  layerPathFor,
  loadWordBookFile,
  normalizeKey,
  resolveWordBook,
  scanRecord,
  writeWordBookFile,
} from "../src/index.mjs";

const term = (overrides = {}) => ({ surface: "AKARI Video", variants: ["あかりビデオ"], kind: "term", scope: "project", ...overrides });
const matcher = (entries = [term()]) => buildMatcher(entries);

test("normalizeKey は NFKC・小文字化・空白除去を行う", () => assert.equal(normalizeKey(" ＡＫＡＲＩ\tＶｉｄｅｏ "), "akarivideo"));
test("normalizeKey は合成可能な文字を NFKC 合成する", () => assert.equal(normalizeKey("A\u030A"), "å"));

test("語の途中には一致しない", () => {
  const result = applyWordBook([{ text: "灯りビデオ", words: [{ start: 0, end: 1, text: "灯りビデオ" }] }], matcher([term({ surface: "灯り", variants: [] })]), { mode: "transcript" });
  assert.equal(result.stats.replaced, 0);
});

test("多語を 1 語へ畳み先頭と末尾の時刻を保つ", () => {
  const input = [{ text: "あかり ビデオです", words: [{ start: 0, end: 0.4, text: "あかり" }, { start: 0.4, end: 0.9, text: "ビデオ" }, { start: 1, end: 1.2, text: "です" }] }];
  const result = applyWordBook(input, matcher(), { mode: "transcript" });
  assert.deepEqual(result.records[0].words[0], { start: 0, end: 0.9, text: "AKARI Video" });
  assert.equal(result.records[0].text, "AKARI Videoです");
});

test("同じ位置では語数が長い候補を採る", () => {
  const result = applyWordBook([{ text: "あかり ビデオ", words: [{ start: 0, end: 0.4, text: "あかり" }, { start: 0.4, end: 0.9, text: "ビデオ" }] }], matcher([
    term({ surface: "AKARI", variants: ["あかり"] }),
    term(),
  ]), { mode: "transcript" });
  assert.equal(result.records[0].words.length, 1);
  assert.equal(result.records[0].words[0].text, "AKARI Video");
});

test("term の surface 正規化キー一致を正表記へ直す", () => {
  const result = applyWordBook([{ text: "ＡＫＡＲＩ Ｖｉｄｅｏ", words: [{ start: 0, end: 1, text: "ＡＫＡＲＩ Ｖｉｄｅｏ" }] }], matcher([term({ variants: [] })]), { mode: "transcript" });
  assert.equal(result.records[0].text, "AKARI Video");
});

test("notation は scan できるが置換しない", () => {
  const value = { text: "ムービー", words: [{ start: 0, end: 1, text: "ムービー" }] };
  const built = matcher([{ surface: "動画", variants: ["ムービー"], kind: "notation", scope: "project" }]);
  assert.equal(applyWordBook([value], built, { mode: "transcript" }).stats.replaced, 0);
  assert.deepEqual(scanRecord(value, built), [{ surface: "動画", kind: "notation", matched: "ムービー", index: 0 }]);
});

test("text 側に語列が無ければ words も変えず skip を数える", () => {
  const source = { text: "別の本文", words: [{ start: 0, end: 0.4, text: "あかり" }, { start: 0.4, end: 0.9, text: "ビデオ" }] };
  const result = applyWordBook([source], matcher(), { mode: "transcript" });
  assert.equal(result.stats.skipped_text_mismatch, 1);
  assert.deepEqual(result.records[0], source);
});

test("words 無しは Intl.Segmenter の語境界で置換する", () => {
  const result = applyWordBook([{ text: "akari video demo" }], matcher([term({ variants: ["akari video"] })]), { mode: "transcript", locale: "en" });
  assert.equal(result.records[0].text, "AKARI Video demo");
});

test("2 回適用しても 1 回と同じ", () => {
  const source = [{ text: "あかり ビデオ", words: [{ start: 0, end: 0.4, text: "あかり" }, { start: 0.4, end: 0.9, text: "ビデオ" }] }];
  const first = applyWordBook(source, matcher(), { mode: "transcript" });
  const second = applyWordBook(first.records, matcher(), { mode: "transcript" });
  assert.deepEqual(second.records, first.records);
  assert.equal(second.stats.replaced, 0);
});

test("入力 records と words を破壊しない", () => {
  const source = [{ text: "あかりビデオ", words: [{ start: 0, end: 1, text: "あかりビデオ" }] }];
  const before = structuredClone(source);
  applyWordBook(source, matcher(), { mode: "transcript" });
  assert.deepEqual(source, before);
});

test("captions の edited 行は skip する", () => {
  const result = applyWordBook([{ text: "あかりビデオ", edited: true, words: [{ start: 0, end: 1, text: "あかりビデオ" }] }], matcher(), { mode: "captions" });
  assert.equal(result.stats.skipped_edited, 1);
  assert.equal(result.stats.replaced, 0);
});

test("captions の display_text も追従する", () => {
  const result = applyWordBook([{ text: "あかりビデオ", display_text: "あかりビデオ!", edited: false, words: [{ start: 0, end: 1, text: "あかりビデオ" }] }], matcher(), { mode: "captions" });
  assert.equal(result.records[0].display_text, "AKARI Video!");
});

test("display_fragments 内に収まる一致を置換する", () => {
  const result = applyWordBook([{ text: "あかりビデオです", display_fragments: ["あかりビデオ", "です"], edited: false, words: [{ start: 0, end: 1, text: "あかりビデオ" }, { start: 1, end: 2, text: "です" }] }], matcher(), { mode: "captions" });
  assert.deepEqual(result.records[0].display_fragments, ["AKARI Video", "です"]);
});

test("display_fragments 境界をまたぐ一致はレコード全体を skip する", () => {
  const source = { text: "あかり ビデオ", display_fragments: ["あかり ", "ビデオ"], edited: false, words: [{ start: 0, end: 0.4, text: "あかり" }, { start: 0.4, end: 0.9, text: "ビデオ" }] };
  const result = applyWordBook([source], matcher(), { mode: "captions" });
  assert.equal(result.stats.skipped_fragment_boundary, 1);
  assert.deepEqual(result.records[0], source);
});

test("stats は surface ごとの置換数を持つ", () => {
  const result = applyWordBook([{ text: "あかりビデオ", words: [{ start: 0, end: 1, text: "あかりビデオ" }] }], matcher(), { mode: "transcript" });
  assert.deepEqual(result.stats.by_surface, { "AKARI Video": 1 });
});

test("scanRecord は term を置換せず列挙する", () => {
  assert.deepEqual(scanRecord({ text: "あかりビデオ", words: [{ start: 0, end: 1, text: "あかりビデオ" }] }, matcher()), [{ surface: "AKARI Video", kind: "term", matched: "あかりビデオ", index: 0 }]);
});

test("loadWordBookFile は ENOENT を null として返す", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "word-book-load-"));
  assert.deepEqual(await loadWordBookFile(path.join(root, "missing.json")), { ok: true, book: null });
  await rm(root, { recursive: true, force: true });
});

test("loadWordBookFile は parse / schema / too-new を区別する", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "word-book-load-"));
  await writeFile(path.join(root, "parse.json"), "{");
  await writeFile(path.join(root, "schema.json"), JSON.stringify({ version: 0, entries: [{ surface: "x" }] }));
  await writeFile(path.join(root, "new.json"), JSON.stringify({ version: 1, entries: [] }));
  assert.equal((await loadWordBookFile(path.join(root, "parse.json"))).error.code, "parse");
  assert.equal((await loadWordBookFile(path.join(root, "schema.json"))).error.code, "schema");
  assert.equal((await loadWordBookFile(path.join(root, "new.json"))).error.code, "too-new");
  await rm(root, { recursive: true, force: true });
});

test("layerPathFor は 4 層の正準パスを返す", () => {
  const root = path.resolve("/fixture/root");
  const project = path.join(root, "channels", "c", "videos", "p");
  assert.equal(layerPathFor({ scope: "project", projectRoot: project }), path.join(project, ".akari", "memory", "word-book.json"));
  assert.equal(layerPathFor({ scope: "channel", projectRoot: project, creatorRoot: root }), path.join(root, "channels", "c", ".akari", "memory", "word-book.json"));
  assert.equal(layerPathFor({ scope: "workspace", creatorRoot: root }), path.join(root, ".akari", "memory", "word-book.json"));
  assert.match(layerPathFor({ scope: "builtin" }), /presets[/\\]word-book[/\\]builtin\.json$/);
});

test("resolveWordBook は project > channel > workspace > builtin で surface を shadow する", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "word-book-root-"));
  const project = path.join(root, "channels", "c", "videos", "p");
  await mkdir(path.join(root, ".akari"), { recursive: true });
  await writeFile(path.join(root, ".akari", "root.json"), JSON.stringify({ schema: "creator-root/v1" }));
  const paths = {
    workspace: path.join(root, ".akari", "memory", "word-book.json"),
    channel: path.join(root, "channels", "c", ".akari", "memory", "word-book.json"),
    project: path.join(project, ".akari", "memory", "word-book.json"),
  };
  await writeWordBookFile(paths.workspace, { version: 0, entries: [{ surface: "AKARI Video", variants: ["workspace"], kind: "term" }] });
  await writeWordBookFile(paths.channel, { version: 0, entries: [{ surface: "AKARI Video", variants: ["channel"], kind: "term" }] });
  await writeWordBookFile(paths.project, { version: 0, entries: [{ surface: "案件語", variants: ["案件"], kind: "term" }] });
  const resolved = await resolveWordBook({ projectRoot: project, env: { AKARI_CREATOR_ROOT: root } });
  assert.equal(resolved.sources["AKARI Video"], "channel");
  assert.equal(resolved.sources["案件語"], "project");
  assert.deepEqual(resolved.layers.map((layer) => layer.scope), ["project", "channel", "workspace", "builtin"]);
  await rm(root, { recursive: true, force: true });
});

test("resolveWordBook の projectRoot 無しは extra + builtin だけ", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "word-book-extra-"));
  const extra = path.join(root, "word-book.json");
  await writeWordBookFile(extra, { version: 0, entries: [{ surface: "追加", variants: ["ついか"], kind: "term" }] });
  const resolved = await resolveWordBook({ extraPath: extra, env: {} });
  assert.deepEqual(resolved.layers.map((layer) => layer.scope), ["extra", "builtin"]);
  await rm(root, { recursive: true, force: true });
});

test("writeWordBookFile は検証失敗時に既存ファイルと temp を残さない", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "word-book-write-"));
  const file = path.join(root, "word-book.json");
  await writeWordBookFile(file, { version: 0, entries: [] });
  const before = readFileSync(file, "utf8");
  await assert.rejects(writeWordBookFile(file, { version: 0, entries: [{ surface: "bad" }] }), /検証に失敗/);
  assert.equal(readFileSync(file, "utf8"), before);
  assert.deepEqual((await readdir(root)).filter((name) => name.endsWith(".tmp")), []);
  await rm(root, { recursive: true, force: true });
});

test("addEntry は追加し同一 surface キーを丸ごと置換する", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "word-book-add-"));
  const file = path.join(root, "word-book.json");
  const added = await addEntry(file, { surface: "AKARI Video", variants: ["あかり"], kind: "term" });
  assert.equal(added.replaced, false);
  assert.ok(added.book.entries[0].added_at);
  const replaced = await addEntry(file, { surface: "ａｋａｒｉ　ｖｉｄｅｏ", variants: ["灯り"], kind: "term", source: "manual" });
  assert.equal(replaced.replaced, true);
  assert.equal(replaced.book.entries.length, 1);
  assert.equal(replaced.book.entries[0].source, "manual");
  assert.equal(existsSync(file), true);
  await rm(root, { recursive: true, force: true });
});
