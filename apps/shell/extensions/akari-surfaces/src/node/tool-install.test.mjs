import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import test from 'node:test';
import {
    akariToolsBinDir,
    akariToolsModelsDir,
    installTool,
    OFFICIAL_SOURCES,
    WHISPER_MODEL_FILENAME
} from '../../lib/node/tool-install.js';

const NOOP_ASYNC = async () => undefined;

function fakeContext(overrides = {}) {
    return {
        platform: 'darwin',
        env: { PATH: '/usr/bin' },
        homeDir: '/Users/fixture',
        pathExists: async () => false,
        ensureDir: NOOP_ASYNC,
        makeExecutable: NOOP_ASYNC,
        openPath: NOOP_ASYNC,
        writeFile: NOOP_ASYNC,
        ...overrides
    };
}

function okResult(stdout = '') {
    return { ok: true, stdout, stderr: '' };
}

function failResult(stderr = 'boom') {
    return { ok: false, stdout: '', stderr };
}

const FAKE_MODEL_BYTES = Buffer.from('fake-whisper-model-bytes-for-test');
const FAKE_MODEL_SHA256 = createHash('sha256').update(FAKE_MODEL_BYTES).digest('hex');

function fakeModelArrayBuffer(bytes = FAKE_MODEL_BYTES) {
    return Uint8Array.from(bytes).buffer;
}

// --- brew あり（macOS） -----------------------------------------------------

test('brew あり: formula 道具（ffmpeg）は brew install で導入され installed を返す', async () => {
    const calls = [];
    const result = await installTool('ffmpeg', fakeContext({
        runCommand: async (command, args) => {
            calls.push({ command, args });
            if (command === 'brew' && args[0] === '--version') {
                return okResult('Homebrew 4.0');
            }
            return okResult();
        }
    }));
    assert.equal(result.outcome, 'installed');
    assert.equal(result.id, 'ffmpeg');
    assert.ok(calls.some(c => c.command === 'brew' && c.args.join(' ') === 'install ffmpeg'));
});

test('brew あり: cask 道具（chrome）は --cask で導入される', async () => {
    const calls = [];
    const result = await installTool('chrome', fakeContext({
        runCommand: async (command, args) => {
            calls.push({ command, args });
            if (command === 'brew' && args[0] === '--version') {
                return okResult();
            }
            return okResult();
        }
    }));
    assert.equal(result.outcome, 'installed');
    assert.ok(calls.some(c => c.command === 'brew' && c.args.join(' ') === 'install --cask google-chrome'));
});

test('brew あり: brew install が失敗すると failed + 再試行できる平易な1行を返す', async () => {
    const result = await installTool('yt-dlp', fakeContext({
        runCommand: async (command, args) => {
            if (command === 'brew' && args[0] === '--version') {
                return okResult();
            }
            return failResult('network error');
        }
    }));
    assert.equal(result.outcome, 'failed');
    assert.match(result.message, /もう一度|再試行/);
});

test('brew は PATH 上で見つからなくても固定パスで検出される', async () => {
    const calls = [];
    const result = await installTool('ffmpeg', fakeContext({
        runCommand: async (command, args) => {
            calls.push({ command, args });
            if (command === 'brew' && args[0] === '--version') {
                return failResult();
            }
            return okResult();
        },
        pathExists: async path => path === '/opt/homebrew/bin/brew'
    }));
    assert.equal(result.outcome, 'installed');
    assert.ok(calls.some(c => c.command === '/opt/homebrew/bin/brew'));
});

// --- xcode-clt は brew 有無に関わらず常に Apple の GUI インストーラー -------

