import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { setLanguage } from '@akari-video/i18n';
import { StartProjectDialog } from '../../lib/browser/home/start-project-dialog.js';
import { homePanelCss } from '../../lib/browser/home/home-panels.js';
import { contractExample } from '../../test/playbook-contract-example.mjs';

const require = createRequire(import.meta.url);
const React = require('@theia/core/shared/react');
const { renderToStaticMarkup } = require('react-dom/server');
const dir = dirname(fileURLToPath(import.meta.url));
setLanguage('ja');

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const name = Buffer.from(type);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([size, name, data, crc]);
}
function dummyFrame(seed) {
    const width = 320, height = 180;
    const raw = Buffer.alloc(height * (1 + width * 4));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const at = y * (1 + width * 4) + 1 + x * 4;
        const band = y > 38 && y < 124 && x > 34 && x < 286;
        raw[at] = band ? 238 : 20 + seed * 14;
        raw[at + 1] = band ? 245 : 91 + seed * 21;
        raw[at + 2] = band ? 239 : 100 + seed * 22;
        raw[at + 3] = 255;
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
    return `data:image/png;base64,${Buffer.concat([
        Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
    ]).toString('base64')}`;
}

const frames = [dummyFrame(0), dummyFrame(1), dummyFrame(2), dummyFrame(3)];
const entry = { dir: '/example/playbooks/kaisetsu-vertical-60s', source: 'local', coverUri: frames[0], frameUris: frames,
    playbook: { ...contractExample, name: '縦の解説 60 秒（見本付き）', example: true,
        preview: { cover: 'preview/cover.png', frames: frames.map((_, index) => `preview/${index + 1}.png`) } } };
const coverOnly = { dir: '/example/playbooks/product-cover', source: 'channel', coverUri: dummyFrame(4),
    playbook: { ...contractExample, id: 'product-cover', name: '商品紹介の作り方', category: 'product', preview: { cover: 'preview/cover.png' } } };
const noPreview = { dir: '/example/playbooks/previous-fixture', source: 'local', playbook: contractExample };
const base = {
    name: '新しいプロジェクト 2026-10-15', channel: 'my-channel', channels: ['my-channel', 'studio'], channelMenu: false,
    playbooks: [entry, coverOnly, noPreview], source: 'all', busy: false,
    tools: { platform: 'darwin', checkedAt: '2026-10-15T10:00:00+09:00', tools: [{ id: 'voicevox', tier: 'recommended', available: false }] },
    onName() {}, onChannelMenu() {}, onChannel() {}, onNewChannel() {}, onStandalone() {}, onStep() {}, onCategory() {},
    onSource() {}, onSelect() {}, onBlank() {}, onRead() {}, onApply() {}, onClose() {}
};
const states = [
    ['01-start', { step: 'start' }],
    ['02-channel-menu', { step: 'start', channelMenu: true }],
    ['03-standalone-note', { step: 'start', channel: undefined }],
    ['04-playbook-list', { step: 'playbooks' }],
    ['05-confirmation-sheet', { step: 'playbooks', selected: entry }],
    ['06-no-preview-detail', { step: 'playbooks', selected: noPreview }]
];
const themes = {
    light: '--theia-sideBar-background:#f0f2f3;--theia-editor-background:#f8fafb;--theia-editorWidget-background:#fff;--theia-foreground:#19232e;--theia-descriptionForeground:#53616f;--theia-widget-border:#c8d1d8;--theia-focusBorder:#0f6e6a;--theia-list-hoverBackground:#e6efef;--theia-textLink-foreground:#096965;--theia-button-background:#466c94;--theia-button-foreground:#fff;--akari-accent:#0f6e6a;color-scheme:light',
    dark: '--theia-sideBar-background:#171d24;--theia-editor-background:#202933;--theia-editorWidget-background:#2b3742;--theia-foreground:#f4f7f9;--theia-descriptionForeground:#b5c2cc;--theia-widget-border:#53616c;--theia-focusBorder:#70d5ce;--theia-list-hoverBackground:#394a55;--theia-textLink-foreground:#80ddd5;--theia-button-background:#4a6691;--theia-button-foreground:#fff;--akari-accent:#238e88;color-scheme:dark'
};
for (const [theme, variables] of Object.entries(themes)) for (const [name, state] of states) {
    const body = renderToStaticMarkup(React.createElement(StartProjectDialog, { ...base, ...state }));
    const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name} · ${theme}</title><style>:root{${variables}}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--theia-sideBar-background);color:var(--theia-foreground);font:13px system-ui,sans-serif}.akari-home-sheet-scrim{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px}${homePanelCss}.akari-home-sheet{min-height:230px}button,input{font:inherit}</style><div class="akari-home-sheet-scrim" data-akari-home-dialog="start"><div class="akari-home-sheet">${body}</div></div></html>`;
    await writeFile(join(dir, `${name}-${theme}.html`), html);
}
