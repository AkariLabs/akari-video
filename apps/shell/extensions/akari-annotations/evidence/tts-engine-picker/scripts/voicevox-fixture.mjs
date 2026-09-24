import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const ENGINE = path.join(path.parse(process.cwd()).root, 'Applications', 'VOICEVOX.app',
    'Contents', 'Resources', 'vv-engine', 'run');

function listenerPids(port) {
    const result = spawnSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    if (![0, 1].includes(result.status)) throw new Error('VOICEVOX ポートを確認できません');
    return result.stdout.trim().split(/\s+/u).filter(Boolean).map(Number);
}

function choosePort() {
    for (let port = 50021; port <= 50040; port++) if (!listenerPids(port).length) return port;
    throw new Error('VOICEVOX エンジン用ポートが空いていません');
}

function processRows() {
    const result = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid='], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('VOICEVOX プロセスを確認できません');
    return result.stdout.trim().split('\n').map(line => {
        const [pid, ppid, pgid] = line.trim().split(/\s+/u).map(Number);
        return { pid, ppid, pgid };
    }).filter(row => Number.isInteger(row.pid));
}

function ownedPids(pid) {
    const rows = processRows(), owned = new Set([pid]);
    for (const row of rows) if (row.pgid === pid) owned.add(row.pid);
    for (let changed = true; changed;) {
        changed = false;
        for (const row of rows) if (owned.has(row.ppid) && !owned.has(row.pid)) { owned.add(row.pid); changed = true; }
    }
    return owned;
}

async function stopOwnedEngine(child, port) {
    const pid = child?.pid;
    if (!pid) return { processGone: true, portClosedAtEnd: listenerPids(port).length === 0 };
    const owned = ownedPids(pid);
    const remaining = () => processRows().filter(row => owned.has(row.pid) || row.pgid === pid);
    const signal = name => {
        try { process.kill(-pid, name); } catch {}
        for (const ownedPid of [...owned].reverse()) try { process.kill(ownedPid, name); } catch {}
    };
    signal('SIGTERM');
    for (let i = 0; i < 50 && remaining().length; i++) await sleep(200);
    if (remaining().length) {
        signal('SIGKILL');
        for (let i = 0; i < 25 && remaining().length; i++) await sleep(200);
    }
    return { processGone: remaining().length === 0, portClosedAtEnd: listenerPids(port).length === 0 };
}

export async function makeVoicevoxFixture({ shell, home, akariHome, output }) {
    const port = choosePort(), endpoint = `http://127.0.0.1:${port}`;
    const dirs = {
        cache: path.join(home, 'xdg-cache'), config: path.join(home, 'xdg-config'),
        data: path.join(home, 'xdg-data'), temp: path.join(home, 'tmp')
    };
    await Promise.all([mkdir(home, { recursive: true }), ...Object.values(dirs).map(dir => mkdir(dir, { recursive: true }))]);
    const isolatedEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|TOKEN|SECRET|CREDENTIAL|API/i.test(name))), HOME: home, AKARI_HOME: akariHome,
        AKARI_CREDENTIALS_FILE: path.join(home, 'credentials.env'), XDG_CACHE_HOME: dirs.cache,
        XDG_CONFIG_HOME: dirs.config, XDG_DATA_HOME: dirs.data, TMPDIR: dirs.temp };
    delete isolatedEnv.FAL_KEY;
    delete isolatedEnv.FISH_AUDIO_API_KEY;
    delete isolatedEnv.GEMINI_API_KEY;
    const cli = path.resolve(shell, '../../packages/akari-launcher/bin/akari.mjs');
    const scriptResult = spawnSync(process.execPath, [cli, 'voice', 'scripts', '--json'], {
        encoding: 'utf8', env: { ...isolatedEnv, ELECTRON_RUN_AS_NODE: '1' }
    });
    if (scriptResult.status !== 0) throw new Error('akari voice scripts failed');
    const text = JSON.parse(scriptResult.stdout).scripts.find(item => item.id === 'quick-v1')?.text;
    if (!text) throw new Error('quick-v1 missing');

    const log = openSync(path.join(home, 'voicevox-engine.log'), 'a');
    const child = spawn(ENGINE, ['--host', '127.0.0.1', '--port', String(port)], {
        cwd: path.dirname(ENGINE), env: isolatedEnv, stdio: ['ignore', log, log], detached: true
    });
    closeSync(log);
    child.unref();
    let launchError;
    child.once('error', error => { launchError = error; });
    try {
        let ready = false;
        for (let i = 0; i < 240; i++) {
            if (launchError) throw launchError;
            try { ready = (await fetch(`${endpoint}/version`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
            if (ready) break;
            await sleep(500);
        }
        if (!ready) throw new Error('VOICEVOX エンジンが起動しません');
        const listeners = listenerPids(port), owned = ownedPids(child.pid);
        if (listeners.length !== 1 || !owned.has(listeners[0])) throw new Error('VOICEVOX ポートの PID が起動したエンジンと異なります');

        const queryResponse = await fetch(`${endpoint}/audio_query?text=${encodeURIComponent(text)}&speaker=1`, { method: 'POST' });
        if (!queryResponse.ok) throw new Error(`VOICEVOX audio_query ${queryResponse.status}`);
        const query = await queryResponse.json();
        query.speedScale = 0.92;
        query.volumeScale = 0.5;
        const synthesis = await fetch(`${endpoint}/synthesis?speaker=1`, { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query) });
        if (!synthesis.ok) throw new Error(`VOICEVOX synthesis ${synthesis.status}`);
        const buffer = Buffer.from(await synthesis.arrayBuffer());
        await writeFile(output, buffer);
        return { engine: 'headless', text, bytes: buffer.length, port, pid: child.pid,
            startedByScript: true, stop: () => stopOwnedEngine(child, port) };
    } catch (error) {
        await stopOwnedEngine(child, port);
        throw error;
    }
}
