// L1 用のストアのスタブ（ラッパー作成の検証スクリプト）。有料品の実体は使わない — 中身はダミーの fixture。
// - 素材カタログ（AKARI_ASSETS_CATALOG に渡すファイル）: 有料テロップ 3 件（product_id = telop-rich-pack-01・¥1,980）+
//   無料テロップ 1 件 + テロップでない overlay 1 件
// - GET /api/store/v1/entitlements: mode='none' は空・mode='owned' は telop-rich-pack-01
// - GET /api/store/v1/download/telop-rich-pack-01: 実物と同じ配置（<pack>-v1/assets/<id>/）のダミー zip
// - GET /assets/...: 無料品の実体とカードの見本画像
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

export const PACK = 'telop-rich-pack-01';
export const PAID = [
    { id: 'telop-fixture-gold', title: 'テロップ（金・fixture）', color: '#f4c542' },
    { id: 'telop-fixture-blue', title: 'テロップ（青・fixture）', color: '#3aa0ff' },
    { id: 'telop-fixture-pink', title: 'テロップ（桃・fixture）', color: '#ff4fa3' }
];
export const FREE = { id: 'telop-fixture-free', title: '無料テロップ（fixture）', color: '#7be07b' };
export const OTHER = { id: 'frame-fixture', title: '枠（テロップでない fixture）', color: '#999999' };
const sha = buffer => createHash('sha256').update(buffer).digest('hex');

// 1 色で塗った PNG（見本画像）を ffmpeg で作る
function png(color, file) {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color.replace('#', '0x')}:size=320x120`, '-frames:v', '1', file]);
}
function fragment(asset) {
    return `<div class="${asset.id}" style="position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);font:900 120px sans-serif;`
        + `color:${asset.color};-webkit-text-stroke:10px #000;paint-order:stroke fill"><span class="${asset.id}__fill">TELOP</span>`
        + `<span data-mirror="text" aria-hidden="true" style="display:none">TELOP</span></div>\n`;
}
function meta(asset, price) {
    return {
        id: asset.id, category: 'overlay', title: asset.title, description: 'L1 用のダミーのテロップ（fixture）',
        when_to_use: 'L1 の検証のみ', tags: ['telop', 'fixture'], knobs: [], ai_usage: 'L1 の検証のみ', requires: [],
        provenance: { origin: 'textstyle-lab-crown L1 fixture', generator: null }, author: 'fixture',
        license: { spdx: price ? 'LicenseRef-AKARI-Assets-v0' : 'CC0-1.0', scope: price ? 'paid-license-required' : 'commercial-ok',
            attribution_required: false, ai_training_allowed: false },
        price: null, version: 1
    };
}

export async function buildStub(dir, port) {
    await rm(dir, { recursive: true, force: true });
    const base = `http://127.0.0.1:${port}/assets/`;
    const files = new Map();
    const put = async (rel, buffer) => { const f = path.join(dir, 'www', rel); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, buffer); files.set(rel, f); return buffer; };
    const items = [];
    for (const asset of [...PAID, FREE, OTHER]) {
        const previewFile = path.join(dir, 'tmp', `${asset.id}.png`);
        await mkdir(path.dirname(previewFile), { recursive: true });
        png(asset.color, previewFile);
        await put(`assets/overlay/${asset.id}/v1/preview.png`, await readFile(previewFile));
    }
    for (const asset of PAID) {
        items.push({ id: asset.id, category: 'overlay', title: asset.title, tags: ['telop', 'fixture'],
            license: { spdx: 'LicenseRef-AKARI-Assets-v0' }, price: 1980, product_id: PACK, version: 1,
            preview: `overlay/${asset.id}/v1/preview.png`, provenance: { model: '', prompt: '', generated_at: '' } });
    }
    for (const asset of [FREE, OTHER]) {
        const telop = asset === FREE;
        const payload = { 'fragment.html': Buffer.from(fragment(asset)), 'meta.json': Buffer.from(`${JSON.stringify({ ...meta(asset, 0), tags: telop ? ['telop', 'fixture'] : ['frame', 'fixture'] }, null, 2)}\n`),
            'preview.png': await readFile(files.get(`assets/overlay/${asset.id}/v1/preview.png`)) };
        const list = [];
        for (const [name, buffer] of Object.entries(payload)) {
            if (name !== 'preview.png') await put(`assets/overlay/${asset.id}/v1/${name}`, buffer);
            list.push({ name, key: `overlay/${asset.id}/v1/${name}`, sha256: sha(buffer), bytes: buffer.length });
        }
        items.push({ id: asset.id, category: 'overlay', title: asset.title, tags: telop ? ['telop', 'fixture'] : ['frame', 'fixture'],
            license: { spdx: 'CC0-1.0' }, price: 0, version: 1, files: list, preview: `overlay/${asset.id}/v1/preview.png`,
            provenance: { model: '', prompt: '', generated_at: '' } });
    }
    const catalog = { schema: 'akari-assets-catalog/v0', version: '2026-09-28', base, items };
    const catalogFile = path.join(dir, 'assets-catalog.json');
    await writeFile(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`);
    // パックの zip（実物と同じ配置: <pack>-v1/{LICENSE.md,README.md,checksums.txt,assets/<id>/...}）
    const stage = path.join(dir, 'zip-stage', `${PACK}-v1`);
    const entries = { 'LICENSE.md': Buffer.from('fixture license\n'), 'README.md': Buffer.from('# fixture pack\n') };
    for (const asset of PAID) {
        entries[`assets/${asset.id}/fragment.html`] = Buffer.from(fragment(asset));
        entries[`assets/${asset.id}/meta.json`] = Buffer.from(`${JSON.stringify(meta(asset, 1980), null, 2)}\n`);
        entries[`assets/${asset.id}/preview.png`] = await readFile(files.get(`assets/overlay/${asset.id}/v1/preview.png`));
    }
    for (const [rel, buffer] of Object.entries(entries)) { const f = path.join(stage, rel); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, buffer); }
    await writeFile(path.join(stage, 'checksums.txt'), Object.entries(entries).map(([rel, b]) => `${sha(b)}  ${rel}`).join('\n') + '\n');
    const zipFile = path.join(dir, `${PACK}-v1.zip`);
    execFileSync('/usr/bin/zip', ['-qr', zipFile, `${PACK}-v1`], { cwd: path.dirname(stage) });
    return { catalogFile, zipFile, files };
}

export function serveStub({ port, zipFile, files, mode }) {
    const log = [];
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://x');
        log.push(`${req.method} ${url.pathname}`);
        if (url.pathname === '/api/store/v1/entitlements') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ entitlements: mode.value === 'owned' ? [{ product_id: PACK, kind: 'asset-pack', current_version: 1 }] : [] }));
            return;
        }
        if (url.pathname === `/api/store/v1/download/${PACK}`) {
            if (mode.value !== 'owned') { res.writeHead(403); res.end('{"error":"not_entitled"}'); return; }
            res.writeHead(200, { 'content-type': 'application/zip' }); res.end(await readFile(zipFile)); return;
        }
        const rel = url.pathname.replace(/^\//, '');
        if (files.has(rel)) { res.writeHead(200); res.end(await readFile(files.get(rel))); return; }
        res.writeHead(404); res.end('not found');
    });
    return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, log })));
}
