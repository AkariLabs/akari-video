import test, { after as afterI18nTest } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertCatalogCopy } from './i18n-source-copy.mjs';
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
afterI18nTest(() => setLanguage(undefined));


const readBrowserSource = path => readFileSync(new URL(`../src/browser/${path}`, import.meta.url), 'utf8');

test('新しいチャンネルのコマンドがホームの作成画面を開く', () => {
    const commands = readBrowserSource('akari-home-command-contribution.ts');
    assert.match(commands, /akari\.home\.newChannel/);
    assertCatalogCopy(commands, '新しいチャンネルを作る');
    assert.match(commands, /widget\.openNewChannelDialog\(\)/);
});

test('チャンネルパネルから作成画面へ直接進む', () => {
    const widget = readBrowserSource('channel/akari-channel-widget.tsx');
    const branch = widget.split("if (name === '__new__') {")[1]?.split('return;')[0];
    assert.ok(branch);
    assert.match(branch, /executeCommand\('akari\.home\.newChannel'\)/);
    assert.doesNotMatch(widget, /ホームの「チャンネル」から新しいチャンネルを作れます/);
});

test('チャンネルはフォルダとマニフェストだけで作る', () => {
    const home = readBrowserSource('akari-home-widget.tsx');
    const create = home.split('protected async createNewChannel(): Promise<void> {')[1]?.split('protected openChannelProject(')[0];
    assert.ok(create);
    assertCatalogCopy(home, 'チャンネルのフォルダ（channels/<名前>/）を作ります');
    assertCatalogCopy(home, 'を作りました');
    assert.match(create, /setViewingChannel\(channel\)/);
    assert.doesNotMatch(create, /adoptProject\(/);
    assert.match(home, /startNewProjectIn\(destination: URI\)/);
    assert.doesNotMatch(home, /new-video/);
});

test('一覧に単体プロジェクトの入口がある', () => {
    const list = readBrowserSource('home/project-list-view.tsx');
    assertCatalogCopy(list, 'チャンネルに入れずに作る…');
    assert.match(list, /onNewStandalone/);
});
