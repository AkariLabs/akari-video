import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// 高性能 GPU 設定の schema・DI・設定変更通知が独立 contribution につながる回帰を守る。
// 起動は非同期で進み、既定オフでは照合せず、利用者の別の値を変更しないことを固定する。
// 次回起動から反映する旨と、未対応環境での通知もソース照合で保証する。
const moduleSource = await readFile(new URL('../src/browser/akari-preview-frontend-module.ts', import.meta.url), 'utf8');
const source = await readFile(new URL('../src/browser/akari-gpu-preference-contribution.ts', import.meta.url), 'utf8');
const start = source.slice(source.indexOf('    onStart()'), source.indexOf('    protected async reconcile('));
const reconcile = source.slice(source.indexOf('    protected async reconcile('), source.indexOf('    protected async apply('));
const apply = source.slice(source.indexOf('    protected async apply('), source.indexOf('    protected warnReason('));

test('schema defaults off and explains next launch; singleton is bound as a frontend contribution', () => {
    const schema = moduleSource.match(/'akari.preview.highPerformanceGpu': \{([^]*?)\n\s*\}/)?.[1];
    assert.ok(schema);
    assert.match(schema, /type: 'boolean'/);
    assert.match(schema, /default: false/);
    assert.match(schema, /description: '[^']*次回起動[^']*'/);
    assert.match(moduleSource, /import \{ AkariGpuPreferenceContribution \} from '.\/akari-gpu-preference-contribution';/);
    assert.match(moduleSource, /bind\(AkariGpuPreferenceContribution\)\.toSelf\(\)\.inSingletonScope\(\)/);
    assert.match(moduleSource, /bind\(FrontendApplicationContribution\)\.toService\(AkariGpuPreferenceContribution\)/);
});

test('only the GPU preference change applies via RPC and rejected RPCs are caught', () => {
    assert.match(source, /export const HIGH_PERFORMANCE_GPU_PREFERENCE_ID = 'akari.preview.highPerformanceGpu';/);
    assert.match(start, /onPreferenceChanged\(event => \{\s*if \(event.preferenceName === HIGH_PERFORMANCE_GPU_PREFERENCE_ID\) \{[^]*?void this\.apply\(Boolean\(newValue\)\)\.catch\(error => this\.warnRpcFailure\(error\)\)/);
    assert.match(start, /const newValue = 'newValue' in event \? event.newValue\s*: this.preferences.get<boolean>\(HIGH_PERFORMANCE_GPU_PREFERENCE_ID, false\)/);
    assert.match(apply, /await this\.service\.setHighPerformanceGpu\(enabled\)/);
    assert.match(source, /protected warnRpcFailure\(error: unknown\): void \{\s*this\.warnReason\(/);
});

test('startup reconciliation is nonblocking, quiet when off, unsupported or already 2, and preserves other values', () => {
    assert.match(start, /onStart\(\): void/);
    assert.match(start, /void this\.reconcile\(\)\.catch\(/);
    assert.doesNotMatch(start, /await|getGpuPreferenceState/);
    assert.match(reconcile, /get<boolean>\(HIGH_PERFORMANCE_GPU_PREFERENCE_ID, false\)/);
    assert.match(reconcile, /if \(enabled !== true\) return;\s*const state = await this\.service\.getGpuPreferenceState\(\)/);
    assert.match(reconcile, /if \(state.supported !== true \|\| state.current === 'high-performance'\) return;/);
    const other = reconcile.match(/if \(state.current === 'other'\) \{([^]*?)\n\s*\}/)?.[1];
    assert.ok(other);
    assert.match(other, /this\.messages\.warn\(/);
    assert.match(other, /return;/);
    assert.doesNotMatch(other, /setHighPerformanceGpu\(/);
    assert.match(reconcile, /state.current === 'unset' \|\| state.current === 'power-saving'[^]*?setHighPerformanceGpu\(true\)/);
    assert.match(reconcile, /if \(result.ok === false\) this\.warnReason\(result.reason\)/);
    assert.doesNotMatch(reconcile, /messages\.info/);
});

test('change notifications explain restart and failures include actionable reasons', () => {
    assert.ok(apply.includes("'高性能 GPU の設定を書き込みました。次回起動から反映されます。'"));
    assert.ok(apply.includes("'高性能 GPU の設定を元に戻しました。次回起動から反映されます。'"));
    assert.match(apply, /result.ok === false[^]*?warnReason\(result.reason\)[^]*?else if \(enabled\)/);
    assert.match(source, /reason.startsWith\('unsupported'\)[^]*?messages.warn\('この環境では GPU の割り当てを変更できません。'\)/);
    assert.match(source, /reason.startsWith\('user-preference'\)[^]*?Windows の「グラフィックスの設定」で変更してください。/);
    assert.ok(source.includes('高性能 GPU の設定を変更できませんでした: ${reason}'));
});