test('xcode-clt は brew の有無に関わらず external-installer-opened を返す', async () => {
    const withBrew = await installTool('xcode-clt', fakeContext({
        runCommand: async (command, args) => (command === 'xcode-select' && args[0] === '--install') ? okResult() : okResult()
    }));
    assert.equal(withBrew.outcome, 'external-installer-opened');
    assert.match(withBrew.message, /再チェック/);

    const withoutBrew = await installTool('xcode-clt', fakeContext({
        runCommand: async (command, args) => {
            if (command === 'brew') {
                return failResult();
            }
            return okResult();
        }
    }));
    assert.equal(withoutBrew.outcome, 'external-installer-opened');
});

// --- brew なし（macOS） ------------------------------------------------------

function noBrewRunCommand(overrides = {}) {
    return async (command, args) => {
        if (command === 'brew') {
            return failResult();
        }
        if (overrides[command]) {
            return overrides[command](args);
        }
        return okResult();
    };
}

test('brew なし: yt-dlp は公式 GitHub releases から ~/.akari/tools/bin へ DL + 実行権限付与される', async () => {
    const written = [];
    const chmodded = [];
    const ensured = [];
    const result = await installTool('yt-dlp', fakeContext({
        runCommand: noBrewRunCommand(),
        fetchImpl: async url => {
            assert.equal(url, OFFICIAL_SOURCES.ytDlpMacBinary);
            return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
        },
        ensureDir: async path => { ensured.push(path); },
        writeFile: async (path, data) => { written.push({ path, size: data.length }); },
        makeExecutable: async path => { chmodded.push(path); }
    }));
    assert.equal(result.outcome, 'installed');
    const expectedDir = akariToolsBinDir('/Users/fixture');
    assert.ok(ensured.includes(expectedDir));
    assert.equal(written[0].path, `${expectedDir}/yt-dlp`);
    assert.equal(chmodded[0], `${expectedDir}/yt-dlp`);
});

test('brew なし: yt-dlp のダウンロードが失敗すると failed + 再試行できる文言を返す（野良ミラーへは落ちない）', async () => {
    const result = await installTool('yt-dlp', fakeContext({
        runCommand: noBrewRunCommand(),
        fetchImpl: async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) })
    }));
    assert.equal(result.outcome, 'failed');
    assert.match(result.message, /もう一度/);
});

test('brew なし: chrome は公式 dmg を DL して open される', async () => {
    const opened = [];
    const result = await installTool('chrome', fakeContext({
        runCommand: noBrewRunCommand(),
        fetchImpl: async url => {
            assert.equal(url, OFFICIAL_SOURCES.chromeDmg);
            return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) };
        },
        openPath: async path => { opened.push(path); }
    }));
    assert.equal(result.outcome, 'external-installer-opened');
    assert.equal(opened.length, 1);
    assert.match(opened[0], /Chrome-installer\.dmg$/);
});

test('brew なし: VOICEVOX / Blender は公式サイトを開いて external-installer-opened を返す', async () => {
    const opened = [];
    const voicevox = await installTool('voicevox', fakeContext({
        runCommand: noBrewRunCommand(),
        openPath: async url => { opened.push(url); }
    }));
    assert.equal(voicevox.outcome, 'external-installer-opened');
    assert.equal(opened[0], OFFICIAL_SOURCES.voicevoxDownloadPage);

    const blender = await installTool('blender', fakeContext({
        runCommand: noBrewRunCommand(),
        openPath: async url => { opened.push(url); }
    }));
    assert.equal(blender.outcome, 'external-installer-opened');
    assert.equal(opened[1], OFFICIAL_SOURCES.blenderDownloadPage);
});

// --- 「Homebrew 準備フロー」廃案（task.md §7）: 同梱検知で解決する前提のため、 -------
// --- brew 不在時に ffmpeg/whisper を brew 経由で無理に入れようとはしない -------------

test('同梱も brew も無い開発機の端ケース: ffmpeg は同梱を促す1行の failed を返す（先に他の道具をではない）', async () => {
    const result = await installTool('ffmpeg', fakeContext({ runCommand: noBrewRunCommand() }));
    assert.equal(result.outcome, 'failed');
    assert.doesNotMatch(result.message, /先に.*入れてから再チェック/);
    assert.match(result.message, /同梱|最新版に更新/);
});

