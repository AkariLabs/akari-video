// 不具合メモ 第6項 — シーク操作直後の表示が古いことがある。
//
// 観測: 自動検証で UI の時刻表示は変わったのに、450ms 待ちでは以前の映像・ロゴを撮影して
// しまう場合があった。1.6 秒待つと対象位置の映像が表示された。メモにも書かれているとおり、
// この待ち時間は今回の検査用の値であって「全環境でのシーク完了保証値」ではない。
//
// 原因: seek() は要求を投げた時点で返り（scrub へ requestScrub するだけ）、実際の描画は
// renderFrame の非同期完了を待たない。UI 時刻は即更新されるので、外から見ると「時刻は動いたが
// canvas は前の画のまま」という区間が存在し、その長さを外から知る手段が無かった。
//
// 対処は待ち時間を伸ばすことではなく、**要求時刻と描画完了時刻を分けて観測できるようにする**
// こと（メモの改善候補どおり）。requestedFrame / presentedFrame を分けて持ち、
// waitForPresentation で提示まで待てるようにした。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const clientPath = fileURLToPath(new URL('../src/frame-engine-client.ts', import.meta.url));
const source = readFileSync(clientPath, 'utf8');

/**
 * 実装本体（presentationPending / waitForPresentation と提示記録の組み立て）を実ソースから
 * 取り出して動かす。スタブを書くと「実装と同じことを主張しているつもりのテスト」になるため、
 * メソッド本体はソースから切り出して使う。
 */
function loadPresentationHarness() {
    const slice = (start, end) => {
        const from = source.indexOf(start);
        assert.ok(from >= 0, `見つからない: ${start}`);
        const to = source.indexOf(end, from + start.length);
        assert.ok(to > from, `終端が見つからない: ${end}`);
        return source.slice(from, to);
    };
    const pendingBody = slice('  presentationPending(): boolean {', '\n  }');
    const waitBody = slice('  async waitForPresentation(timeoutMs = 10_000)', '\n  }\n\n  renderPlayback');

    // TypeScript の型注記だけを落として関数本体を取り出す（実行に型は不要）。
    const stripTypes = (text) => text
        .replace(/: Promise<FramePresentedRecord>/gu, '')
        .replace(/: boolean/gu, '')
        .replace(/: FramePresentedRecord \| null/gu, '')
        .replace(/new Promise<void>/gu, 'new Promise')
        .replace(/\(\): void =>/gu, '() =>')
        .replace(/let timer: ReturnType<typeof setTimeout> \| null = null;/u, 'let timer = null;');

    const factory = new Function(`
        const self = {
            requestedFrame: null,
            presentedFrame: null,
            lastPresentedRecord: null,
            presentedWaiters: new Set(),
            ${stripTypes(pendingBody).replace(/^  presentationPending\(\)\s*\{/u, 'presentationPending() {')}
            },
            ${stripTypes(waitBody).replace(/^  async waitForPresentation\(timeoutMs = 10_000\)\s*\{/u, 'async waitForPresentation(timeoutMs = 10000) {')}
            },
            // renderFrame の提示記録部分と同じ組み立て（要求と提示を分けて持ち待ち手を起こす）。
            present(frame, { reason = 'seek', requestedAtMs = 0, presentedAtMs = 1 } = {}) {
                this.presentedFrame = frame;
                this.lastPresentedRecord = {
                    seq: (this.lastPresentedRecord?.seq ?? 0) + 1,
                    reason,
                    requestedFrame: this.requestedFrame,
                    presentedFrame: frame,
                    presentedSec: frame / 30,
                    requestedAtMs,
                    presentedAtMs,
                    elapsedMs: presentedAtMs - requestedAtMs,
                };
                for (const waiter of [...this.presentedWaiters]) waiter();
            },
            request(frame) { this.requestedFrame = frame; },
        };
        return self;
    `);
    return factory();
}

test('要求を出した直後は「提示待ち」になる（時刻だけ動いて canvas が古い区間）', () => {
    const harness = loadPresentationHarness();
    assert.equal(harness.presentationPending(), false, '要求前は待ちではない');
    harness.request(3300);
    assert.equal(harness.presentationPending(), true, '要求済み・未提示は待ち');
    harness.present(3300);
    assert.equal(harness.presentationPending(), false, '同じコマが提示されたら待ちは解ける');
});

test('別のコマが提示されても、要求したコマでなければ待ちは解けない', () => {
    const harness = loadPresentationHarness();
    harness.request(3300);
    harness.present(120, { reason: 'playback' });
    assert.equal(harness.presentationPending(), true);
    harness.present(3300);
    assert.equal(harness.presentationPending(), false);
});

