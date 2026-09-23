#!/usr/bin/env node
// 書き出し側（render-cut の resolveCaptionPlan → 字幕オーバーレイ HTML）で、台本と同じ 1 文字編集
// （updateCaptionFieldsInSource）の後にも強調の span が出るかを数える。
// display_policy あり（カーネル経路）と、display_policy を外した従来経路（generateCaptionOverlays）の両方を見る。
// 使い方: node export-html-check.mjs <repo root> <label>   （label は before / after。ベースと変更後の両方で回す）
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EDITS, buildCaptions } from './gen-fixture.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(process.argv[2]);
const LABEL = process.argv[3] ?? 'after';
const require = createRequire(import.meta.url);
const store = require(path.join(REPO, 'packages/edit-store/lib/index.js'));
const { resolveCaptionPlan } = await import(pathToFileURL(path.join(REPO, 'packages/render-cut/src/caption-resolve.mjs')).href);

const fixture = buildCaptions();
const lines = fixture.captions.map(caption => `    ${JSON.stringify(caption)}`).join(',\n');
const records = fixture.emphasis_words.map(record => `    ${JSON.stringify(record)}`).join(',\n');
let source = `{\n  "display_policy": ${JSON.stringify(fixture.display_policy)},\n  "emphasis_words": [\n${records}\n  ],\n  "captions": [\n${lines}\n  ]\n}\n`;
const original = source;
for (const edit of EDITS) {
    const record = JSON.parse(source).captions.find(caption => caption.id === edit.id);
    source = store.updateCaptionFieldsInSource(source, edit.id, { text: record.text.replace(edit.from, edit.to) });
}
const edit = { output: { width: 1280, height: 720, fps: 30 }, sources: [{ id: 'main', path: 'assets/base.mp4' }], cuts: [{ src: 'main', in: 0, out: 20 }] };
const spans = html => [...html.matchAll(/data-emphasis-(?:preset|id)="[^"]*"[^>]*>([^<]*)</gu)].map(match => match[1]);

function measure(rootText, withPolicy) {
    const root = JSON.parse(rootText);
    if (!withPolicy) delete root.display_policy;
    const plan = resolveCaptionPlan({ captionsRoot: root, edit, projectRoot: ROOT, extraProtectedTerms: [], output: edit.output });
    return root.captions.map(caption => {
        const overlays = plan.overlays.filter(overlay => (overlay.at ?? overlay.start ?? 0) < caption.end
            && caption.start < (overlay.at ?? overlay.start ?? 0) + (overlay.duration ?? (overlay.end - overlay.start) ?? 0));
        const html = overlays.map(overlay => overlay.html ?? '').join('\n');
        return { id: caption.id, overlays: overlays.length, emphasisSpans: spans(html) };
    });
}

const result = {
    label: LABEL,
    edits: EDITS.map(({ id, from, to }) => ({ id, from, to })),
    kernelPath: { pre: measure(original, true), post: measure(source, true) },
    legacyPath: { pre: measure(original, false), post: measure(source, false) }
};
writeFileSync(path.join(ROOT, `export-html-${LABEL}.json`), `${JSON.stringify(result, null, 2)}\n`);
const brief = path => Object.fromEntries(['pre', 'post'].map(key => [key, result[path][key].map(row => `${row.id}:${row.emphasisSpans.join('|')}`).join(' ')]));
process.stdout.write(`${JSON.stringify({ kernel: brief('kernelPath'), legacy: brief('legacyPath') })}\n`);
