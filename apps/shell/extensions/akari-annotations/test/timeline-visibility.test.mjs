import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { isOutputPreviewWidgetId, storedTimelineHidden, shouldRevealTimeline, shouldShowTimelineGhost,
    TIMELINE_HIDDEN_STORAGE_KEY } from '../lib/common/timeline-visibility.js';

const contributionSource = ts.createSourceFile('contribution.ts', readFileSync(new URL(
    '../src/browser/akari-annotations-contribution.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const contribution = contributionSource.statements.find(node => ts.isClassDeclaration(node)
    && node.name?.text === 'AkariAnnotationsContribution');
const contributionMethod = name => contribution.members.find(member => member.name?.getText(contributionSource) === name)
    .getText(contributionSource);

test('利用者設定は true だけを隠す状態として復元する', () => {
    assert.equal(TIMELINE_HIDDEN_STORAGE_KEY, 'akari.timeline.hidden.v1');
    for (const value of [undefined, null, false, 'true', 1]) assert.equal(storedTimelineHidden(value), false);
    assert.equal(storedTimelineHidden(true), true);
});

test('出力プレビューは webview 接頭辞を含む実 ID で判定する', () => {
    assert.equal(isOutputPreviewWidgetId('plugin-webview:akari-output-preview-1ue46pv'), true);
    assert.equal(isOutputPreviewWidgetId('akari-output-preview-local'), true);
    assert.equal(isOutputPreviewWidgetId('plugin-webview:akari-preview-1ue46pv'), false);
    assert.equal(isOutputPreviewWidgetId(undefined), false);
});

test('タブバーの項目は出力プレビューだけに出て、状態で説明とアイコンが変わる', () => {
    const code = ts.transpileModule(`class Controller { ${contributionMethod('registerToolbarItems')} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    const React = { createElement: (type, props, ...children) => ({ type, props, children }) };
    const Controller = new Function('isOutputPreviewWidgetId', 'React', `${code}\nreturn Controller;`)(isOutputPreviewWidgetId, React);
    let item;
    const calls = [];
    const controller = Object.assign(new Controller(), {
        timelineHidden: false,
        timelineVisibilityChanged: { event: () => {} },
        commands: { executeCommand: id => calls.push(id) }
    });
    controller.registerToolbarItems({ registerItem: value => { item = value; } });
    assert.equal(item.isVisible({ id: 'plugin-webview:akari-output-preview-1ue46pv' }), true);
    assert.equal(item.isVisible({ id: 'plugin-webview:akari-preview-other' }), false);
    let button = item.render();
    assert.match(button.props.title, /タイムラインを隠す/);
    assert.equal(button.props['aria-pressed'], false);
    assert.match(button.children[0].props.className, /codicon-layout-panel$/);
    button.props.onClick({ preventDefault() {}, stopPropagation() {} });
    assert.deepEqual(calls, ['akari.timeline.toggleVisibility']);
    controller.timelineHidden = true;
    button = item.render();
    assert.match(button.props.title, /タイムラインを出す/);
    assert.equal(button.props['aria-pressed'], true);
    assert.match(button.children[0].props.className, /codicon-layout-panel-off$/);
});

test('自動表示とタイムラインのゴーストは隠す間は止める', () => {
    assert.equal(shouldRevealTimeline(true), false);
    assert.equal(shouldRevealTimeline(false), true);
    for (const attached of [true, false]) for (const visible of [true, false]) {
        assert.equal(shouldShowTimelineGhost(true, attached, visible), false);
    }
    assert.equal(shouldShowTimelineGhost(false, true, true), true);
    assert.equal(shouldShowTimelineGhost(false, false, true), false);
    assert.equal(shouldShowTimelineGhost(false, true, false), false);
});

test('表示されていないタイムラインもプレビューの再生位置を受け取れる', () => {
    const source = ts.createSourceFile('widget.ts', readFileSync(new URL(
        '../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const widget = source.statements.find(node => ts.isClassDeclaration(node)
        && node.name?.text === 'AkariAnnotationsWidget');
    const method = widget.members.find(member => member.name?.getText(source) === 'canHandlePlaybackTick');
    const code = ts.transpileModule(`class Timeline { ${method.getText(source)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    const Timeline = new Function(`${code}\nreturn Timeline;`)();
    const timeline = Object.assign(new Timeline(), {
        isAttached: false,
        location: { editUri: { toString: () => 'file:///project/edit.json' } },
        normalizeUri: value => value
    });
    assert.equal(timeline.canHandlePlaybackTick('file:///project/edit.json'), true);
    assert.equal(timeline.canHandlePlaybackTick('file:///other/edit.json'), false);
});

test('切り替えは利用者設定を書き、下パネルだけを畳んで戻す', async () => {
    const code = ts.transpileModule(`class Controller { ${contributionMethod('setTimelineHidden')} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    const Controller = new Function('TIMELINE_HIDDEN_STORAGE_KEY', `${code}\nreturn Controller;`)(TIMELINE_HIDDEN_STORAGE_KEY);
    const calls = [];
    const controller = Object.assign(new Controller(), {
        storage: { setData: async (...args) => calls.push(['save', ...args]) },
        shell: { collapsePanel: async area => calls.push(['collapse', area]),
            expandPanel: area => calls.push(['expand', area]),
            revealWidget: async id => calls.push(['reveal', id]) },
        syncTimelineVisibility: () => calls.push(['sync']),
        attach: async () => { calls.push(['attach']); return { id: 'timeline-1' }; }
    });
    await controller.setTimelineHidden(true);
    assert.deepEqual(calls, [['save', TIMELINE_HIDDEN_STORAGE_KEY, true], ['sync'], ['collapse', 'bottom']]);
    calls.length = 0;
    await controller.setTimelineHidden(false);
    assert.deepEqual(calls, [['save', TIMELINE_HIDDEN_STORAGE_KEY, false], ['sync'], ['attach'],
        ['expand', 'bottom'], ['reveal', 'timeline-1']]);
});

test('非表示時の自動アタッチは構成だけ行い、パネルを開かない', async () => {
    const code = ts.transpileModule(`class Controller { ${contributionMethod('attachPassively')} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    const Controller = new Function('shouldRevealTimeline', `${code}\nreturn Controller;`)(shouldRevealTimeline);
    const calls = [];
    const controller = Object.assign(new Controller(), {
        timelineHidden: true,
        locateAll: async () => [{ editUri: 'file:///project/edit.json' }],
        configureQuietTimeline: async location => calls.push(['configure', location.editUri]),
        attachAt: async () => calls.push(['attach']),
        shell: { revealWidget: async () => calls.push(['reveal']) }
    });
    await controller.attachPassively();
    assert.deepEqual(calls, [['configure', 'file:///project/edit.json']]);
});

test('表示中の別タイムラインは quiet 構成で奪わない', async () => {
    const code = ts.transpileModule(`class Controller { ${contributionMethod('configureQuietTimeline')} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    const Controller = new Function(`${code}\nreturn Controller;`)();
    const active = { isAttached: true, isDisposed: false, timelineLocation: 'active' };
    const quiet = { isAttached: false, isDisposed: false, timelineLocation: 'quiet', configure: async () => {} };
    const controller = Object.assign(new Controller(), {
        timelineHidden: false, timelineWidget: active, review: { location: 'active' },
        findTimelineWidget: () => quiet, trackTimelineWidget() {}, refreshLocationEditUri() {}
    });
    await controller.configureQuietTimeline({ editUri: 'file:///other/edit.json' });
    assert.equal(controller.timelineWidget, active);
    assert.equal(controller.review.location, 'active');
    controller.timelineHidden = true;
    await controller.configureQuietTimeline({ editUri: 'file:///other/edit.json' });
    assert.equal(controller.timelineWidget, quiet);
    assert.equal(controller.review.location, 'quiet');
});

// 2026-09-26 オーナー指摘「開いたプロジェクトは、デフォルトでタイムラインが見えている状態に」。
test('起動直後の既定表示は、隠していない かつ 復元で付いていないときだけ走る', async () => {
    const code = ts.transpileModule(`class Controller { ${contributionMethod('revealTimelineOnOpen')} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    const Controller = new Function(`${code}\nreturn Controller;`)();
    const build = overrides => {
        const calls = [];
        const controller = Object.assign(new Controller(), {
            timelineHidden: false, timelineWidgets: new Set(),
            attachPassively: async () => calls.push('attach')
        }, overrides);
        return { controller, calls };
    };

    const fresh = build({});
    await fresh.controller.revealTimelineOnOpen();
    assert.deepEqual(fresh.calls, ['attach'], '何も付いていなければ自動で出す');

    const hidden = build({ timelineHidden: true });
    await hidden.controller.revealTimelineOnOpen();
    assert.deepEqual(hidden.calls, [], '⌘⇧L で畳んだ意思は上書きしない');

    const restored = build({ timelineWidgets: new Set([{ isAttached: true, isDisposed: false }]) });
    await restored.controller.revealTimelineOnOpen();
    assert.deepEqual(restored.calls, [], 'レイアウト復元で既に出ているなら触らない');

    const closed = build({ timelineWidgets: new Set([{ isAttached: false, isDisposed: false }]) });
    await closed.controller.revealTimelineOnOpen();
    assert.deepEqual(closed.calls, ['attach'], '構成だけされた quiet な widget は「出ている」に数えない');
});

test('既定表示はレイアウト復元後に 1 回だけ呼ばれる', () => {
    const start = contributionMethod('onStart');
    assert.match(start, /reachedState\('initialized_layout'\)\.then\(\(\) => this\.revealTimelineOnOpen\(\)\)/);
});
