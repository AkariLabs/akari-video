#!/usr/bin/env node

import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { importPackage } from './resolve-packages.mjs';

let DEFAULT_CONNECTIONS_REGISTRY;
let resolveCreatorRoot;

async function loadCreatorRoot() {
    if (resolveCreatorRoot) return;
    const creatorRoot = await importPackage('creator-root/src/index.mjs', { from: import.meta.url });
    DEFAULT_CONNECTIONS_REGISTRY = creatorRoot.DEFAULT_CONNECTIONS_REGISTRY;
    resolveCreatorRoot = creatorRoot.resolveCreatorRoot;
}

const PROVIDER_KINDS = new Set(['genai', 'image', 'video', 'tts', 'music', 'sns', 'analytics']);
const PROVIDER_AUTHS = new Set(['login', 'env-key', 'oauth-mcp', 'none']);
const DOCTOR_STATUSES = new Set(['ok', 'unauthorized', 'unconfigured', 'unchecked', 'setup_required']);
const ENV_REFERENCE_PATTERN = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;
const KEBAB_CASE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** connections 解決処理が投げる、判別可能な `code` を持つエラー。 */
export class ConnectionsResolutionError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'ConnectionsResolutionError';
        this.code = code;
    }
}

/** connections.json を読み、存在しない場合だけ null を返す。 */
export async function readConnectionsFile(filePath) {
    let raw;
    try {
        raw = await fs.readFile(filePath, 'utf8');
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }

    let registry;
    try {
        registry = JSON.parse(raw);
    } catch {
        throw new ConnectionsResolutionError(
            'CONNECTIONS_INVALID_JSON',
            `connections.json の JSON 解析に失敗しました: ${filePath}`
        );
    }

    try {
        validateRegistry(registry);
    } catch (error) {
        if (error instanceof ConnectionsResolutionError) {
            throw error;
        }
        throw new ConnectionsResolutionError(
            'CONNECTIONS_INVALID_VOCABULARY',
            `connections.json の構造が不正です: ${filePath}`
        );
    }
    return registry;
}

export function mergeProvidersById(baseProviders, overlayProviders) {
    return mergeArrayByKey(baseProviders, overlayProviders, 'id');
}

export function mergeMemoryByName(baseMemory, overlayMemory) {
    return mergeArrayByKey(baseMemory, overlayMemory, 'name');
}

export function mergePolicy(basePolicy, overlayPolicy) {
    if (!overlayPolicy) {
        return basePolicy;
    }
    return {
        currency: overlayPolicy.currency,
        monthly_budget: overlayPolicy.monthly_budget !== null
            ? overlayPolicy.monthly_budget
            : basePolicy.monthly_budget,
        approval_threshold: overlayPolicy.approval_threshold !== null
            ? overlayPolicy.approval_threshold
            : basePolicy.approval_threshold
    };
}

export function overlayConnections(base, overlay) {
    if (overlay === null) {
        return base;
    }
    return {
        providers: mergeProvidersById(base.providers, overlay.providers),
        policy: mergePolicy(base.policy, overlay.policy),
        memory: mergeMemoryByName(base.memory ?? [], overlay.memory ?? [])
    };
}

export async function resolveConnections({
    projectRoot = process.cwd(),
    env = process.env,
    platform = process.platform
} = {}) {
    await loadCreatorRoot();
    const resolvedProjectRoot = path.resolve(projectRoot);
    const projectPath = path.join(resolvedProjectRoot, '.akari', 'connections.json');
    const project = await readConnectionsFile(projectPath);
    const creatorRoot = await resolveCreatorRoot({ cwd: resolvedProjectRoot, env, platform });

    if (creatorRoot?.error) {
        throw new ConnectionsResolutionError(
            creatorRoot.error.code ?? 'CREATOR_ROOT_RESOLUTION_FAILED',
            `作業場を解決できませんでした: ${creatorRoot.error.message ?? creatorRoot.rootDir}`
        );
    }

    let workspace = null;
    let workspaceLayer = null;
    if (creatorRoot?.manifest) {
        const workspacePath = path.join(creatorRoot.rootDir, '.akari', 'connections.json');
        workspace = await readConnectionsFile(workspacePath);
        workspaceLayer = {
            rootDir: creatorRoot.rootDir,
            path: workspacePath,
            exists: workspace !== null
        };
    }

    const bundledDefault = clone(DEFAULT_CONNECTIONS_REGISTRY);
    const base = workspace ?? bundledDefault;
    const effective = overlayConnections(base, project);
    const sources = {
        providers: sourceMap(effective.providers, 'id', project?.providers, workspace?.providers),
        memory: sourceMap(effective.memory, 'name', project?.memory, workspace?.memory),
        policy: {
            currency: project ? 'project' : workspace ? 'workspace' : 'default',
            monthly_budget: policySource('monthly_budget', project, workspace),
            approval_threshold: policySource('approval_threshold', project, workspace)
        }
    };

    return {
        effective,
        sources,
        layers: {
            project: { path: projectPath, exists: project !== null },
            workspace: workspaceLayer,
            default: {
                path: null,
                note: 'bundled DEFAULT_CONNECTIONS_REGISTRY (packages/creator-root)'
            }
        }
    };
}

