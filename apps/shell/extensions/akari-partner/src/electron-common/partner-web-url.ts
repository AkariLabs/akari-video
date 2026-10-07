export function localWebOrigin(raw: unknown): string | undefined {
    if (typeof raw !== 'string' || !/^http:\/\/127\.0\.0\.1:[0-9]+(?:[/?#]|$)/i.test(raw)) return undefined;
    try {
        const url = new URL(raw);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password
            || !url.port || Number(url.port) === 0) return undefined;
        return url.origin;
    } catch { return undefined; }
}

export function externalUrl(raw: string): string | undefined {
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:' || url.username || url.password) return undefined;
        const host = url.hostname.toLowerCase().replace(/\.$/, '');
        if (host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || host === '[::]'
            || host === '0.0.0.0' || /^127\./.test(host) || host.startsWith('[::ffff:')) return undefined;
        return url.toString();
    } catch { return undefined; }
}

export const PARTNER_WEB_PARTITION = 'persist:akari-partner-deepseek';

export function guardPartnerWebview(
    event: { preventDefault(): void },
    preferences: { partition?: string; preload?: string; preloadURL?: string;
        nodeIntegration?: boolean; contextIsolation?: boolean; sandbox?: boolean; webSecurity?: boolean },
    params: Record<string, string>
): string | undefined {
    const origin = localWebOrigin(params.src);
    if (!origin || preferences.partition !== PARTNER_WEB_PARTITION) {
        event.preventDefault();
        return undefined;
    }
    delete preferences.preload;
    delete preferences.preloadURL;
    delete preferences.webSecurity;
    delete params.preload;
    delete params.allowpopups;
    delete params.allowPopups;
    preferences.nodeIntegration = false;
    preferences.contextIsolation = true;
    preferences.sandbox = true;
    return origin;
}
