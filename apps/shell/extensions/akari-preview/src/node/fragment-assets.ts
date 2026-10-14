import { t } from '../common/preview-text';
import { existsSync } from 'fs';
import { dirname, isAbsolute, relative, resolve } from 'path';
import { pathToFileURL } from 'url';
import { FragmentAssetPreviewResult, VideoStreamReference } from '../common/akari-preview-protocol';

interface Reference { raw: string; path: string }
interface FragmentModule {
    extractFragmentAssetReferences(html: string, htmlPath: string): Reference[];
    extractAbsoluteFragmentAssetReferences(html: string, htmlPath: string): Reference[];
    rewriteFragmentAssetUrls(html: string, options: {
        htmlPath: string; urlPrefix: string; resolveUrl(reference: Reference): string | undefined;
    }): string;
}
interface InputModule {
    resolveDeclaredProjectInput(root: string, path: string, role: string): string;
}

let modules: Promise<[FragmentModule, InputModule]> | undefined;
function loadModules(): Promise<[FragmentModule, InputModule]> {
    if (!modules) modules = (async () => {
        const candidates: string[] = [];
        if (typeof process.resourcesPath === 'string') candidates.push(process.resourcesPath);
        let ancestor = resolve(__dirname);
        for (let depth = 0; depth < 10; depth++) {
            candidates.push(ancestor);
            const parent = dirname(ancestor);
            if (parent === ancestor) break;
            ancestor = parent;
        }
        const root = candidates.find(candidate => existsSync(resolve(candidate, 'packages/render-cut/src/fragment-assets.mjs')));
        if (!root) throw new Error('Overlay fragment asset helper could not be found');
        const importModule = Function('specifier', 'return import(specifier)');
        return Promise.all([
            importModule(pathToFileURL(resolve(root, 'packages/render-cut/src/fragment-assets.mjs')).href),
            importModule(pathToFileURL(resolve(root, 'packages/render-cut/src/render-inputs.mjs')).href)
        ]) as Promise<[FragmentModule, InputModule]>;
    })();
    return modules;
}

/** Keep filesystem resolution and the shared Node scanner outside the browser bundle. */
export async function rewritePreviewFragmentAssets(
    html: string,
    options: { projectRoot: string; htmlPath: string; overlayId: string },
    createStream: (uri: string) => Promise<VideoStreamReference>,
    resolveReference?: (declaredPath: string) => Promise<string | undefined>
): Promise<FragmentAssetPreviewResult> {
    const [fragment, inputs] = await loadModules();
    const { projectRoot, htmlPath, overlayId } = options;
    const warnings: string[] = [];
    const streams: FragmentAssetPreviewResult['streams'] = [];
    const unserved: string[] = [];
    const urls = new Map<string, string>();
    for (const reference of fragment.extractFragmentAssetReferences(html, htmlPath)) {
        if (urls.has(reference.path)) continue;
        try {
            const target = (resolveReference && reference.path.replace(/\\/g, '/').startsWith('assets/')
                ? await resolveReference(reference.path) : undefined)
                ?? inputs.resolveDeclaredProjectInput(projectRoot, reference.path, `overlay:${overlayId}:fragment-asset`);
            const uri = pathToFileURL(target).href;
            const stream = await createStream(uri);
            streams.push({ ...stream, uri });
            urls.set(reference.path, stream.url);
        } catch {
            warnings.push(t('preview.fragmentPreview.validation.referenceOverlayFragmentNotFoundCannotServedError', { p1: (overlayId), p2: (htmlPath), p3: (reference.raw) }));
            urls.set(reference.path, `about:invalid#${encodeURIComponent(reference.path)}`);
            // The fragment can be written before its image exists. Report where the image
            // will land so the host can reload once it arrives.
            const candidate = resolve(projectRoot, reference.path);
            const inside = relative(projectRoot, candidate);
            if (inside && !inside.startsWith('..') && !isAbsolute(inside)) unserved.push(pathToFileURL(candidate).href);
        }
    }
    for (const reference of fragment.extractAbsoluteFragmentAssetReferences(html, htmlPath)) {
        warnings.push(t('preview.fragmentPreview.validation.referenceOverlayFragmentMustUsePathRelativeFragmentError', { p1: (overlayId), p2: (htmlPath), p3: (reference.raw) }));
    }
    return {
        html: fragment.rewriteFragmentAssetUrls(html, { htmlPath, urlPrefix: '/', resolveUrl: reference => urls.get(reference.path) }),
        streams, warnings, unserved
    };
}
