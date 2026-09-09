import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { akariMenuRows } = require('../lib/common/menu-rows.js');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('ひらく contains exactly the nine ordered rows', () => {
    assert.deepEqual(akariMenuRows(), [
        { id: 'akari.partner.open', label: 'パートナー', icon: 'codicon codicon-add' },
        { id: 'akari.daihon.open', label: '台本', icon: 'codicon codicon-list-selection' },
        { id: 'akari.cuts.open', label: 'カット候補', icon: 'codicon codicon-checklist' },
        { id: 'akari.review.open', label: '注釈', icon: 'codicon codicon-comment-discussion' },
        { id: 'akari.annotations.open', label: 'タイムライン（下パネル）', icon: 'codicon codicon-comment' },
        { id: 'akari.menu.openOverview', label: 'ホーム', icon: 'codicon codicon-home' },
        { id: 'akari.home.openFirstRunSetup', label: 'セットアップ', icon: 'codicon codicon-tools' },
        { id: 'akari.home.openProjectLauncher', label: 'プロジェクト・ランチャー', icon: 'codicon codicon-layout' },
        { id: 'akari.project.showChanges', label: '変更を見る', icon: 'codicon codicon-diff' }
    ]);
});

const dockTabs = [
    {
        widget: '../../akari-partner/src/browser/akari-partner-widget.tsx',
        commands: '../../akari-partner/src/browser/akari-partner-command-contribution.ts',
        command: /OPEN\s*:\s*\{\s*id:\s*'([^']+)'/,
        prefix: true
    },
    {
        widget: '../../akari-transcript/src/browser/daihon/akari-daihon-widget.ts',
        commands: '../../akari-transcript/src/browser/akari-transcript-commands.ts',
        command: /OPEN_AKARI_DAIHON\s*:\s*Command\s*=\s*\{\s*id:\s*'([^']+)'/
    },
    {
        widget: '../../akari-transcript/src/browser/daihon/akari-cuts-widget.ts',
        commands: '../../akari-transcript/src/browser/daihon/akari-daihon-contribution.ts',
        command: /OPEN_AKARI_CUTS\s*:\s*Command\s*=\s*\{\s*id:\s*'([^']+)'/,
        prefix: true
    },
    {
        widget: '../../akari-annotations/src/browser/akari-review-panel-widget.ts',
        commands: '../../akari-annotations/src/browser/akari-annotations-commands.ts',
        command: /OPEN_AKARI_REVIEW_PANEL\s*:\s*Command\s*=\s*\{\s*id:\s*'([^']+)'/
    }
];

for (const tab of dockTabs) {
    test(`menu command, label and icon mirror ${tab.widget}`, () => {
        const command = read(tab.commands).match(tab.command);
        assert.ok(command, `command declaration in ${tab.commands}`);
        const row = akariMenuRows().find(candidate => candidate.id === command[1]);
        assert.ok(row, `menu contains ${command[1]}`);
        const widget = read(tab.widget);
        const label = widget.match(/this\.title\.label\s*=\s*'([^']+)'/);
        const icon = widget.match(/this\.title\.iconClass\s*=\s*'([^']+)'/);
        assert.ok(label, 'literal tab label');
        assert.ok(icon, 'literal tab icon');
        // パートナーはタブ側に「を追加」、カットはメニュー側に「候補」が付くため、
        // この 2 タブだけはどちらかが他方の接頭辞でもよい。台本・注釈は完全一致。
        if (tab.prefix) {
            assert.ok(row.label.startsWith(label[1]) || label[1].startsWith(row.label));
        } else {
            assert.equal(row.label, label[1]);
        }
        assert.equal(row.icon, icon[1]);
    });
}

test('widget maps the pure rows, preserves the home route and appends dynamic preview', () => {
    const widget = read('../src/browser/akari-menu-widget.tsx');
    assert.match(widget, /import\s*\{\s*akariMenuRows\s*\}\s*from\s*'\.\.\/common\/menu-rows'/);
    const source = ts.createSourceFile('widget.tsx', widget, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariMenuWidget');
    const getter = declaration?.members.find(node => ts.isGetAccessor(node) && node.name.getText(source) === 'actions');
    assert.ok(getter?.body, 'actions getter');
    const actions = getter.body.getText(source);
    assert.match(actions, /akariMenuRows\(\)\.map\(/);
    assert.match(actions, /row\.id === 'akari\.menu\.openOverview'\s*\? void this\.openOverview\(\)\s*:\s*this\.runCommand\(row\.id\)/);
    assert.match(actions, /this\.browserPreviewAction\(\)\s*\];/);
    assert.doesNotMatch(actions, /\b(?:id|label|icon)\s*:/, 'no duplicated row definitions');
    for (const row of akariMenuRows()) {
        if (row.id !== 'akari.menu.openOverview') {
            assert.ok(!widget.includes(row.id), `${row.id} belongs in menu-rows only`);
        }
    }
    assert.ok(!widget.includes('akari.transcript.open'));
});

test('menu-rows is independent of DOM, Theia and React', () => {
    const source = read('../src/common/menu-rows.ts');
    assert.doesNotMatch(source, /\b(?:import|require|document|window|React)\b/);
});
