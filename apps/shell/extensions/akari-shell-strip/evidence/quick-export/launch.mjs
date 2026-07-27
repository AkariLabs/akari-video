// export-button（evidence/export-button/README.md）と同じ手法の隔離 Electron
// 起動/終了ヘルパー: apps/shell を直接起動し、remote-debugging-port + 専用
// user-data-dir で他インスタンスと分離する。
//
// kill/孤児確認は「Electron main の PID から辿る子孫プロセス木」を正とする
// （実測で判明: plugin-host はコマンドラインに --user-data-dir を含まない
// ため、user-data-dir 文字列の pkill -f だけでは検出も終了もできず、
// Electron main 側を先に kill すると親を失って PPID=1 に孤児化して残り続けた。
// user-data-dir 文字列マッチは重複防御として併用する）。
import { spawn, execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';

const REPO = '<WORKTREE>';
const SHELL_APP = `${REPO}/apps/shell`;
const ELECTRON_BIN = `${SHELL_APP}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`;

export function launchElectron({ workspaceDir, cdpPort, userDataDir, logPath }) {
    const child = spawn(ELECTRON_BIN, [
        SHELL_APP,
        workspaceDir,
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${userDataDir}`,
        '--no-sandbox'
    ], {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let log = '';
    child.stdout.on('data', d => { log += d.toString(); });
    child.stderr.on('data', d => { log += d.toString(); });
    if (logPath) {
        process.on('exit', () => { try { writeFileSync(logPath, log); } catch { /* best effort */ } });
    }
    return child;
}

/** rootPid から辿れる子孫 PID を（rootPid 自身を含めて）全て集める。 */
function descendantPids(rootPid) {
    const all = [rootPid];
    let frontier = [rootPid];
    for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
        const next = [];
        for (const pid of frontier) {
            let out = '';
            try {
                out = execSync(`pgrep -P ${pid} || true`).toString();
            } catch {
                out = '';
            }
            for (const line of out.split('\n')) {
                const child = Number(line.trim());
                if (Number.isInteger(child) && child > 0 && !all.includes(child)) {
                    all.push(child);
                    next.push(child);
                }
            }
        }
        frontier = next;
    }
    return all;
}

/** rootPid（Electron main）の子孫プロセス木 + userDataDir 文字列マッチの両方を SIGKILL する。 */
export function killElectronTree(rootPid, userDataDir) {
    for (const pid of descendantPids(rootPid)) {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // 既に終了済みなら ESRCH — 無害。
        }
    }
    if (userDataDir) {
        try {
            execSync(`pkill -9 -f "${userDataDir}"`, { stdio: 'ignore' });
        } catch {
            // 対象プロセスが既に無い場合は pkill が非0を返すだけ（無害）。
        }
    }
}

function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * rootPid の子孫木が完全に消えたことを確認する（plugin-host のように
 * user-data-dir を引数に持たないプロセスも rootPid 起点の探索なら捕捉できる）。
 * 加えて userDataDir 文字列を含む取りこぼしが無いかも重複確認する。
 */
export async function assertNoOrphans(rootPid, userDataDir, attempts = 30) {
    for (let attempt = 0; attempt < attempts; attempt++) {
        killElectronTree(rootPid, userDataDir);
        await sleep(300);
        const remainingTree = descendantPids(rootPid).filter(pid => pid !== rootPid ? isAlive(pid) : isAlive(rootPid));
        let stringMatch = '';
        if (userDataDir) {
            try {
                stringMatch = execSync(`ps aux | grep -F "${userDataDir}" | grep -v grep || true`).toString();
            } catch {
                stringMatch = '';
            }
        }
        if (remainingTree.length === 0 && stringMatch.trim() === '') {
            return { ok: true };
        }
        await sleep(500);
    }
    const finalTree = descendantPids(rootPid).filter(isAlive);
    let finalStringMatch = '';
    if (userDataDir) {
        try {
            finalStringMatch = execSync(`ps aux | grep -F "${userDataDir}" | grep -v grep || true`).toString();
        } catch {
            finalStringMatch = '';
        }
    }
    return { ok: false, remainingTreePids: finalTree, remainingStringMatch: finalStringMatch };
}

export { sleep };
