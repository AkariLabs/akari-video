/** Node-only helpers. Never import this module from a browser entry point. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ConnectionDoctor, ConnectionRow, SetCredentialResult } from './akari-connections-protocol';

export interface CredentialState {
    exists: boolean;
    secure_permissions: boolean;
    values: Map<string, string>;
}

export interface ConnectionProvider {
    id: string;
    auth: string;
    env: string | null;
    notes: { description: string; setup_url: string | null };
}

export type DoctorAdapter = (secret: string, checkedAt: string) => Promise<ConnectionDoctor>;

export function credentialsFilePath(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
    return env.AKARI_CREDENTIALS_FILE ?? path.join(home, '.config', 'akari-video', 'credentials.env');
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function credentialEnvName(provider: ConnectionProvider): string {
    const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(provider.env ?? '');
    if (provider.auth !== 'env-key' || !match) { throw new Error('未対応の接続です。'); }
    return match[1];
}

export function parseCredentials(source: string): Map<string, string> {
    const values = new Map<string, string>();
    for (const original of source.split(/\r?\n/)) {
        const line = original.trim();
        if (!line || line.startsWith('#')) { continue; }
        const separator = line.indexOf('=');
        const name = line.slice(0, separator).trim();
        if (separator < 1 || !ENV_NAME.test(name)) { continue; }
        let value = line.slice(separator + 1).trim();
        if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
            value = value.slice(1, -1);
        }
        values.set(name, value);
    }
    return values;
}

export function readCredentials(filePath: string): CredentialState {
    try {
        const stat = fs.lstatSync(filePath);
        if (!stat.isFile()) { throw new Error(); }
        return { exists: true, secure_permissions: (stat.mode & 0o777) === 0o600, values: parseCredentials(fs.readFileSync(filePath, 'utf8')) };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { exists: false, secure_permissions: false, values: new Map() };
        }
        throw new Error('資格情報ファイルを読めません。');
    }
}

/** Preserve every unrelated line, including comments, blank lines and CRLF. Remove duplicate target assignments. */
export function updateCredentialSource(source: string, name: string, value: string | null): string {
    if (!ENV_NAME.test(name)) { throw new Error('資格情報の名前が不正です。'); }
    if (value !== null && (typeof value !== 'string' || !value || value.trim() !== value || (/[\s'"`]/u.test(value) || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)))) {
        throw new Error('鍵は空白や改行・引用符を含まない 1 行で入力してください。');
    }
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    let replaced = false;
    let output = '';
    for (const line of lines) {
        const separator = line.indexOf('=');
        if (separator >= 1 && line.slice(0, separator).trim() === name) {
            if (value !== null && !replaced) { output += `${name}=${value}${newline}`; replaced = true; }
        } else {
            output += line;
        }
    }
    if (output && !output.endsWith('\n')) { output += newline; }
    if (value !== null && !replaced) { output += `${name}=${value}${newline}`; }
    return output || newline;
}

/** Synchronous read/modify/rename has no await gap, so concurrent RPC calls cannot lose other rows. */
export function writeCredential(filePath: string, name: string, value: string | null): void {
    let temporary: string | undefined;
    try {
        const state = readCredentials(filePath);
        const source = state.exists ? fs.readFileSync(filePath, 'utf8') : '';
        const next = updateCredentialSource(source, name, value);
        if (!state.exists && value === null) { return; }
        const directory = path.dirname(filePath);
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        fs.chmodSync(directory, 0o700);
        temporary = path.join(directory, `.credentials-${randomUUID()}.tmp`);
        fs.writeFileSync(temporary, next, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        fs.chmodSync(temporary, 0o600);
        fs.renameSync(temporary, filePath);
        temporary = undefined;
        fs.chmodSync(filePath, 0o600);
    } catch {
        throw new Error('資格情報を保存できません。入力と保存先の権限を確認してください。');
    } finally {
        if (temporary) { try { fs.unlinkSync(temporary); } catch { /* Do not expose filesystem errors. */ } }
    }
}

export function maskedTail(value: string | undefined): string | null {
    // A very short credential must never be returned in full.
    return value ? value.length > 4 ? value.slice(-4) : '••••' : null;
}

export function unconfiguredDoctor(): ConnectionDoctor {
    return { status: 'unconfigured', detail: '未登録', last_checked: null };
}

export function formatConnections(
    providers: readonly ConnectionProvider[], state: CredentialState,
    doctors: ReadonlyMap<string, ConnectionDoctor> = new Map()
): ConnectionRow[] {
    const priority = ['fal', 'elevenlabs', 'groq'];
    const rank = (id: string): number => { const i = priority.indexOf(id); return i < 0 ? priority.length : i; };
    const labels: Record<string, string> = { fal: 'fal.ai', elevenlabs: 'ElevenLabs', groq: 'Groq', replicate: 'Replicate', openrouter: 'OpenRouter' };
    return providers.filter(provider => provider.auth === 'env-key' && provider.id !== 'akari-cloud')
        .slice().sort((a, b) => rank(a.id) - rank(b.id))
        .map(provider => {
            const env_name = credentialEnvName(provider);
            const secret = state.values.get(env_name);
            return {
                id: provider.id, label: labels[provider.id] ?? provider.id,
                description: provider.notes.description, setup_url: provider.notes.setup_url, env_name,
                configured: !!secret, masked_tail: maskedTail(secret),
                doctor: secret ? doctors.get(provider.id) ?? { status: 'unchecked', detail: '未確認', last_checked: null } : unconfiguredDoctor()
            };
        });
}

export async function checkCredential(filePath: string, name: string, adapter?: DoctorAdapter): Promise<ConnectionDoctor> {
    const secret = readCredentials(filePath).values.get(name);
    if (!secret) { return unconfiguredDoctor(); }
    const last_checked = new Date().toISOString();
    if (!adapter) { return { status: 'unchecked', detail: '無償・読み取り専用の確認に未対応です。', last_checked }; }
    try {
        const doctor = await adapter(secret, last_checked);
        return safeDoctor(doctor, secret, last_checked);
    } catch {
        return { status: 'unchecked', detail: '接続を確認できませんでした。', last_checked };
    }
}

/** The service uses this same tested registration path. No raw error or credential escapes. */
export async function setCredentialAndCheck(
    filePath: string, name: string, value: string, check: () => Promise<ConnectionDoctor>
): Promise<SetCredentialResult> {
    writeCredential(filePath, name, value);
    let doctor: ConnectionDoctor;
    try { doctor = await check(); } catch { doctor = { status: 'unchecked', detail: '接続を確認できませんでした。', last_checked: new Date().toISOString() }; }
    return { ok: true, masked_tail: maskedTail(value), doctor: safeDoctor(doctor, value, new Date().toISOString()) };
}

function safeDoctor(doctor: ConnectionDoctor, secret: string, last_checked: string): ConnectionDoctor {
    // Do not pass through arbitrary adapter fields or reflected secrets.
    const status = ['ok', 'unauthorized', 'unconfigured', 'unchecked', 'setup_required'].includes(doctor?.status) ? doctor.status : 'unchecked';
    const detail = typeof doctor?.detail === 'string' && !doctor.detail.includes(secret) ? doctor.detail : '接続結果を表示できません。';
    return { status, detail, last_checked };
}
