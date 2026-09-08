// L1-b: process.platform を偽装した他 OS 観測 + whisper モデル override の突き合わせ。
// 実コード（コンパイル済み lib）だけを通す。実 HOME は読み書きしない（homeDir/HOME を tmp へ向ける）。
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
// evidence/first-run-unsupported/ からリポジトリ root を導く（machine 非依存）。
const WT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const SURF = `${WT}/apps/shell/extensions/akari-surfaces/lib`;
const { detectTools } = await import(`${SURF}/node/tool-detection.js`);
const { resolveWhisperModelPath, resolveWhisperModelOverride } = await import(`${SURF}/node/tool-install.js`);
const { deriveToolSelection, filterInstallableSelection } = await import(`${SURF}/common/tool-install-ui.js`);
const { deriveToolRowState } = await import(`${SURF}/common/tool-guidance.js`);

const scratch = await mkdtemp(join(tmpdir(), 'akari-l1-spoof-'));
const home = join(scratch, 'home');
await mkdir(home, { recursive: true });
const baseEnv = { ...process.env, HOME: home };
delete baseEnv.WHISPER_CPP_MODEL;
delete baseEnv.AKARI_WHISPER_MODEL;

const out = { scratch, observations: {} };

// --- 1) 偽装 linux（他 OS） -------------------------------------------------
const linux = await detectTools({ platform: 'linux', homeDir: home, env: baseEnv });
const linuxRow = linux.tools.find(t => t.id === 'speech-analyzer');
const linuxState = deriveToolRowState({ ...linuxRow });
const linuxSelection = deriveToolSelection(linux.tools);
const linuxN = filterInstallableSelection(linux.tools, linuxSelection).size;
const linuxNForced = filterInstallableSelection(linux.tools, new Set([...linuxSelection, 'speech-analyzer'])).size;
out.observations.linux = {
    row: linuxRow, label: linuxState.label, showCheckbox: linuxState.showCheckbox,
    selected: [...linuxSelection], installButtonN: linuxN, installButtonNWithManualCheck: linuxNForced,
    allRows: linux.tools.map(t => ({ id: t.id, ...deriveToolRowState({ ...t }) }))
};
assert.equal(linuxRow.unsupported, true);
assert.equal(linuxState.label, 'この OS では使えない');
assert.equal(linuxState.showCheckbox, false);
assert.equal(linuxSelection.has('speech-analyzer'), false);
assert.equal(linuxNForced, linuxN, '手動で選んでも n に入らない');

// --- 2) 偽装 win32 ----------------------------------------------------------
const win = await detectTools({ platform: 'win32', homeDir: home, env: baseEnv });
const winRow = win.tools.find(t => t.id === 'speech-analyzer');
out.observations.win32 = { row: winRow, ...deriveToolRowState({ ...winRow }) };
assert.equal(deriveToolRowState({ ...winRow }).label, 'この OS では使えない');

// --- 3) 実機 macOS ----------------------------------------------------------
// SpeechAnalyzer の --check は冷えていると 3〜5s かかり、tool-detection の
// runCommand の 5s timeout を踏むことがある（アプリ側の「再チェック」に相当する再試行）。
let mac, macRow, macAttempts = 0;
do {
    mac = await detectTools({ env: baseEnv, homeDir: home });
    macRow = mac.tools.find(t => t.id === 'speech-analyzer');
    macAttempts++;
} while (!macRow.available && macAttempts < 3);
const macState = deriveToolRowState({ ...macRow });
const macSelection = deriveToolSelection(mac.tools);
out.observations.darwin = {
    platform: mac.platform, detectAttempts: macAttempts, row: macRow, label: macState.label, showCheckbox: macState.showCheckbox,
    selected: [...macSelection], installButtonN: filterInstallableSelection(mac.tools, macSelection).size,
    allRows: mac.tools.map(t => ({ id: t.id, ...deriveToolRowState({ ...t }) }))
};
assert.equal(macRow.available, true);
assert.equal(macState.label, '使える');
assert.equal(macState.showCheckbox, false);

// --- 4) whisper モデル override（実 fs・一時ディレクトリの偽モデル） --------
const modelsDir = join(scratch, 'models');
await mkdir(modelsDir, { recursive: true });
const fakeModel = join(modelsDir, 'ggml-large-v3-turbo-q5_0.bin');
await writeFile(fakeModel, 'not a real model');
const legacyModel = join(modelsDir, 'ggml-legacy.bin');
await writeFile(legacyModel, 'legacy override');

async function pair(env) {
    const detected = (await detectTools({ env, homeDir: home })).tools.find(t => t.id === 'whisper');
    const installed = await resolveWhisperModelPath({ env, homeDir: home });
    return { detected: detected.model?.path, detectedAvailable: detected.model?.available, installed, needs: detected.needs };
}
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => { warnings.push(args.join(' ')); };
try {
    out.observations.whisperOverride = {
        both: await pair({ ...baseEnv, WHISPER_CPP_MODEL: fakeModel, AKARI_WHISPER_MODEL: legacyModel }),
        cppOnly: await pair({ ...baseEnv, WHISPER_CPP_MODEL: fakeModel }),
        legacyOnly: await pair({ ...baseEnv, AKARI_WHISPER_MODEL: legacyModel }),
        none: await pair(baseEnv),
        overridePriority: {
            both: resolveWhisperModelOverride({ WHISPER_CPP_MODEL: fakeModel, AKARI_WHISPER_MODEL: legacyModel }),
            cppOnly: resolveWhisperModelOverride({ WHISPER_CPP_MODEL: fakeModel }),
            legacyOnly: resolveWhisperModelOverride({ AKARI_WHISPER_MODEL: legacyModel }),
            none: resolveWhisperModelOverride({})
        }
    };
} finally { console.warn = originalWarn; }
out.observations.whisperOverride.warnings = warnings;

const w = out.observations.whisperOverride;
assert.equal(w.both.detected, fakeModel);
assert.equal(w.both.installed, fakeModel);
assert.equal(w.cppOnly.detected, fakeModel);
assert.equal(w.cppOnly.installed, fakeModel);
assert.equal(w.overridePriority.both, fakeModel);
assert.equal(w.overridePriority.legacyOnly, legacyModel);
assert.equal(w.legacyOnly.installed, legacyModel, '旧変数だけなら導入判定は後方互換で採用');
assert.ok(warnings.some(line => line.includes('AKARI_WHISPER_MODEL')), '旧変数採用時は警告ログ');
assert.equal(w.none.detected, undefined, '隔離 HOME にはモデルが無い');

console.log(JSON.stringify(out, null, 1));
await rm(scratch, { recursive: true, force: true });
console.error('SPOOF_OK');
