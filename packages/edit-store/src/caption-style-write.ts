import { promises as fs } from 'fs';
import { join } from 'path';
import { assertCaptionsWritable, CaptionsInvalidError, validateCaptionLookV1Shape } from './caption-look-shape';
import { planCaptionStyleEdit, planCaptionStyleClear, planCaptionStyleReapply,
    planCaptionSizeEdit, type CaptionRoot, type CaptionStyleEditInput,
    type CaptionClearTarget, type CaptionStyleTarget } from './caption-style-command';
import { planCaptionLookMigration } from './caption-look-reader';
import { loadTextstyleCatalogSync } from './textstyle-library-node';
import type { TextstyleCatalog } from './caption-style-preset';
import { captureProjectLintBaseline, projectFileHash, scheduleProjectLint, writeProjectFilesTransactional, writeSavedByStamp,
    type TransactionOptions, type DeferredLintOptions } from './write-gate';

type FileVersion = { text: string | null; hash: string | null };
export type CaptionWriteOptions = {
    files?: { captions?: string; edit?: string };
    expectedHashes?: Record<string, string | null>;
    appVersion?: string;
    onDidWrite?: (path: string, content: string) => void;
    onWillWrite?: TransactionOptions['onWillWrite'];
    onLintResult?: DeferredLintOptions['onLintResult'];
    debounceMs?: DeferredLintOptions['debounceMs'];
    lintRunner?: DeferredLintOptions['lintRunner'];
    catalog?: TextstyleCatalog;
    onRecovered?: (notice: string) => void;
    hooks?: TransactionOptions['hooks'];
    beforeCommit?: () => void | Promise<void>;
};
type WriteResult = { written: string[]; notices: string[]; changed: string[]; recovered?: string;
    before: Record<string, FileVersion>; after: Record<string, FileVersion> };

