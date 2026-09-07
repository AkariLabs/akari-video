import { readInternalEdit, type InternalItem } from '@akari-video/edit-store';
import { readFile, realpath } from 'fs/promises';
import { dirname, resolve, relative, isAbsolute, join } from 'path';
import { pathToFileURL } from 'url';
import { expandBagOverlays } from '../common/preview-parts';
import { resolvePreviewItemKeyframes } from '../common/item-keyframes-summary';
import { resolveThreeSceneDescriptorAssets } from '../common/three-scene-assets';
import { visualThumbnailPage, type VisualThumbnailPage } from '../common/visual-thumbnail';
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
                { projectRoot: root, htmlPath: ref, overlayId: itemId }, stream);
            if (rewritten.warnings.length) throw new Error(rewritten.warnings.join('\n'));
            return rewritten.html.slice(7, -8);
        };
        for (const overlay of overlays) {
            const ref = String(overlay.html ?? '');
            let html = htmlByPath.get(ref) ?? ref;
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
        const start = target?.at ?? Number(overlays[0].start);
        const duration = target?.duration ?? Number(overlays[0].duration);
        const output = internal.output;
        return { ...visualThumbnailPage(overlays, {
            width: output.width, height: output.height, fps: output.fps
        }, start + duration / 2, assets), streamIds: streams, dependencyUris: [...dependencies], editSnapshot: snapshot };
    } catch (error) {
        await Promise.all(streams.map(disposeStream));
        throw error;
    }
}