test('同梱も brew も無い開発機の端ケース: whisper はモデルが揃っていれば本体側で同梱案内 failed を返す', async () => {
    const result = await installTool('whisper', fakeContext({
        runCommand: noBrewRunCommand(),
        pathExists: async path => path.endsWith(WHISPER_MODEL_FILENAME) // モデルは既に取得済みの想定
    }));
    assert.equal(result.outcome, 'failed');
    assert.match(result.message, /同梱|最新版に更新/);
});

// --- Windows（win32・ベストエフォート） -------------------------------------

test('win32: winget マッピングがある道具（ffmpeg・yt-dlp/chrome 以外）は winget install で導入される', async () => {
    const calls = [];
    const result = await installTool('ffmpeg', fakeContext({
        platform: 'win32',
        runCommand: async (command, args) => {
            calls.push({ command, args });
            return okResult();
        }
    }));
    assert.equal(result.outcome, 'installed');
    assert.ok(calls.some(c => c.command === 'winget' && c.args.includes('Gyan.FFmpeg')));
});

test('win32: whisper はモデルが揃っていれば winget マッピングが無いため failed になる', async () => {
    const result = await installTool('whisper', fakeContext({
        platform: 'win32',
        pathExists: async path => path.endsWith(WHISPER_MODEL_FILENAME),
        runCommand: async () => okResult()
    }));
    assert.equal(result.outcome, 'failed');
});

test('win32: yt-dlp は公式 GitHub releases から yt-dlp.exe を .akari/tools/bin へ DL する（winget より先）', async () => {
    const written = [];
    let wingetCalled = false;
    const result = await installTool('yt-dlp', fakeContext({
        platform: 'win32',
        fetchImpl: async url => {
            assert.equal(url, OFFICIAL_SOURCES.ytDlpWindowsBinary);
            return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([9, 9]).buffer };
        },
        writeFile: async (path, data) => { written.push({ path, size: data.length }); },
        runCommand: async command => {
            if (command === 'winget') { wingetCalled = true; }
            return okResult();
        }
    }));
    assert.equal(wingetCalled, false);
    assert.equal(result.outcome, 'installed');
    assert.equal(written[0].path, `${akariToolsBinDir('/Users/fixture')}/yt-dlp.exe`);
});

test('win32: yt-dlp の DL が失敗したら winget にフォールバックする', async () => {
    let wingetCalled = false;
    const result = await installTool('yt-dlp', fakeContext({
        platform: 'win32',
        fetchImpl: async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) }),
        runCommand: async (command, args) => {
            if (command === 'winget') {
                wingetCalled = true;
                assert.ok(args.includes('yt-dlp.yt-dlp'));
            }
            return okResult();
        }
    }));
    assert.equal(wingetCalled, true);
    assert.equal(result.outcome, 'installed');
});

test('win32: Chrome は公式インストーラーを DL して開く（winget より先）', async () => {
    const opened = [];
    let wingetCalled = false;
    const result = await installTool('chrome', fakeContext({
        platform: 'win32',
        fetchImpl: async url => {
            assert.equal(url, OFFICIAL_SOURCES.chromeWindowsInstaller);
            return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) };
        },
        openPath: async path => { opened.push(path); },
        runCommand: async command => {
            if (command === 'winget') { wingetCalled = true; }
            return okResult();
        }
    }));
    assert.equal(wingetCalled, false);
    assert.equal(result.outcome, 'external-installer-opened');
    assert.match(opened[0], /Chrome-installer\.exe$/);
});