async function readVersions(projectRoot: string, options: CaptionWriteOptions): Promise<Record<string, FileVersion>> {
    const versions: Record<string, FileVersion> = {};
    for (const name of [options.files?.captions ?? 'captions.json', options.files?.edit ?? 'edit.json', '.akari/asset-references.json']) {
        let bytes: Buffer | undefined;
        try { bytes = await fs.readFile(join(projectRoot, name)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        versions[name] = bytes ? { text: bytes.toString('utf8'), hash: projectFileHash(bytes) } : { text: null, hash: null };
    }
    return versions;
}

function parsed(value: FileVersion): unknown {
    return value.text === null ? undefined : JSON.parse(value.text.replace(/^\uFEFF/, ''));
}

async function commit(projectRoot: string, before: Record<string, FileVersion>, captions: CaptionRoot,
    changed: string[], notices: string[], options: CaptionWriteOptions, label: string,
    dryRun = false): Promise<WriteResult> {
    const captionsName = options.files?.captions ?? 'captions.json';
    const editName = options.files?.edit ?? 'edit.json';
    const after = structuredClone(before);
    const content = `${JSON.stringify(captions, null, 2)}\n`;
    if (changed.length && before[captionsName].text !== content) {
        assertCaptionsWritable(captions);
        after[captionsName] = { text: content, hash: projectFileHash(content) };
    }
    if (dryRun || after[captionsName].text === before[captionsName].text) {
        return { written: [], notices: [...new Set(notices)], changed: after[captionsName].text === before[captionsName].text ? [] : changed,
            before, after };
    }
    await captureProjectLintBaseline(projectRoot);
    await options.beforeCommit?.();
    const files = Object.fromEntries(Object.entries(before).map(([name, value]) => [name, {
        expectedHash: Object.prototype.hasOwnProperty.call(options.expectedHashes ?? {}, name)
            ? options.expectedHashes![name]
            : name === captionsName && Object.prototype.hasOwnProperty.call(options.expectedHashes ?? {}, 'captions')
                ? options.expectedHashes!.captions
                : name === editName && Object.prototype.hasOwnProperty.call(options.expectedHashes ?? {}, 'edit')
                    ? options.expectedHashes!.edit : value.hash,
        next: after[name].text === value.text ? null : after[name].text
    }]));
    const written = await writeProjectFilesTransactional(projectRoot, { files, label }, {
        hooks: options.hooks, onWillWrite: options.onWillWrite,
        onRecovered: options.onRecovered ?? (notice => console.warn(notice)),
        onDidWrite: async (_path, text, name) => {
            if (name === editName) await writeSavedByStamp(projectRoot, options.appVersion);
            try { options.onDidWrite?.(join(projectRoot, name), text); }
            catch (error) { console.warn('[edit-store] onDidWrite の通知に失敗しました。', error); }
        }
    });
    if (written.written.length) scheduleProjectLint(projectRoot, options);
    return { written: written.written, notices: [...new Set(notices)], changed, ...(written.recovered ? { recovered: written.recovered } : {}),
        before, after };
}

async function readCaptions(projectRoot: string, options: CaptionWriteOptions): Promise<{ before: Record<string, FileVersion>; captions: CaptionRoot }> {
    const captionsName = options.files?.captions ?? 'captions.json';
    const before = await readVersions(projectRoot, options);
    if (before[captionsName].text === null) throw new Error(`${captionsName} が見つかりません。`);
    const captions = parsed(before[captionsName]) as CaptionRoot;
    const shape = validateCaptionLookV1Shape(captions);
    if (shape.some(item => item.severity === 'error')) throw new CaptionsInvalidError(shape);
    return { before, captions };
}

export async function applyCaptionStyle(projectRoot: string, input: Omit<CaptionStyleEditInput, 'captions'>,
    options: CaptionWriteOptions = {}): Promise<WriteResult> {
    const { before, captions } = await readCaptions(projectRoot, options);
    const result = planCaptionStyleEdit({ ...input, catalog: input.catalog ?? options.catalog
        ?? loadTextstyleCatalogSync({ env: process.env }).catalog, captions,
        edit: parsed(before[options.files?.edit ?? 'edit.json']), assetReferences: parsed(before['.akari/asset-references.json']) });
    return commit(projectRoot, before, result.next.captions, result.changed, result.notices, options, 'caption-style');
}

export async function clearCaptionStyle(projectRoot: string,
    input: { targets: CaptionClearTarget[]; mode: 'run' | 'range' }, options: CaptionWriteOptions = {}): Promise<WriteResult> {
    const { before, captions } = await readCaptions(projectRoot, options);
    const result = planCaptionStyleClear({ ...input, captions });
    return commit(projectRoot, before, result.next.captions, result.changed, result.notices, options, 'caption-clear');
}

export async function reapplyCaptionStyle(projectRoot: string,
    input: { targets?: CaptionStyleTarget[]; styles: Parameters<typeof planCaptionStyleReapply>[0]['styles'];
        apply?: Parameters<typeof planCaptionStyleReapply>[0]['apply'] }, options: CaptionWriteOptions = {}):
    Promise<WriteResult & { items: ReturnType<typeof planCaptionStyleReapply>['items'] }> {
    const { before, captions } = await readCaptions(projectRoot, options);
    const result = planCaptionStyleReapply({ ...input, captions });
    const write = await commit(projectRoot, before, result.next?.captions ?? captions,
        result.next ? [options.files?.captions ?? 'captions.json'] : [], result.notices, options, 'caption-reapply');
    return { ...write, items: result.items };
}

export async function setCaptionSize(projectRoot: string,
    input: { targets: Array<{ caption_id: string }>; size_px: number }, options: CaptionWriteOptions = {}): Promise<WriteResult> {
    const { before, captions } = await readCaptions(projectRoot, options);
    const result = planCaptionSizeEdit({ ...input, captions });
    return commit(projectRoot, before, result.next.captions, result.changed, result.notices, options, 'caption-size');
}

export async function applyCaptionLookMigration(projectRoot: string,
    options: CaptionWriteOptions & { dryRun?: boolean } = {}): Promise<WriteResult & {
        diff: ReturnType<typeof planCaptionLookMigration>['diff'] }> {
    const { before, captions } = await readCaptions(projectRoot, options);
    const plan = planCaptionLookMigration(captions, options.catalog
        ?? loadTextstyleCatalogSync({ env: process.env }).catalog, parsed(before[options.files?.edit ?? 'edit.json']));
    const result = await commit(projectRoot, before, plan.next as CaptionRoot,
        plan.diff.length ? [options.files?.captions ?? 'captions.json'] : [], plan.notices, options, 'caption-migrate-look', options.dryRun);
    return { ...result, diff: plan.diff };
}
