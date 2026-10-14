import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readHandlerSource } from './helpers/handler-source.mjs';

const source = readHandlerSource();
const bootstrapStart = source.indexOf('            void (async () => {\n                const fps = Number(engineSummary.output');

test('再生状態を読むタイマーは、宣言のあとで登録する', () => {
    assert.ok(bootstrapStart >= 0);
    const playing = source.indexOf('                let playing = false;', bootstrapStart);
    const position = source.indexOf('                let position = 0;', bootstrapStart);
    const interval = source.indexOf('                const audioPriorityInterval = setInterval(', bootstrapStart);
    assert.ok(playing > bootstrapStart && position > bootstrapStart && interval > bootstrapStart);
    assert.ok(interval > playing && interval > position,
        '宣言より前に登録すると、その間の初期化失敗で 10 秒ごとに ReferenceError が出る');
    assert.equal(source.split('const audioPriorityInterval = setInterval(').length, 2, '登録は 1 か所だけ');
});

test('初期化の失敗はタイマーを止め、止まった段と元の例外を初期化診断へ残す', () => {
    const begin = source.indexOf('            const initFailureCleanups = [];');
    const end = source.indexOf('            void (async () => {', begin);
    assert.ok(begin >= 0 && end > begin && end === bootstrapStart);
    assert.match(source, /\}\)\(\)\.catch\(failInitialization\);/u);
    assert.match(source, /initFailureCleanups\.push\(\(\) => clearInterval\(audioStatusTimer\)\);/u);
    assert.match(source,
        /initFailureCleanups\.push\(\(\) => \{\s*clearInterval\(audioPriorityInterval\);\s*clearTimeout\(audioPriorityTimer\);\s*\}\);/u);

    const run = ({ clock, diag = true }) => {
        const calls = { fail: [], shown: [], cleaned: [], logged: [] };
        const context = {
            window: { akari: clock ? { frameEngineClock: {} } : {},
                __akariPreviewDiag: diag ? { fail: (stage, detail) => calls.fail.push([stage, detail]) } : undefined },
            showError: (value, fatal) => calls.shown.push([value.message, fatal]),
            console: { warn: (...args) => calls.logged.push(args), error: (...args) => calls.logged.push(args) },
        };
        vm.runInNewContext(`${source.slice(begin, end)}
            initFailureCleanups.push(() => cleaned.push('status'));
            initFailureCleanups.push(() => { throw new Error('cleanup broke'); });
            initFailureCleanups.push(() => cleaned.push('priority'));
            failInitialization(reason);
            failInitialization(reason);`, { ...context, cleaned: calls.cleaned, reason: new TypeError('WebGL2 is unavailable') });
        return calls;
    };

    const early = run({ clock: false });
    // 後始末は 1 つが失敗しても残りを実行し、2 回目の呼び出しでは繰り返さない。
    assert.deepEqual(early.cleaned, ['status', 'priority']);
    assert.deepEqual(early.fail[0], ['media-supplied', 'Frame engine: TypeError: WebGL2 is unavailable']);
    assert.deepEqual(early.shown[0], ['WebGL2 is unavailable', true]);

    assert.equal(run({ clock: true }).fail[0][0], 'first-frame');
    // 診断の受け口が無いページでも、画面のエラー表示までは進む。
    assert.deepEqual(run({ clock: false, diag: false }).shown[0], ['WebGL2 is unavailable', true]);
});