test('waitForPresentation は提示で解決し、要求時刻と描画完了時刻を分けて返す', async () => {
    const harness = loadPresentationHarness();
    harness.request(3300);
    const waiting = harness.waitForPresentation(5000);
    // 非同期に提示する（seek 直後の実際の順序）。
    setTimeout(() => harness.present(3300, { requestedAtMs: 100, presentedAtMs: 1700 }), 5);
    const record = await waiting;
    assert.equal(record.requestedFrame, 3300);
    assert.equal(record.presentedFrame, 3300);
    assert.equal(record.requestedAtMs, 100);
    assert.equal(record.presentedAtMs, 1700);
    // 第6項の観測（450ms では足りず 1.6 秒で写った）がそのまま数値で出る。
    assert.equal(record.elapsedMs, 1600);
});

test('既に提示済みなら waitForPresentation は即解決する', async () => {
    const harness = loadPresentationHarness();
    harness.request(10);
    harness.present(10);
    const record = await harness.waitForPresentation(5000);
    assert.equal(record.presentedFrame, 10);
});

test('シークを連打して要求が進んだ場合は、最後の要求が提示されるまで待ち直す', async () => {
    const harness = loadPresentationHarness();
    harness.request(100);
    const waiting = harness.waitForPresentation(5000);
    setTimeout(() => {
        harness.present(100);        // 途中の要求が提示される
        harness.request(200);        // が、すでに次の要求が出ている
        setTimeout(() => harness.present(200), 5);
    }, 5);
    const record = await waiting;
    assert.equal(record.presentedFrame, 200, '最後の要求の提示で解決する');
});

test('提示されないまま timeout を過ぎたら reject する（黙って古い画を撮らせない）', async () => {
    const harness = loadPresentationHarness();
    harness.request(3300);
    await assert.rejects(
        () => harness.waitForPresentation(20),
        /frame not presented within 20ms/u,
        '待ちが足りなかったのか描画が止まったのかを呼び出し側が区別できるようにする'
    );
});

test('seek は要求フレームを記録し、提示待ちの印を立てる', () => {
    // 実ソースの配線を固定する（再発防止）。
    assert.match(source, /this\.requestedFrame = frameNumber;[\s\S]{0,400}?this\.scrub\.requestScrub\(frameNumber\);/u);
    assert.match(source, /this\.ui\.root\.dataset\.framePresentationPending = "true";/u);
    // renderFrame からは presentationPending() を呼ばず同じ条件を直接書く（render-state /
    // boundary-metrics のテストが renderFrame をソースから切り出して stub 上で走らせる契約なので、
    // ここから新しいメソッドを呼ぶと stub の接触面が増える）。意味は presentationPending() と同一。
    assert.match(
        source,
        /if \(this\.requestedFrame === null \|\| this\.requestedFrame === this\.presentedFrame\) \{\s*this\.ui\.root\.dataset\.framePresentationPending = "false";/u
    );
    // 初期値が false であること。
    assert.match(source, /root\.dataset\.framePresentationPending = 'false';/u);
});

test('提示記録は renderFrame の完了時に組み立てられ、待ち手を起こす', () => {
    const renderFrame = source.slice(source.indexOf('private async renderFrame('));
    assert.match(renderFrame, /this\.presentedFrame = Math\.round\(this\.lastPresentedSec \* this\.fps\);/u);
    assert.match(renderFrame, /this\.lastPresentedRecord = \{[\s\S]*?requestedAtMs: requestedAt,[\s\S]*?presentedAtMs: presented,/u);
    assert.match(renderFrame, /for \(const waiter of \[\.\.\.this\.presentedWaiters\]\) waiter\(\);/u);
});

test('公開インターフェースに 3 つの観測口がある（QA が固定待ちを置かずに済む）', () => {
    const contract = source.slice(source.indexOf('export async function createFrameEnginePreview'));
    for (const name of ['presentationPending', 'lastPresented', 'waitForPresentation']) {
        assert.match(contract, new RegExp(`${name}`, 'u'), name);
    }
    // rebuild で runtime が差し替わるので、そのつど現行 runtime へ委譲していること。
    assert.match(contract, /presentationPending: \(\) => runtime\.presentationPending\(\)/u);
    assert.match(contract, /lastPresented: \(\) => runtime\.lastPresented\(\)/u);
    assert.match(contract, /waitForPresentation: timeoutMs => runtime\.waitForPresentation\(timeoutMs\)/u);
});
