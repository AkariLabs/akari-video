import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveAkariHome } from './index.mjs';

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function credentialsPaths(env = process.env, { platform = process.platform } = {}) {
    const home = platform === 'win32'
        ? env.USERPROFILE || (env.HOMEDRIVE && env.HOMEPATH ? `${env.HOMEDRIVE}${env.HOMEPATH}` : os.homedir())
        : env.HOME || os.homedir();
    return {
        primary: env.AKARI_CREDENTIALS_FILE ?? path.join(resolveAkariHome(env, { platform }), 'credentials.env'),
        legacy: env.AKARI_CREDENTIALS_FILE ? null : path.join(home, '.config', 'akari-video', 'credentials.env'),
    };
}

export function parseCredentialSource(source) {
    return parseCredentialSourceWithWarnings(source).values;
}

function parseCredentialSourceWithWarnings(source) {
    const values = new Map();
    const warnings = [];
    for (const [index, original] of source.split(/\r?\n/).entries()) {
        const line = original.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        const name = line.slice(0, separator).trim();
        if (separator < 1 || !NAME.test(name)) { warnings.push(index + 1); continue; }
        let value = line.slice(separator + 1).trim();
        if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
        values.set(name, value);
    }
    return { values, warnings };
}

function readFile(file, readFileImpl) {
    if (!file) return null;
    if (readFileImpl) {
        try { return { text: readFileImpl(file, 'utf8'), mode: 0o600 }; }
        catch (error) { if (error.code === 'ENOENT' || error.message === 'missing') return null; throw error; }
    }
    try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile()) throw new Error('Credentials path is not a regular file');
        return { text: fs.readFileSync(file, 'utf8'), mode: stat.mode & 0o777 };
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

export function readCredentials(env = process.env, opts = {}) {
    const { primary, legacy } = credentialsPaths(env, opts);
    const primaryFile = readFile(primary, opts.readFile);
    const legacyFile = readFile(legacy, opts.readFile);
    const values = new Map();
    const sources = Object.create(null);
    const warnings = [];
    for (const [source, file] of [['legacy', legacyFile], ['primary', primaryFile]]) {
        if (!file) continue;
        const parsed = parseCredentialSourceWithWarnings(file.text);
        warnings.push(...parsed.warnings.map(line => ({ source, line })));
        for (const [key, value] of parsed.values) {
            values.set(key, value);
            sources[key] = source;
        }
    }
    return { values, sources, warnings, primaryExists: !!primaryFile, legacyExists: !!legacyFile,
        primaryMode: primaryFile?.mode ?? null, legacyMode: legacyFile?.mode ?? null };
}

export function updateCredentialSource(source, key, value) {
    if (!NAME.test(key)) throw new Error('Invalid credential name');
    if (value !== null && (typeof value !== 'string' || !value || value.trim() !== value || /[\s'"`]/u.test(value) || Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))) throw new Error('Invalid credential value');
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    let replaced = false;
    let output = '';
    for (const line of lines) {
        const separator = line.indexOf('=');
        if (separator >= 1 && line.slice(0, separator).trim() === key) {
            if (value !== null && !replaced) { output += `${key}=${value}${newline}`; replaced = true; }
        } else output += line;
    }
    if (output && !output.endsWith('\n')) output += newline;
    if (value !== null && !replaced) output += `${key}=${value}${newline}`;
    return output || newline;
}

function writeFile(file, key, value) {
    const existing = readFile(file);
    if (!existing && value === null) return;
    const next = updateCredentialSource(existing?.text ?? '', key, value);
    const directory = path.dirname(file);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    const temporary = path.join(directory, `.credentials-${randomUUID()}.tmp`);
    try {
        fs.writeFileSync(temporary, next, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        fs.chmodSync(temporary, 0o600);
        fs.renameSync(temporary, file);
        fs.chmodSync(file, 0o600);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}

export function writeCredential(key, value, env = process.env, opts = {}) {
    writeFile(credentialsPaths(env, opts).primary, key, value);
}

export function deleteCredential(key, env = process.env, opts = {}) {
    const { primary, legacy } = credentialsPaths(env, opts);
    writeFile(primary, key, null);
    if (legacy && parseCredentialSource(readFile(legacy)?.text ?? '').has(key)) writeFile(legacy, key, null);
}
