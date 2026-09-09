import { readInternalEdit, type InternalItem } from '@akari-video/edit-store';
import { readFile, realpath, readdir, stat } from 'fs/promises';
import { dirname, resolve, relative, isAbsolute, join } from 'path';
import { pathToFileURL } from 'url';
import { expandBagOverlays } from '../common/preview-parts';
import { resolvePreviewItemKeyframes } from '../common/item-keyframes-summary';
import { resolveThreeSceneDescriptorAssets } from '../common/three-scene-assets';
import { visualThumbnailPage, visualThumbnailSampleTimes, type VisualThumbnailPage } from '../common/visual-thumbnail';
import type { OverlayRuntimeAssetUrls, VideoStreamReference } from '../common/akari-preview-protocol';
import { rewritePreviewFragmentAssets } from './fragment-assets';

export async function prepareVisualThumbnailPage(
    editPath: string, itemId: string, assets: OverlayRuntimeAssetUrls,
    createStream: (uri: string) => Promise<VideoStreamReference>, disposeStream: (id: string) => Promise<void>,
    editSnapshot?: string
): Promise<VisualThumbnailPage> {
    const root = await realpath(dirname(editPath));
    const dependencies = new Set<string>();
    const localPath = async (path: string): Promise<string> => {
        const target = await realpath(resolve(root, path));
        const rel = relative(root, target);
        if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) {
            throw new Error('Thumbnail input is outside the project');
        }
        dependencies.add(pathToFileURL(target).href);
        return target;
    };
    const snapshot = editSnapshot ?? await readFile(editPath, 'utf8');
    const internal = readInternalEdit(snapshot);
    const selected = new Set<string>([itemId]);
    let target: InternalItem | undefined;
    const collect = (item: InternalItem, include = false): void => {
        if (item.id === itemId) { target = item; include = true; }
        if (include) selected.add(item.id);
        for (const child of item.children) collect(child, include);
    };
    for (const track of internal.tracks) for (const item of track.items) collect(item);
    // Implicit HTML parts use <bag>#<part> ids and are projected by expandBagOverlays.
    const htmlByPath = new Map<string, string>();
    const htmlPathById = new Map<string, string>();
    const readHtml = async (item: InternalItem): Promise<void> => {
        if (item.source.kind === 'html') {
            const ref = item.source.html;
            htmlPathById.set(item.id, ref);
            if (!htmlByPath.has(ref)) htmlByPath.set(ref, ref.trimStart().startsWith('<')
                ? ref : await readFile(await localPath(ref), 'utf8'));
        }
        for (const child of item.children) await readHtml(child);
    };
    // Prune unrelated tracks/subtrees before reading their files.
    const relevant = (item: InternalItem): boolean => selected.has(item.id)
        || itemId.startsWith(`${item.id}#`) || item.children.some(relevant);
    const prune = (item: InternalItem): InternalItem => {
        if (!target && item.source.kind === 'html' && itemId.startsWith(`${item.id}#`)) {
            target = { ...item, id: itemId, parentId: item.id,
                source: { ...item.source, part: itemId.slice(item.id.length + 1) }, children: [] };
            return target;
        }
        return { ...item, children: item.children.filter(relevant).map(prune) };
    };
    internal.tracks = internal.tracks.map(track => ({ ...track, items: track.items.filter(relevant).map(prune) }));
    for (const track of internal.tracks) for (const item of track.items) await readHtml(item);
    await resolvePreviewItemKeyframes(internal, { readText: async path => readFile(await localPath(path), 'utf8') });
    const overlays = expandBagOverlays(internal, ref => htmlByPath.get(ref) ?? ref)
        .filter(value => selected.has(String(value.id)) || selected.has(String(value.parentId)));
    if (!overlays.length) throw new Error('This item has no renderable overlay');
    const start = target?.at ?? Number(overlays[0].start);
    const duration = target?.duration ?? Number(overlays[0].duration);
    return { ...await buildVisualThumbnailPage(overlays, { width: internal.output.width, height: internal.output.height, fps: internal.output.fps }, visualThumbnailSampleTimes(start, duration), assets,
        root, createStream, disposeStream, { dependencies, htmlByPath, htmlPathById }), editSnapshot: snapshot };
}