test('win32: Chrome の DL が失敗したら winget にフォールバックする', async () => {
    let wingetCalled = false;
    const result = await installTool('chrome', fakeContext({
        platform: 'win32',
        fetchImpl: async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) }),
        runCommand: async (command, args) => {
            if (command === 'winget') {
                wingetCalled = true;
                assert.ok(args.includes('Google.Chrome'));
            }
            return okResult();
        }
    }));
    assert.equal(wingetCalled, true);
    assert.equal(result.outcome, 'installed');
});

// --- 未対応 OS ---------------------------------------------------------------

test('macOS でも Windows でもない環境では failed + 平易な1行を返す', async () => {
    const result = await installTool('ffmpeg', fakeContext({ platform: 'linux', runCommand: async () => okResult() }));
    assert.equal(result.outcome, 'failed');
    assert.match(result.message, /対応していません/);
});

// --- 取得元は公式配布チャネルのみ ---------------------------------------------

test('OFFICIAL_SOURCES はすべて公式ドメイン（野良ミラー禁止）', () => {
    const officialHosts = ['github.com', 'dl.google.com', 'voicevox.hiroshiba.jp', 'www.blender.org', 'huggingface.co'];
    for (const url of Object.values(OFFICIAL_SOURCES)) {
        const host = new URL(url).host;
        assert.ok(officialHosts.includes(host), `unexpected host: ${host}`);
    }
});

// --- Whisper 認識モデル（アプリ管理の取得 — 裁定 E2 の本命） ------------------------

test('akariToolsModelsDir は ~/.akari/tools/models を返す', () => {
    assert.equal(akariToolsModelsDir('/Users/fixture'), '/Users/fixture/.akari/tools/models');
});

test('whisper モデル未取得: 本体側（brew）より先にモデルを DL する。sha256 一致で installed', async () => {
    const written = [];
    let brewCalled = false;
    const result = await installTool('whisper', fakeContext({
        whisperModelSha256: FAKE_MODEL_SHA256,
        runCommand: async command => {
            if (command === 'brew') { brewCalled = true; }
            return okResult();
        },
        fetchImpl: async url => {
            assert.equal(url, OFFICIAL_SOURCES.whisperModel);
            return {
                ok: true, status: 200,
                headers: { get: name => name.toLowerCase() === 'content-length' ? String(FAKE_MODEL_BYTES.length) : null },
                arrayBuffer: async () => fakeModelArrayBuffer()
            };
        },
        ensureDir: async () => undefined,
        writeFile: async (path, data) => { written.push({ path, data: Buffer.from(data) }); }
    }));
    assert.equal(brewCalled, false, 'モデル取得だけで完結し、本体側の brew 呼び出しには到達しない');
    assert.equal(result.outcome, 'installed');
    assert.equal(written.length, 1);
    assert.equal(written[0].path, join(akariToolsModelsDir('/Users/fixture'), WHISPER_MODEL_FILENAME));
    assert.ok(written[0].data.equals(FAKE_MODEL_BYTES));
});

test('whisper モデル未取得: sha256 不一致は failed になり、ファイルは一切書かれない', async () => {
    const written = [];
    const result = await installTool('whisper', fakeContext({
        whisperModelSha256: FAKE_MODEL_SHA256,
        fetchImpl: async () => ({
            ok: true, status: 200,
            headers: { get: () => null },
            arrayBuffer: async () => fakeModelArrayBuffer(Buffer.from('completely different bytes'))
        }),
        writeFile: async (path, data) => { written.push({ path, data }); }
    }));
    assert.equal(result.outcome, 'failed');
    assert.match(result.message, /検証/);
    assert.equal(written.length, 0);
});

test('whisper モデル未取得: content-length が無くても DL・検証・保存できる（不定形バー用の欠落ケース）', async () => {
    const result = await installTool('whisper', fakeContext({
        whisperModelSha256: FAKE_MODEL_SHA256,
        fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => fakeModelArrayBuffer() })
    }));
    assert.equal(result.outcome, 'installed');
});

