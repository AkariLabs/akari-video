import { createHash } from 'crypto';
import { createConnection, createServer } from 'net';

export const DSH_WEB_PORT_MIN = 20000;
export const DSH_WEB_PORT_MAX = 44999;
const PORT_COUNT = DSH_WEB_PORT_MAX - DSH_WEB_PORT_MIN + 1;

export function normalizeWebCwdKey(realPath: string, platform: NodeJS.Platform = process.platform): string {
    const normalized = realPath.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
    return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function dshWebPortCandidates(cwdKey: string): number[] {
    const hash = createHash('sha256').update(cwdKey).digest();
    const ports: number[] = [];
    for (let index = 0; index < 4; index++) {
        let port = DSH_WEB_PORT_MIN + hash.readUInt32BE(index * 4) % PORT_COUNT;
        while (ports.includes(port)) port = DSH_WEB_PORT_MIN + (port - DSH_WEB_PORT_MIN + 1) % PORT_COUNT;
        ports.push(port);
    }
    return ports;
}

function canListenOnLoopback(port: number, serverFactory: typeof createServer): Promise<boolean> {
    return new Promise(resolve => {
        const server = serverFactory();
        server.once('error', () => resolve(false));
        server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
}

function loopbackConnectionIsFree(port: number, host: string, connect: typeof createConnection): Promise<boolean> {
    return new Promise(resolve => {
        const socket = connect({ port, host });
        let settled = false;
        const finish = (free: boolean): void => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(free);
        };
        socket.once('connect', () => finish(false));
        socket.once('error', (error: NodeJS.ErrnoException) => {
            finish(['ECONNREFUSED', 'EADDRNOTAVAIL', 'EAFNOSUPPORT', 'ENETUNREACH', 'EINVAL'].includes(error.code ?? ''));
        });
        socket.setTimeout(300, () => finish(false));
    });
}

export async function canListenOnDshWebPort(
    port: number, serverFactory: typeof createServer = createServer,
    connect: typeof createConnection = createConnection
): Promise<boolean> {
    if (!(await canListenOnLoopback(port, serverFactory))) return false;
    for (const host of ['127.0.0.1', '::1']) {
        if (!(await loopbackConnectionIsFree(port, host, connect))) return false;
    }
    return true;
}

export async function selectDshWebPort(
    cwdKey: string, canListen: (port: number) => Promise<boolean> = canListenOnDshWebPort
): Promise<{ port?: number; skipped: number[] }> {
    const skipped: number[] = [];
    for (const port of dshWebPortCandidates(cwdKey)) {
        if (await canListen(port)) return { port, skipped };
        skipped.push(port);
    }
    return { skipped };
}
