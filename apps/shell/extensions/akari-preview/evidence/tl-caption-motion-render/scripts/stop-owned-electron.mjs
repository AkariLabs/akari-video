import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

function processInfo(pid) {
  try {
    const value = execFileSync('ps', ['-p', String(pid), '-o', 'ppid=,command='], { encoding: 'utf8' }).trim();
    const match = value.match(/^(\d+)\s+([\s\S]+)$/u);
    return match && { parent: Number(match[1]), command: match[2] };
  } catch { return null; }
}

export async function stopOwnedElectron(session, { project, isoDir, repo }) {
  session?.cdp?.close();
  const pid = session?.pid;
  if (!pid) return;
  const info = processInfo(pid);
  if (!info) return;
  const cwd = execFileSync('lsof', ['-a', '-d', 'cwd', '-p', String(pid)], { encoding: 'utf8' });
  if (info.parent !== process.pid || !info.command.includes(project)
    || !info.command.includes(`--user-data-dir=${isoDir}`) || !cwd.includes(repo)) {
    throw new Error(`refused to stop unverified Electron PID ${pid}`);
  }
  process.kill(pid, 'SIGTERM');
  await sleep(1500);
  const remaining = processInfo(pid);
  if (remaining?.command === info.command && remaining.parent === process.pid) process.kill(pid, 'SIGKILL');
}
