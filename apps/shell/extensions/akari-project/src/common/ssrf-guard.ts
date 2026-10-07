import { isIP } from 'net';
import { blockedWebHost } from './site-navigation-policy';

function ipv4Blocked(value: string, allowLoopbackForTest: boolean): boolean {
    const parts = value.split('.').map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b] = parts;
    if (allowLoopbackForTest && a === 127) return false;
    return blockedWebHost(value) || a === 100 && b >= 64 && b <= 127 || a === 192 && b === 0
        || a === 198 && (b === 18 || b === 19) || a >= 224;
}

export function blockedAddress(address: string, allowLoopbackForTest = false): boolean {
    if (isIP(address) === 4) return ipv4Blocked(address, allowLoopbackForTest);
    if (isIP(address) !== 6) return true;
    const value = address.toLowerCase().replace(/^\[|\]$/gu, '');
    if (value === '::' || value === '::1') return !(allowLoopbackForTest && value === '::1');
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(value);
    if (mapped) return ipv4Blocked(mapped[1], allowLoopbackForTest);
    const words = value.split(':');
    if (/^::ffff:/u.test(value) && words.length >= 2) {
        const hi = parseInt(words[words.length - 2], 16); const lo = parseInt(words[words.length - 1], 16);
        return ipv4Blocked(`${hi >>> 8}.${hi & 255}.${lo >>> 8}.${lo & 255}`, allowLoopbackForTest);
    }
    const first = parseInt(words.find(Boolean) ?? '0', 16);
    return first >= 0xfc00 && first <= 0xfdff || first >= 0xfe80 && first <= 0xfebf
        || blockedWebHost(`[${value}]`);
}

export function safeImageUrl(raw: string, allowLoopbackForTest = false): URL | undefined {
    try {
        const url = new URL(raw);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
        if (allowLoopbackForTest && url.hostname === '127.0.0.1') return url;
        if (blockedWebHost(url.hostname) || isIP(url.hostname.replace(/^\[|\]$/gu, ''))
            && blockedAddress(url.hostname.replace(/^\[|\]$/gu, ''), allowLoopbackForTest)) return undefined;
        if (url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local') || url.hostname.endsWith('.internal')) return undefined;
        return url;
    } catch { return undefined; }
}

export function safeResolvedAddresses(addresses: readonly string[], allowLoopbackForTest = false): boolean {
    return addresses.length > 0 && addresses.every(address => !blockedAddress(address, allowLoopbackForTest));
}
