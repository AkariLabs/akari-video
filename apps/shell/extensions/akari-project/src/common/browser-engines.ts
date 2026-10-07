import { navigationAllowed, blockedWebHost } from './site-navigation-policy';

export interface BrowserEngine { id: string; label: string; template: string }
export interface BrowserDefinition { id: string; name: string; navigation: 'open'; downloads: 'deny'; partition: string }
export interface BrowserConfig { version: 1; open_web: BrowserDefinition; engines: BrowserEngine[]; testHttp?: boolean }
export const OPEN_WEB_POLICY = { navigation: 'open', downloads: 'deny', hosts: [], download_hosts: [] } as const;
export type BrowserCommandResult = { ok: boolean; code?: string; message?: string };
export const BROWSER_COMMAND_IDS = {
    search: 'akari.browser.search', pickMode: 'akari.browser.pickMode',
    close: 'akari.browser.close', open: 'akari.browser.open'
} as const;
const ENGINE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function stripSearchControls(value: string): string {
    return Array.from(value).filter(char => {
        const code = char.codePointAt(0) ?? 0;
        return !(code <= 31 || code >= 127 && code <= 159 || code >= 0x200b && code <= 0x200f
            || code >= 0x202a && code <= 0x202e || code === 0x2060 || code >= 0x2066 && code <= 0x2069
            || code === 0xfeff);
    }).join('');
}

export function validateEngine(value: unknown, testHttp = false): value is BrowserEngine {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const engine = value as Record<string, unknown>;
    if (Object.keys(engine).sort().join(',') !== 'id,label,template' ||
        typeof engine.id !== 'string' || !ENGINE_ID.test(engine.id) || engine.id.length > 64 ||
        typeof engine.label !== 'string' || !engine.label.trim() || engine.label.length > 80 ||
        typeof engine.template !== 'string' || !(engine.template.startsWith('https://') ||
            testHttp && engine.template.startsWith('http://127.0.0.1')) ||
        engine.template.split('{q}').length !== 2) return false;
    try {
        const url = new URL(engine.template.replace('{q}', 'search'));
        return !url.username && !url.password && (url.protocol === 'https:' && !blockedWebHost(url.hostname)
            || testHttp && url.protocol === 'http:' && url.hostname === '127.0.0.1');
    } catch { return false; }
}

export function validateBrowserConfig(value: unknown, testHttp = false): value is BrowserConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const config = value as Record<string, unknown>;
    const def = config.open_web as Record<string, unknown> | undefined;
    if (Object.keys(config).sort().join(',') !== 'engines,open_web,version' ||
        config.version !== 1 || !def || Array.isArray(def) ||
        Object.keys(def).sort().join(',') !== 'downloads,id,name,navigation,partition' ||
        def.id !== 'open-web' || typeof def.name !== 'string' || !def.name.trim() ||
        def.navigation !== 'open' || def.downloads !== 'deny' || def.partition !== 'persist:akari-browser' ||
        !Array.isArray(config.engines) || config.engines.length < 1 || config.engines.length > 24) return false;
    const ids = new Set<string>();
    return config.engines.every(engine => {
        if (!validateEngine(engine, testHttp) || ids.has(engine.id)) return false;
        ids.add(engine.id); return true;
    });
}

export function validUserEngines(value: unknown, builtIn: readonly BrowserEngine[]): { engines: BrowserEngine[]; invalidIds: string[] } {
    if (!Array.isArray(value)) return { engines: [], invalidIds: ['設定'] };
    const ids = new Set(builtIn.map(engine => engine.id));
    const engines: BrowserEngine[] = []; const invalidIds: string[] = [];
    value.forEach((item: unknown, index) => {
        const id = item && typeof item === 'object' && 'id' in item ? stripSearchControls(String(item.id)).slice(0, 40) : String(index);
        if (index >= 12 || !validateEngine(item)) { invalidIds.push(id); return; }
        if (ids.has(item.id)) return;
        ids.add(item.id); engines.push(item);
    });
    return { engines, invalidIds };
}

export function cleanSearchQuery(query: string): string {
    return Array.from(stripSearchControls(query).trim()).slice(0, 512).join('');
}

export function buildSearchUrl(engine: BrowserEngine, query: string, testHttp = false):
    { ok: true; url: string } | { ok: false; code: 'empty-query' | 'invalid-url' } {
    const cleaned = cleanSearchQuery(query);
    if (!cleaned) return { ok: false, code: 'empty-query' };
    const url = engine.template.replace('{q}', encodeURIComponent(cleaned));
    return navigationAllowed(url, OPEN_WEB_POLICY, testHttp) ? { ok: true, url } : { ok: false, code: 'invalid-url' };
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
        Object.keys(value).sort().join(',') === [...keys].sort().join(','));
}

export function validateBrowserArgs(command: string, value: unknown): BrowserCommandResult {
    if (command === BROWSER_COMMAND_IDS.search) {
        if (!exactObject(value, ['engine', 'query']) || typeof value.engine !== 'string' ||
            !/^[a-z0-9-]{1,64}$/.test(value.engine) || typeof value.query !== 'string')
            return { ok: false, code: 'bad-args', message: '検索の指定が不正です' };
        return { ok: true };
    }
    if (command === BROWSER_COMMAND_IDS.pickMode) return exactObject(value, ['on']) && typeof value.on === 'boolean'
        ? { ok: true } : { ok: false, code: 'bad-args', message: '操作の指定が不正です' };
    if (command === BROWSER_COMMAND_IDS.close) return exactObject(value, [])
        ? { ok: true } : { ok: false, code: 'bad-args', message: '操作の指定が不正です' };
    if (command === BROWSER_COMMAND_IDS.open) return exactObject(value, ['url']) &&
        typeof value.url === 'string' && value.url.length <= 8192
        ? { ok: true } : { ok: false, code: 'bad-args', message: 'アドレスの指定が不正です' };
    return { ok: false, code: 'bad-args', message: '操作が不正です' };
}
