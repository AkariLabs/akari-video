import type { ChildProcess } from 'child_process';

const pending = new Set<Promise<void>>();

export async function waitForTerminations(): Promise<void> {
    await Promise.allSettled([...pending]);
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
    if (!child.pid) return;
    try {
        if (process.platform !== 'win32') process.kill(-child.pid, signal);
        else if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    } catch { /* The process group has already exited. */ }
}

export function reapChildGroup(child: ChildProcess): void {
    if (process.platform === 'win32' || !child.pid) return;
    const reap = (): void => killGroup(child, 'SIGKILL');
    child.once('exit', reap);
    child.once('close', reap);
}

export function terminateChild(child: ChildProcess | undefined): Promise<void> {
    if (!child?.pid) return Promise.resolve();
    if (child.exitCode !== null || child.signalCode !== null) {
        if (process.platform !== 'win32') killGroup(child, 'SIGKILL');
        return Promise.resolve();
    }
    child.stdin?.end();
    const signal = (name: NodeJS.Signals): void => {
        killGroup(child, name);
    };
    const termination = new Promise<void>(resolve => {
        let ended = false;
        child.once('close', () => { ended = true; });
        child.once('exit', () => { ended = true; });
        signal('SIGTERM');
        setTimeout(() => {
            if (!ended || process.platform !== 'win32') signal('SIGKILL');
            setTimeout(resolve, 100);
        }, 250);
    });
    pending.add(termination);
    void termination.then(() => pending.delete(termination));
    return termination;
}
