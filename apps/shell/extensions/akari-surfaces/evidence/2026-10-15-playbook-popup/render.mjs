import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { setLanguage } from '@akari-video/i18n';
import { StartProjectDialog } from '../../lib/browser/home/start-project-dialog.js';
import { startProjectCss } from '../../lib/browser/home/start-project-style.js';
import { homePanelCss } from '../../lib/browser/home/home-panels.js';
import { contractExample } from '../../test/playbook-contract-example.mjs';

const require = createRequire(import.meta.url);
const React = require('@theia/core/shared/react');
const { renderToStaticMarkup } = require('react-dom/server');

setLanguage('ja');
const dir = dirname(fileURLToPath(import.meta.url));
const entry = {
    dir: '/example/.akari/playbooks/kaisetsu-vertical-60s', source: 'local',
    playbook: contractExample
};
const base = {
    name: '新しいプロジェクト 2026-10-15', channel: 'my-channel', channels: ['my-channel'], channelMenu: false,
    playbooks: [entry], source: 'all', busy: false,
    tools: { platform: 'darwin', checkedAt: '2026-10-15T10:00:00+09:00', tools: [{ id: 'voicevox', tier: 'recommended', available: false }] },
    onName: () => {}, onChannelMenu: () => {}, onChannel: () => {}, onNewChannel: () => {},
    onStandalone: () => {}, onStep: () => {}, onCategory: () => {}, onSource: () => {},
    onSelect: () => {}, onBlank: () => {}, onRead: () => {}, onApply: () => {}, onClose: () => {}
};
for (const [file, props] of [
    ['01-start.html', { step: 'start' }],
    ['02-playbook-list.html', { step: 'playbooks' }],
    ['03-confirmation-sheet.html', { step: 'playbooks', selected: entry }],
    ['04-empty-list.html', { step: 'playbooks', playbooks: [] }]
]) {
    const body = renderToStaticMarkup(React.createElement(StartProjectDialog, { ...base, ...props }));
    const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>${file}</title><style>:root{color-scheme:dark;--theia-sideBar-background:#242833;--theia-editor-background:#1c202a;--theia-foreground:#f0f2f6;--theia-descriptionForeground:#aeb5c0;--theia-widget-border:#4c5260;--theia-focusBorder:#6cc8be;--theia-list-hoverBackground:#3b414e}body{margin:0;background:#141922;color:var(--theia-foreground);font:14px sans-serif}.akari-home-sheet-scrim{position:static;height:100vh}${homePanelCss}${startProjectCss}button{font:inherit;color:var(--theia-foreground)}.akari-start-actions button{background:var(--theia-editor-background);border:1px solid var(--theia-widget-border);border-radius:6px;padding:8px 10px}.akari-start-actions .theia-button.main{background:#0f6e6a;color:white;border-color:#0f6e6a}.akari-start-field input{font:inherit;color:var(--theia-foreground);background:var(--theia-editor-background);border:1px solid var(--theia-widget-border);border-radius:6px;padding:7px 9px}</style><div class="akari-home-sheet-scrim" data-akari-home-dialog="start"><div class="akari-home-sheet">${body}</div></div></html>`;
    await writeFile(join(dir, file), html);
}
