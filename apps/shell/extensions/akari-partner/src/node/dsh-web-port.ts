import { createHash } from 'crypto';
import { createServer } from 'net';

const FIRST_PORT = 20000;
const PORT_COUNT = 25000;

export function normalizeWebCwdKey(realPath: string, platform: NodeJS.Platform = process.platform): string {
    const normalized = realPath.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
    return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function dshWebPortCandidates(cwdKey: string): number[] {
    const hash = createHash('sha256').update(cwdKey).digest();
    const ports: number[] = [];
    for (let index = 0; index < 4; index++) {
        let port = FIRST_PORT + hash.readUInt32BE(index * 4) % PORT_COUNT;
        while (ports.includes(port)) port = FIRST_PORT + (port - FIRST_PORT + 1) % PORT_COUNT;
        ports.push(port);
    }
    return ports;
}

export function canListenOnDshWebPort(port: number): Promise<boolean> {
    return new Promise(resolve => {
        const server = createServer();
        server.once('error', () => resolve(false));
        server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
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
