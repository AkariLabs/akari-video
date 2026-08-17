import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// docs/contract-2026-08-12-still-image-cut-source-v0.md のシェル対応（静止画 cut ソースの
// アプリ内プレビュー）の配線検査。webview スクリプトは open handler が文字列テンプレートで
// 生成するため tsc の型検査が届かない。ここでは compiled lib からテンプレート本体を抜き出し、
// (1) 生成 JS が構文として妥当なこと（vm.Script でパース）
// (2) 静止画セグメント機構（#preview-still / imageSources / 壁時計共用）が配線されていること
// を検査する。実 DOM での駆動（クリック選択・シーク挙動）は Electron 実機の領分。

const here = dirname(fileURLToPath(import.meta.url));
const compiled = readFileSync(
    join(here, '..', 'lib', 'browser', 'akari-preview-open-handler.js'),
    'utf8'
);

/**
 * compiled lib のメソッド定義から、最初のバッククォートで始まるテンプレートリテラル本体を
 * 取り出す。`${...}` 補間は brace 対応で読み飛ばして中立な `0` に置換し（補間式そのものは
 * tsc が検査済み）、テンプレートのエスケープ（\n \t \` \$ \\ など）は文字列リテラルと同じ
 * 規則で解釈する。返り値は「実行時に生成されるスクリプト文字列」と構文的に等価なテキスト。
 */
function extractTemplate(methodName) {
    // prepareHtml 内の呼び出し（`this.previewBootstrapScript()`）が定義より先に現れるため、
    // 後方から探してメソッド定義本体を取る。
    const methodAt = compiled.lastIndexOf(`${methodName}()`);
    assert.notEqual(methodAt, -1, `${methodName}() が compiled lib に見つからない`);
    const tick = compiled.indexOf('`', methodAt);
    assert.notEqual(tick, -1, `${methodName}() のテンプレートリテラルが見つからない`);
    let i = tick + 1;
    let out = '';
    while (i < compiled.length) {
        const ch = compiled[i];
        if (ch === '\\') {
            const next = compiled[i + 1];
            if (next === 'n') out += '\n';
            else if (next === 't') out += '\t';
            else if (next === 'r') out += '\r';
            else out += next;
            i += 2;
            continue;
        }
        if (ch === '`') break;
        if (ch === '$' && compiled[i + 1] === '{') {
            let braces = 1;
            i += 2;
            while (i < compiled.length && braces > 0) {
                const c = compiled[i];
                if (c === '\\') { i += 2; continue; }
                if (c === '{') braces += 1;
                else if (c === '}') braces -= 1;
                i += 1;
            }
            out += '0';
            continue;
        }
        out += ch;
        i += 1;
    }
    return out;
}

const bootstrap = extractTemplate('previewBootstrapScript');
const hostAdapter = extractTemplate('hostAdapterScript');

test('previewBootstrapScript の生成 JS が構文として妥当', () => {
    assert.ok(bootstrap.length > 10000, 'テンプレート抽出が短すぎる（抽出器の破綻を疑う）');
    assert.doesNotThrow(() => new vm.Script(bootstrap, { filename: 'preview-bootstrap.js' }));
});

test('hostAdapterScript の生成 JS が構文として妥当', () => {
    assert.ok(hostAdapter.length > 1000, 'テンプレート抽出が短すぎる（抽出器の破綻を疑う）');
    assert.doesNotThrow(() => new vm.Script(hostAdapter, { filename: 'host-adapter.js' }));
});

test('静止画セグメント機構が webview へ配線されている', () => {
    // ホストから受け取る表と判定ヘルパ
    assert.match(bootstrap, /const imageSources = initial\.imageSources \|\| \{\}/);
    assert.match(bootstrap, /const stillUrlForSegment = /);
    assert.match(bootstrap, /const isStillSegment = /);
    // #preview-still の表示制御（enterSegment の静止画分岐 + 一元管理側）
    assert.match(bootstrap, /getElementById\('preview-still'\)/);
    assert.match(bootstrap, /const stillUrl = stillUrlForSegment\(segment\)/);
    assert.match(bootstrap, /showStillImage\(stillUrl\)/);
    // クロックは gap セグメントと同じ壁時計原点を共用する
    const stillBranch = bootstrap.slice(bootstrap.indexOf('const stillUrl = stillUrlForSegment(segment)'));
    assert.match(stillBranch.slice(0, 800), /gapWallClockOriginMs = performance\.now\(\)/);
    // tick() の壁時計分岐が gap と静止画の両方を扱う
    assert.match(bootstrap, /segment\.kind === 'gap' \|\| segmentIsStill/);
    // 静止画セグメントのカット内経過秒はマスタークロック由来
    assert.match(bootstrap, /if \(isStillSegment\(segment\)\) return Math\.max\(0, outputTime - segment\.outStart\)/);
});

test('カット選択の当たり判定と select box が静止画でも生きている', () => {
    assert.match(bootstrap, /if \(candidate === stillImage\) return true;/);
    assert.match(bootstrap, /hit === video \|\| hit === stillImage/);
    assert.match(bootstrap, /stillImage\.style\.display === 'none'/);
});

test('prepareHtml が #preview-still と代表ソース静止画時の src 省略を持つ', () => {
    assert.match(compiled, /id="preview-still"/);
    // 代表ソースが静止画のとき <video> に src を与えない（loadedmetadata に依存しない初期化）
    assert.match(compiled, /primaryIsStillImage \? '' : ` src="/);
    // webview 初期ペイロードに静止画ソース表が載る
    assert.match(compiled, /imageSources: imageSourceUrlById/);
});