function mergeArrayByKey(baseItems, overlayItems, key) {
    const overlayByKey = new Map(overlayItems.map((item) => [item[key], item]));
    const merged = baseItems.map((item) => overlayByKey.get(item[key]) ?? item);
    const baseKeys = new Set(baseItems.map((item) => item[key]));
    for (const item of overlayItems) {
        if (!baseKeys.has(item[key])) {
            merged.push(item);
        }
    }
    return merged;
}

function sourceMap(effectiveItems, key, projectItems = [], workspaceItems = []) {
    const projectKeys = new Set((projectItems ?? []).map((item) => item[key]));
    const workspaceKeys = new Set((workspaceItems ?? []).map((item) => item[key]));
    return Object.fromEntries(effectiveItems.map((item) => [
        item[key],
        projectKeys.has(item[key]) ? 'project' : workspaceKeys.has(item[key]) ? 'workspace' : 'default'
    ]));
}

function policySource(field, project, workspace) {
    if (project && project.policy[field] !== null) {
        return 'project';
    }
    return workspace ? 'workspace' : 'default';
}

function validateRegistry(registry) {
    assertPlainObject(registry, 'ルート');
    assertFields(registry, ['providers', 'policy'], ['providers', 'policy', 'memory'], 'ルート');
    if (!Array.isArray(registry.providers)) invalid('providers は配列である必要があります');
    if (Object.hasOwn(registry, 'memory') && !Array.isArray(registry.memory)) {
        invalid('memory は配列である必要があります');
    }
    validateUniqueItems(registry.providers, 'id', 'providers', validateProvider);
    validatePolicy(registry.policy);
    validateUniqueItems(registry.memory ?? [], 'name', 'memory', validateMemory);
}

function validateProvider(provider, label) {
    assertPlainObject(provider, label);
    const fields = ['id', 'kind', 'auth', 'env', 'models', 'notes', 'doctor'];
    assertFields(provider, fields, fields, label);
    assertKebabCase(provider.id, `${label}.id`);
    if (!PROVIDER_KINDS.has(provider.kind)) invalid(`${label}.kind が語彙外です`);
    if (!PROVIDER_AUTHS.has(provider.auth)) invalid(`${label}.auth が語彙外です`);
    if (provider.auth === 'env-key') {
        if (typeof provider.env !== 'string' || !ENV_REFERENCE_PATTERN.test(provider.env)) {
            invalid(`${label}.env は env-key 認証では \${KEY_NAME} 形式である必要があります`);
        }
    } else if (provider.env !== null) {
        invalid(`${label}.env は env-key 以外では null である必要があります`);
    }
    validateModels(provider.models, `${label}.models`);
    validateNotes(provider.notes, `${label}.notes`, provider.auth);
    validateDoctor(provider.doctor, `${label}.doctor`);
}

function validateModels(models, label) {
    assertPlainObject(models, label);
    assertFields(models, ['default', 'allowed'], ['default', 'allowed'], label);
    if (models.default !== null) assertNonEmptyString(models.default, `${label}.default`);
    assertStringArray(models.allowed, `${label}.allowed`);
    if (typeof models.default === 'string' && !models.allowed.includes(models.default)) {
        invalid(`${label}.default は allowed に含まれている必要があります`);
    }
}

function validateNotes(notes, label, auth) {
    assertPlainObject(notes, label);
    const fields = ['description', 'workflows', 'billing', 'quota', 'scopes', 'setup_url'];
    assertFields(notes, fields, fields, label);
    for (const field of ['description', 'billing', 'quota']) {
        assertNonEmptyString(notes[field], `${label}.${field}`);
    }
    assertStringArray(notes.workflows, `${label}.workflows`);
    assertStringArray(notes.scopes, `${label}.scopes`);
    if (notes.setup_url !== null) {
        assertNonEmptyString(notes.setup_url, `${label}.setup_url`);
        let parsed;
        try {
            parsed = new URL(notes.setup_url);
        } catch {
            invalid(`${label}.setup_url は有効な URL である必要があります`);
        }
        if (parsed.protocol !== 'https:') invalid(`${label}.setup_url は https URL である必要があります`);
    }
    if (auth === 'env-key' && notes.setup_url === null) {
        invalid(`${label}.setup_url は env-key の取得先案内に必要です`);
    }
}

