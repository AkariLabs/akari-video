import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setLanguage } from '@akari-video/i18n';
import { channelChoices, showStandaloneExplanation, playbookCover, playbookFrames } from '../lib/browser/home/start-project-model.js';
import { StartProjectDialog } from '../lib/browser/home/start-project-dialog.js';
import { contractExample } from './playbook-contract-example.mjs';

const require = createRequire(import.meta.url);
const React = require('@theia/core/shared/react');
const { renderToStaticMarkup } = require('react-dom/server');

test('チャンネル、追加、単体の順に並び、単体だけ説明を出す', () => {
    assert.deepEqual(channelChoices(['A', 'B']), [
        { kind: 'channel', name: 'A' }, { kind: 'channel', name: 'B' }, { kind: 'new' }, { kind: 'standalone' }
    ]);
    assert.equal(showStandaloneExplanation('A'), false);
    assert.equal(showStandaloneExplanation(undefined), true);
});

test('表紙と帯を選び、preview/example の無い前回フィクスチャも一覧と詳細に描ける', () => {
    const entry = { dir: '/example', source: 'local', playbook: contractExample };
    assert.equal(playbookCover(entry), undefined);
    assert.deepEqual(playbookFrames(entry), []);
    const withFrames = { ...entry, frameUris: ['one', 'two', 'three', 'four', 'five', 'six'] };
    assert.equal(playbookCover(withFrames), 'one');
    assert.deepEqual(playbookFrames(withFrames), ['one', 'two', 'three', 'four', 'five']);
    assert.equal(playbookCover({ ...withFrames, coverUri: 'cover' }), 'cover');
    setLanguage('ja');
    try {
        const base = { name: '動画', channel: 'A', channels: ['A'], channelMenu: false, playbooks: [entry], source: 'all', busy: false,
            tools: { platform: 'darwin', checkedAt: '', tools: [] }, onName() {}, onChannelMenu() {}, onChannel() {}, onNewChannel() {},
            onStandalone() {}, onStep() {}, onCategory() {}, onSource() {}, onSelect() {}, onBlank() {}, onRead() {}, onApply() {}, onClose() {} };
        const list = renderToStaticMarkup(React.createElement(StartProjectDialog, { ...base, step: 'playbooks' }));
        assert.match(list, /akari-start-playbook-card/);
        assert.match(list, /縦の解説 60 秒/);
        const detail = renderToStaticMarkup(React.createElement(StartProjectDialog, { ...base, step: 'playbooks', selected: entry }));
        assert.match(detail, /見本はまだありません/);
        assert.match(detail, /data-akari-sheet-row="identity"/);
        const start = renderToStaticMarkup(React.createElement(StartProjectDialog, { ...base, step: 'start', channel: 'A', channelMenu: false }));
        assert.doesNotMatch(start, /チャンネルに入れずに作る/);
        assert.doesNotMatch(start, /data-akari-standalone-note/);
        const menu = renderToStaticMarkup(React.createElement(StartProjectDialog, { ...base, step: 'start', channel: undefined, channelMenu: true }));
        assert.ok(menu.indexOf('data-akari-channel-choice="channel"') < menu.indexOf('data-akari-channel-choice="new"'));
        assert.ok(menu.indexOf('data-akari-channel-choice="new"') < menu.indexOf('data-akari-channel-choice="standalone"'));
        assert.match(menu, /data-akari-standalone-note="true"/);
    } finally { setLanguage(undefined); }
});
