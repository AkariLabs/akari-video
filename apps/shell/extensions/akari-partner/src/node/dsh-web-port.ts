import { createHash } from 'crypto';
import { createServer } from 'net';

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

function canListenOnHost(port: number, host: string): Promise<boolean> {
    return new Promise(resolve => {
        const server = createServer();
        server.once('error', (error: NodeJS.ErrnoException) => {
            if (host === '::' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'ENOTSUP', 'EINVAL'].includes(error.code ?? '')) {
                resolve(true);
            } else resolve(false);
        });
        server.listen({ port, host, ipv6Only: host === '::' }, () => server.close(() => resolve(true)));
    });
}

export async function canListenOnDshWebPort(port: number): Promise<boolean> {
    for (const host of ['127.0.0.1', '0.0.0.0', '::']) {
        if (!(await canListenOnHost(port, host))) return false;
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