function validateDoctor(doctor, label) {
    assertPlainObject(doctor, label);
    assertFields(doctor, ['status'], ['last_checked', 'status', 'detail'], label);
    if (!DOCTOR_STATUSES.has(doctor.status)) invalid(`${label}.status が語彙外です`);
    if (Object.hasOwn(doctor, 'last_checked') && doctor.last_checked !== null) {
        assertNonEmptyString(doctor.last_checked, `${label}.last_checked`);
        if (!Number.isFinite(Date.parse(doctor.last_checked))) invalid(`${label}.last_checked が日時ではありません`);
    }
    if (Object.hasOwn(doctor, 'detail')) assertNonEmptyString(doctor.detail, `${label}.detail`);
}

function validateMemory(memory, label) {
    assertPlainObject(memory, label);
    assertFields(
        memory,
        ['name', 'root'],
        ['name', 'root', 'entry', 'include', 'exclude', 'read_policy'],
        label
    );
    assertKebabCase(memory.name, `${label}.name`);
    assertNonEmptyString(memory.root, `${label}.root`);
    if (Object.hasOwn(memory, 'entry')) assertNonEmptyString(memory.entry, `${label}.entry`);
    if (Object.hasOwn(memory, 'include')) assertStringArray(memory.include, `${label}.include`);
    if (Object.hasOwn(memory, 'exclude')) assertStringArray(memory.exclude, `${label}.exclude`);
    if (Object.hasOwn(memory, 'read_policy') && memory.read_policy !== 'read-only') {
        invalid(`${label}.read_policy が語彙外です`);
    }
}

function validatePolicy(policy) {
    assertPlainObject(policy, 'policy');
    const fields = ['currency', 'monthly_budget', 'approval_threshold'];
    assertFields(policy, fields, fields, 'policy');
    if (typeof policy.currency !== 'string' || !/^[A-Z]{3}$/.test(policy.currency)) {
        invalid('policy.currency は 3 文字の大文字通貨コードである必要があります');
    }
    for (const field of ['monthly_budget', 'approval_threshold']) {
        const value = policy[field];
        if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
            invalid(`policy.${field} は null または 0 以上の有限数である必要があります`);
        }
    }
}

function validateUniqueItems(items, key, label, validator) {
    const seen = new Set();
    for (const [index, item] of items.entries()) {
        const itemLabel = `${label}[${index}]`;
        validator(item, itemLabel);
        if (seen.has(item[key])) invalid(`${label} の ${key} が重複しています: ${item[key]}`);
        seen.add(item[key]);
    }
}

function assertFields(value, required, allowed, label) {
    for (const field of required) {
        if (!Object.hasOwn(value, field)) invalid(`${label}.${field} は必須です`);
    }
    for (const field of Object.keys(value)) {
        if (!allowed.includes(field)) invalid(`${label}.${field} は未定義のフィールドです`);
    }
}

function assertPlainObject(value, label) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        invalid(`${label} は object である必要があります`);
    }
}

function assertKebabCase(value, label) {
    if (typeof value !== 'string' || !KEBAB_CASE_PATTERN.test(value)) {
        invalid(`${label} は英小文字・数字の kebab-case である必要があります`);
    }
}

function assertNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        invalid(`${label} は空でない文字列である必要があります`);
    }
}

function assertStringArray(value, label) {
    if (!Array.isArray(value)) invalid(`${label} は配列である必要があります`);
    const seen = new Set();
    for (const [index, item] of value.entries()) {
        assertNonEmptyString(item, `${label}[${index}]`);
        if (seen.has(item)) invalid(`${label} に重複があります: ${item}`);
        seen.add(item);
    }
}

function invalid(message) {
    throw new ConnectionsResolutionError('CONNECTIONS_INVALID_VOCABULARY', message);
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function isMainModule() {
    if (!process.argv[1]) return false;
    try {
        return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(process.argv[1]));
    } catch {
        return false;
    }
}

if (isMainModule()) {
    try {
        const resolved = await resolveConnections({ projectRoot: process.argv[2] ?? process.cwd() });
        process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`);
    } catch (error) {
        console.error(error?.message ?? '接続設定を解決できませんでした。');
        process.exit(1);
    }
}
