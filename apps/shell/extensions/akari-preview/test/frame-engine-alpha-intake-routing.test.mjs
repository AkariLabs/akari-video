import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ALPHA_INTAKE_SOURCE_PATTERN, isAlphaIntakeSource } from '../lib/common/alpha-intake-routing.js';

// task/2026-09-02-shell-frame-engine-alpha-intake: open-handler は @theia/core の
// FrontendApplicationContribution で node:test から直接 import すると document is not defined になる
// （image-layer-source.test.mjs の既知の制約）ため、preview-alpha-matte-routing.test.mjs と同じ
// 正規表現ソース照合で配線を確認する。判定関数だけは lib から直接テストする。
const here = dirname(fileURLToPath(import.meta.url));
const read = relative => readFileSync(join(here, '..', 'src', ...relative), 'utf8');
const openHandler = read(['browser', 'akari-preview-open-handler.ts']);
const protocol = read(['common', 'akari-preview-protocol.ts']);
const service = read(['node', 'akari-preview-service.ts']);

test('alpha-intake candidates are exactly the .webm / .mov layer sources', () => {
    assert.equal(String(ALPHA_INTAKE_SOURCE_PATTERN), String(/\.(webm|mov)$/i));
    assert.equal(isAlphaIntakeSource('assets/matte/person-0.webm'), true);
    assert.equal(isAlphaIntakeSource('assets/matte/person-mosaic.MOV'), true);
    assert.equal(isAlphaIntakeSource('assets/pinp.mp4'), false);
    assert.equal(isAlphaIntakeSource('assets/logo.png'), false);
    assert.equal(isAlphaIntakeSource(undefined), false);
});

test('the RPC is declared and implemented with the workspace containment gate', () => {
    assert.match(protocol, /prepareAlphaIntake\(request: PrepareAlphaIntakeRequest\): Promise<PrepareAlphaIntakeResult>;/);
    assert.match(protocol, /\{ status: 'alpha'; colorUri: string; maskUri: string; maskFormat: string; skipped: boolean \}/);
    assert.match(service, /async prepareAlphaIntake\(request: PrepareAlphaIntakeRequest\): Promise<PrepareAlphaIntakeResult>/);
    assert.match(service, /if \(!this\.contains\(projectRoot, videoPath\)\) \{\s*return \{ status: 'unavailable', reason: 'outside-project' \};/);
    assert.match(service, /colorUri: pathToFileURL\(outcome\.colorPath\)\.toString\(\)/);
    assert.match(service, /maskUri: pathToFileURL\(outcome\.maskPath\)\.toString\(\)/);
});

test('video layers go through the intake only on the frame-engine face and carry src + mask', () => {
    const videoBranch = openHandler.match(
        /const isImage = isImageLayerSrc\(value\.src\);[\s\S]*?console\.warn\(`\[akari-preview\] \$\{label\} を無視しました（video レイヤーを配信できません）`, error\);/
    )?.[0];
    assert.ok(videoBranch, 'video layer branch is present');
    assert.match(videoBranch, /options\.frameEngineEnabled === true && !isImage && isAlphaIntakeSource\(value\.src\)/);
    assert.match(videoBranch, /this\.previewService\.prepareAlphaIntake\(\{/);
    assert.match(videoBranch, /if \(intake\?\.status === 'unavailable'\)[\s\S]*?proxyMissing: true, isImage: false \}\);\s*continue;/);
    assert.match(videoBranch, /if \(intake\?\.status === 'alpha'\)[\s\S]*?src: color\.url,\s*mask: mask\.url,\s*sourceUri: sourceUri\.toString\(\),/);
    // opaque / legacy 面は従来どおり declared proxy → fallback → 原本の選択を通る
    assert.match(videoBranch, /await this\.resolveStreamVideoUri\(sourceUri, \{ sourcesById \}\)/);
    assert.match(openHandler, /this\.loadPreviewModel\(identityUri, editSource, \{ frameEngineEnabled \}\)/);
    assert.match(openHandler, /options: \{ frameEngineEnabled\?: boolean \} = \{\}/);
});

test('the summary layer carries mask and the engine bootstrap registers it as a source', () => {
    const summaryLayer = openHandler.match(/interface EditSummaryLayer \{[\s\S]*?\n\}/)?.[0];
    assert.ok(summaryLayer);
    assert.match(summaryLayer, /\n    mask\?: string;/);
    assert.match(openHandler, /const maskUrl = layer && layer\.mask;\s*if \(typeof maskUrl === 'string' && maskUrl && !sourceUrls\.has\(maskUrl\)\) \{\s*sourceUrls\.set\(maskUrl, maskUrl\);/);
});
