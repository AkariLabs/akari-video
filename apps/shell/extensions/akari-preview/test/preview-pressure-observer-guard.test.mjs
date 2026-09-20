// 不具合メモ 第13項: WebAV 1.2.8（node_modules/@webav/internal-utils/src/log.ts）は
// `"PressureObserver" in globalThis` の存在確認だけで `.observe("cpu")` を呼び、Promise 拒否を
// 捕捉していない。Webview の権限ポリシーでは compute-pressure が許可されていないので
// NotAllowedError が未処理拒否として Console に出続け、本当のエラーを探しにくくしていた。
//
// node_modules は編集できないため、こちら側（バンドル読み込み前のページ初期化）で防ぐ。
// ここではガードが「存在確認を偽にする」ことと、削除できない環境でも「拒否しない」ことを見る。
// 権限（compute-pressure）を広げる変更が入っていないことも併せて確認する。

import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createPreviewPage,
    diagnosticsModule,
    injectedScript,
    prepareHtmlSource
} from './helpers/preview-diagnostics-page.mjs';

const guardScript = injectedScript('previewDiagnosticsGuardScript');

test('ガード前は WebAV と同じ呼び出しが未処理拒否になる（再現）', async () => {
    const page = createPreviewPage({ initial: { frameEngineEnabled: true } });
    const webav = page.runWebAvLogInit();
    assert.equal(webav.observeCalled, true, 'ガード前は observe("cpu") まで進む');
    await Promise.resolve();
    await Promise.resolve();
    assert.match(String(webav.settled()), /^rejected:/u, 'ガード前の拒否は捕捉されない');
});

test('ガードは PressureObserver のグローバルを外し、存在確認を偽にする', async () => {
    const page = createPreviewPage({ initial: { frameEngineEnabled: true } });
    page.run(guardScript);
    assert.equal(page.diag().pressureObserver, 'removed');
    const webav = page.runWebAvLogInit();
    assert.equal(webav.observeCalled, false, 'ガード後は observe("cpu") へ進まない');
    await Promise.resolve();
    assert.equal(webav.settled(), undefined, '拒否する Promise がそもそも作られない');
});

test('削除できない環境では拒否しない stub へ差し替える', async () => {
    const page = createPreviewPage({ pressureObserver: 'sealed', initial: { frameEngineEnabled: true } });
    page.run(guardScript);
    assert.equal(page.diag().pressureObserver, 'stubbed');
    const webav = page.runWebAvLogInit();
    assert.equal(webav.observeCalled, true, 'stub なので存在確認は真のまま');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(webav.settled(), 'resolved', 'stub の observe は拒否しない');
});

test('PressureObserver が無い環境では何もしない', () => {
    const page = createPreviewPage({ pressureObserver: 'none' });
    page.run(guardScript);
    assert.equal(page.diag().pressureObserver, 'absent');
});

test('ガードの結果は診断へ残り、ホストへも報告される', () => {
    const page = createPreviewPage({ initial: { frameEngineEnabled: true } });
    page.run(guardScript);
    const notes = page.diag().trace.events.filter(event => event.kind === 'note');
    assert.ok(
        notes.some(event => event.message.includes('compute-pressure ガード: removed')),
        `ガード結果の note が無い: ${JSON.stringify(notes)}`
    );
    page.attachHost();
    page.diag().mark('scripts-loaded');
    assert.ok(
        page.posted.some(message => message.pressureObserver === 'removed'),
        'ホストへの報告に compute-pressure ガードの結果が乗っていない'
    );
});

test('neutralizePressureObserver は純粋関数としても同じ結論を返す', () => {
    const { neutralizePressureObserver } = diagnosticsModule;
    assert.equal(neutralizePressureObserver({}), 'absent');
    const removable = { PressureObserver: class {} };
    assert.equal(neutralizePressureObserver(removable), 'removed');
    assert.equal('PressureObserver' in removable, false);
    const sealed = {};
    Object.defineProperty(sealed, 'PressureObserver', { value: class {}, configurable: false, writable: true });
    assert.equal(neutralizePressureObserver(sealed), 'stubbed');
    assert.equal(typeof new sealed.PressureObserver().observe().then, 'function');
});

test('ガードはどの外部スクリプトよりも先に、権限を広げずに入る', () => {
    const html = prepareHtmlSource();
    const guardAt = html.indexOf('this.previewDiagnosticsGuardScript()');
    assert.ok(guardAt > 0, 'prepareHtml がガードを注入していない');
    const cspAt = html.indexOf('Content-Security-Policy');
    assert.ok(cspAt > 0 && cspAt < guardAt, 'ガードは CSP の直後（head の先頭）に置く');
    for (const marker of [
        'this.externalScriptTag(assets.threeJavaScriptUrl)',
        'this.externalScriptTag(assets.runtimeJavaScriptUrl)',
        'this.externalScriptTag(assets.webviewKernelJavaScriptUrl)',
        'this.hostAdapterScript()',
        // frame-engine のバンドル（WebAV 同梱）の挿入位置。定義位置ではなく使用位置を見る。
        '${frameEngineScripts}<script>'
    ]) {
        const at = html.indexOf(marker);
        assert.ok(at > guardAt, `${marker} はガードより後に読まれる必要がある（実際: ${at} <= ${guardAt}）`);
    }
    // 第13項の禁止事項: エラーを消すために Webview の権限を広げてはいけない。
    // CSP 行と権限ポリシーに compute-pressure を足していないことを見る
    // （コメント中の言及は対象外なので、meta 行だけを切り出して検査する）。
    const cspLine = html.slice(cspAt, html.indexOf('\n', cspAt));
    assert.doesNotMatch(cspLine, /compute-pressure/u);
    assert.doesNotMatch(html, /Permissions-Policy/u);
    assert.doesNotMatch(html, /\ballow="/u);
});