/** The shared asset rewriting/stream lifetime and renderer path for clips and material cards. */
export async function buildVisualThumbnailPage(
    overlays: Record<string, unknown>[], output: { width: number; height: number; fps: number }, times: number | readonly number[],
    assets: OverlayRuntimeAssetUrls, root: string,
    createStream: (uri: string) => Promise<VideoStreamReference>, disposeStream: (id: string) => Promise<void>,
    inputs: { dependencies?: Set<string>; htmlByPath?: Map<string, string>; htmlPathById?: Map<string, string> } = {}
): Promise<VisualThumbnailPage> {
    const { dependencies = new Set<string>(), htmlByPath = new Map<string, string>(), htmlPathById = new Map<string, string>() } = inputs;
    const localPath = async (path: string): Promise<string> => {
        const target = await realpath(resolve(root, path));
        const rel = relative(root, target);
        if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) {
            throw new Error('Thumbnail input is outside the project');
        }
        dependencies.add(pathToFileURL(target).href);
        return target;
    };
    const streams: string[] = [];
    const streamByUri = new Map<string, VideoStreamReference>();
    const stream = async (uri: string): Promise<VideoStreamReference> => {
        const existing = streamByUri.get(uri);
        if (existing) return existing;
        const created = await createStream(uri);
        dependencies.add(uri);
        streams.push(created.id); streamByUri.set(uri, created);
        return created;
    };
    try {
        const stylesheet = async (ref: string, ancestors: string[] = []): Promise<string> => {
            if (ancestors.includes(ref) || ancestors.length >= 8) throw new Error('Cyclic or deeply nested thumbnail stylesheet');
            let css = await readFile(await localPath(ref), 'utf8');
            const imports = [...css.matchAll(/@import\s+(?:url\(\s*["']?([^"')]+)["']?\s*\)|"([^"]+)"|'([^']+)')\s*([^;]*);/gi)];
            for (const match of imports) {
                const importedRef = match[1] ?? match[2] ?? match[3];
                if (/^(?:[a-z]+:|\/|\\)/i.test(importedRef)) throw new Error('Thumbnail stylesheet imports must be project relative');
                const imported = await stylesheet(join(dirname(ref), importedRef), [...ancestors, ref]);
                // Imported CSS is already rewritten relative to its own file.
                css = css.replace(match[0], match[4].trim() ? `@media ${match[4]}{${imported}}` : imported);
            }
            const rewritten = await rewritePreviewFragmentAssets(`<style>${css}</style>`,
                { projectRoot: root, htmlPath: ref, overlayId: String(overlays[0].id) }, stream);
            if (rewritten.warnings.length) throw new Error(rewritten.warnings.join('\n'));
            return rewritten.html.slice(7, -8);
        };
        for (const overlay of overlays) {
            const ref = String(overlay.html ?? '');
            let html = htmlByPath.get(ref) ?? (ref.trimStart().startsWith('<') ? ref : await readFile(await localPath(ref), 'utf8'));
            const originalRef = htmlPathById.get(String(overlay.id)) ?? htmlPathById.get(String(overlay.parentId)) ?? ref;
            const htmlPath = originalRef.trimStart().startsWith('<') ? 'inline.html' : originalRef;
            for (const match of [...html.matchAll(/<link\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)]) {
                const attributes = new Map([...match[0].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
                    .map(attr => [attr[1].toLowerCase(), attr[2] ?? attr[3] ?? attr[4]]));
                if (attributes.get('rel')?.toLowerCase() !== 'stylesheet') continue;
                const href = attributes.get('href');
                if (!href || /^(?:[a-z]+:|\/|\\)/i.test(href)) throw new Error('Thumbnail stylesheets must be project relative');
                html = html.replace(match[0], `<style>${await stylesheet(join(dirname(htmlPath), href))}</style>`);
            }
            const rewritten = await rewritePreviewFragmentAssets(html, { projectRoot: root, htmlPath, overlayId: String(overlay.id) }, stream);
            if (rewritten.warnings.length) throw new Error(rewritten.warnings.join('\n'));
            html = rewritten.html;
            const vars = overlay.vars && typeof overlay.vars === 'object' && !Array.isArray(overlay.vars)
                ? Object.fromEntries(Object.entries(overlay.vars).map(([key, value]) => [key, String(value)])) : {};
            const scenes = [...html.matchAll(/<script\b[^>]*data-akari-3d-scene[^>]*>([\s\S]*?)<\/script\s*>/gi)];
            for (const scene of scenes) {
                const asset = async (path: string): Promise<string> => (await stream(pathToFileURL(await localPath(path)).href)).url;
                const { descriptor } = await resolveThreeSceneDescriptorAssets(JSON.parse(scene[1]), asset, vars);
                html = html.replace(scene[0], scene[0].replace(scene[1], JSON.stringify(descriptor).replace(/</g, '\\u003c')));
            }
            overlay.html = html;
        }
        return { ...visualThumbnailPage(overlays, output, times, assets), streamIds: streams, dependencyUris: [...dependencies] };
    } catch (error) {
        await Promise.all(streams.map(disposeStream));
        throw error;
    }
}

/** Resolve groups here so the material tree's click-target policy remains independent. */
export async function prepareAssetVisualThumbnailPage(
    assetPath: string, workspaceRoot: string, time: number | undefined, assets: OverlayRuntimeAssetUrls,
    createStream: (uri: string) => Promise<VideoStreamReference>, disposeStream: (id: string) => Promise<void>
): Promise<VisualThumbnailPage & { assetUri: string; duration: number; time: number; mtime: number; size: number }> {
    const contained = async (path: string): Promise<string> => {
        const target = await realpath(path);
        const rel = relative(workspaceRoot, target);
        if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) {
            throw new Error('Thumbnail input is outside the workspace');
        }
        return target;
    };
    let path = await contained(assetPath);
    if ((await stat(path)).isDirectory() || /[\\/]meta\.json$/i.test(path)) {
        const directory = (await stat(path)).isDirectory() ? path : dirname(path);
        const names = (await readdir(directory)).filter(name => /\.html?$/i.test(name)).sort();
        const name = names.find(name => name === 'overlay.html') ?? names.find(name => name === 'index.html') ?? names[0];
        if (!name) throw new Error('Material group has no HTML fragment');
        path = await contained(join(directory, name));
    }
    if (!/\.html?$/i.test(path)) throw new Error('Material must be an HTML fragment');
    const metadata = await stat(path);
    const html = await readFile(path, 'utf8');
    // Styles/scripts may precede the fragment root; only inspect the first content element.
    const markup = html.replace(/<!--[\s\S]*?-->|<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>|<link\b[^>]*>|<!doctype[^>]*>/gi, '');
    const rootTag = markup.match(/<[a-z][^>]*>/i)?.[0] ?? '';
    const declared = Number(rootTag.match(/\bdata-duration\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.slice(1).find(value => value !== undefined));
    const duration = Number.isFinite(declared) && declared > 0 ? declared : 5;
    if (time !== undefined && (!Number.isFinite(time) || time < 0 || time >= duration)) throw new Error('Invalid thumbnail time');
    const at = time ?? duration / 2;
    let root = dirname(path);
    let output = { width: 1920, height: 1080, fps: 30 };
    for (;;) {
        try {
            const editPath = await contained(join(root, 'edit.json'));
            const declaredOutput = JSON.parse(await readFile(editPath, 'utf8'))?.output;
            const positive = (value: unknown, fallback: number): number =>
                typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
            output = { width: positive(declaredOutput?.width, 1920), height: positive(declaredOutput?.height, 1080),
                fps: positive(declaredOutput?.fps, 30) };
            break;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (root === workspaceRoot) break;
        root = dirname(root);
    }
    const assetUri = pathToFileURL(path).href;
    const page = await buildVisualThumbnailPage([{ id: 'asset', html: path, start: 0, duration }], output, at,
        assets, root, createStream, disposeStream, { htmlByPath: new Map([[path, html]]), dependencies: new Set([assetUri]) });
    return { ...page, assetUri, duration, time: at, mtime: metadata.mtimeMs, size: metadata.size };
}
