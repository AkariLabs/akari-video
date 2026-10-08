import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readBrowserSource = path => readFileSync(new URL(`../src/browser/${path}`, import.meta.url), 'utf8');

test('新しいチャンネルのコマンドがホームの作成画面を開く', () => {
    const commands = readBrowserSource('akari-home-command-contribution.ts');
    assert.match(commands, /akari\.home\.newChannel/);
    assert.match(commands, /新しいチャンネルを作る/);
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
    assert.match(home.replaceAll('&lt;', '<').replaceAll('&gt;', '>'), /チャンネルのフォルダ（channels\/<名前>\/）を作ります/);
    assert.match(home, /を作りました/);
    assert.match(create, /setViewingChannel\(channel\)/);
    assert.doesNotMatch(create, /adoptProject\(/);
    assert.match(home, /startNewProjectIn\(destination: URI\)/);
    assert.match(home, /new-video/);
});

test('一覧に単体プロジェクトの入口がある', () => {
    const list = readBrowserSource('home/project-list-view.tsx');
    assert.match(list, /チャンネルに入れずに作る…/);
    assert.match(list, /onNewStandalone/);
});