test('whisper モデル未取得: DL 失敗は failed + 再試行できる文言を返す', async () => {
    const result = await installTool('whisper', fakeContext({
        fetchImpl: async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) })
    }));
    assert.equal(result.outcome, 'failed');
    assert.match(result.message, /もう一度/);
});

test('whisper モデル取得済み: 再取得せず本体側（brew）の分岐へ進む', async () => {
    let fetchCalled = false;
    const result = await installTool('whisper', fakeContext({
        pathExists: async path => path.endsWith(WHISPER_MODEL_FILENAME),
        fetchImpl: async () => { fetchCalled = true; return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }; },
        runCommand: async (command, args) => {
            if (command === 'brew' && args[0] === '--version') {
                return okResult('Homebrew 4.0');
            }
            return okResult();
        }
    }));
    assert.equal(fetchCalled, false);
    assert.equal(result.outcome, 'installed');
});

test('whisper モデル: AKARI_WHISPER_MODEL の実在パスがあれば取得済み扱いになる', async () => {
    let fetchCalled = false;
    const result = await installTool('whisper', fakeContext({
        env: { PATH: '/usr/bin', AKARI_WHISPER_MODEL: '/custom/model.bin' },
        pathExists: async path => path === '/custom/model.bin',
        fetchImpl: async () => { fetchCalled = true; return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }; },
        runCommand: async (command, args) => {
            if (command === 'brew' && args[0] === '--version') {
                return okResult('Homebrew 4.0');
            }
            return okResult();
        }
    }));
    assert.equal(fetchCalled, false);
    assert.equal(result.outcome, 'installed');
});

// --- 進捗バー（裁定 E1） ------------------------------------------------------

test('進捗: ダウンロード系は fetch ストリーミングでバイト進捗を逐次通知する', async () => {
    const events = [];
    const chunk1 = new Uint8Array([1, 2, 3]);
    const chunk2 = new Uint8Array([4, 5]);
    const result = await installTool('yt-dlp', fakeContext({
        onProgress: progress => events.push(progress),
        fetchImpl: async () => ({
            ok: true, status: 200,
            headers: { get: name => name.toLowerCase() === 'content-length' ? '5' : null },
            body: {
                getReader() {
                    let call = 0;
                    return {
                        read: async () => {
                            call += 1;
                            if (call === 1) {
                                return { done: false, value: chunk1 };
                            }
                            if (call === 2) {
                                return { done: false, value: chunk2 };
                            }
                            return { done: true, value: undefined };
                        }
                    };
                }
            }
        })
    }));
    assert.equal(result.outcome, 'installed');
    const downloadEvents = events.filter(e => e.kind === 'download');
    assert.ok(downloadEvents.length >= 2);
    assert.equal(downloadEvents[0].toolId, 'yt-dlp');
    assert.equal(downloadEvents[0].downloadedBytes, 3);
    assert.equal(downloadEvents[0].totalBytes, 5);
    assert.equal(downloadEvents[1].downloadedBytes, 5);
    assert.equal(downloadEvents[1].totalBytes, 5);
});

test('進捗: brew の stdout 断片は平易なフェーズ1行へ変換されて通知される', async () => {
    const events = [];
    const result = await installTool('ffmpeg', fakeContext({
        onProgress: progress => events.push(progress),
        runCommand: async (command, args, options) => {
            if (command === 'brew' && args[0] === '--version') {
                return okResult();
            }
            options?.onOutput?.('==> Fetching ffmpeg');
            options?.onOutput?.('==> Pouring ffmpeg--8.1.2.arm64_sequoia.bottle.tar.gz');
            return okResult();
        }
    }));
    assert.equal(result.outcome, 'installed');
    const commandEvents = events.filter(e => e.kind === 'command');
    assert.ok(commandEvents.some(e => e.phase === 'パッケージを取得しています…'));
    assert.ok(commandEvents.some(e => e.phase === '展開しています…'));
    assert.ok(commandEvents.every(e => e.toolId === 'ffmpeg'));
});
