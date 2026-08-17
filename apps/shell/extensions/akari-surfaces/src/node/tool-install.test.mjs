import assert from 'node:assert/strict';
import test from 'node:test';
import { akariToolsBinDir, installTool, OFFICIAL_SOURCES } from '../../lib/node/tool-install.js';

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

test('brew なし: FFmpeg/Whisper は Homebrew 準備フックが無いと failed + 行き止まりにしない1行を返す（「先に他の道具を」ではない）', async () => {
    const ffmpeg = await installTool('ffmpeg', fakeContext({ runCommand: noBrewRunCommand() }));
    assert.equal(ffmpeg.outcome, 'failed');
    assert.doesNotMatch(ffmpeg.message, /先に.*入れてから再チェック/);
    assert.match(ffmpeg.message, /もう一度|再試行|インストール/);

    const whisper = await installTool('whisper', fakeContext({ runCommand: noBrewRunCommand() }));
    assert.equal(whisper.outcome, 'failed');
});

test('brew なし: Homebrew 準備フックが成功すれば続けて brew install まで進む', async () => {
    let brewNowAvailable = false;
    const result = await installTool('ffmpeg', fakeContext({
        runCommand: async (command, args) => {
            if (command === 'brew' && args[0] === '--version') {
                return brewNowAvailable ? okResult() : failResult();
            }
            if (command === 'brew') {
                return okResult();
            }
            return okResult();
        },
        runHomebrewPrepInEmbeddedTerminal: async () => {
            brewNowAvailable = true;
            return { ok: true };
        }
    }));
    assert.equal(result.outcome, 'installed');
});

test('brew なし: Homebrew 準備フックが失敗を返すと failed になる', async () => {
    const result = await installTool('whisper', fakeContext({
        runCommand: noBrewRunCommand(),
        runHomebrewPrepInEmbeddedTerminal: async () => ({ ok: false })
    }));
    assert.equal(result.outcome, 'failed');
});

// --- Windows（win32・ベストエフォート） -------------------------------------

test('win32: winget マッピングがある道具は winget install で導入される', async () => {
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

test('win32: winget マッピングが無い道具（whisper）は failed になる', async () => {
    const result = await installTool('whisper', fakeContext({ platform: 'win32', runCommand: async () => okResult() }));
    assert.equal(result.outcome, 'failed');
});

// --- 未対応 OS ---------------------------------------------------------------

test('macOS でも Windows でもない環境では failed + 平易な1行を返す', async () => {
    const result = await installTool('ffmpeg', fakeContext({ platform: 'linux', runCommand: async () => okResult() }));
    assert.equal(result.outcome, 'failed');
    assert.match(result.message, /対応していません/);
});

// --- 取得元は公式配布チャネルのみ ---------------------------------------------

test('OFFICIAL_SOURCES はすべて公式ドメイン（野良ミラー禁止）', () => {
    const officialHosts = ['raw.githubusercontent.com', 'github.com', 'dl.google.com', 'voicevox.hiroshiba.jp', 'www.blender.org'];
    for (const url of Object.values(OFFICIAL_SOURCES)) {
        const host = new URL(url).host;
        assert.ok(officialHosts.includes(host), `unexpected host: ${host}`);
    }
});
