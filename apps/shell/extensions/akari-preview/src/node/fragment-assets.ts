import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
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
    createStream: (uri: string) => Promise<VideoStreamReference>
): Promise<FragmentAssetPreviewResult> {
    const [fragment, inputs] = await loadModules();
    const { projectRoot, htmlPath, overlayId } = options;
    const warnings: string[] = [];
    const streams: FragmentAssetPreviewResult['streams'] = [];
    const urls = new Map<string, string>();
    for (const reference of fragment.extractFragmentAssetReferences(html, htmlPath)) {
        if (urls.has(reference.path)) continue;
        try {
            const target = inputs.resolveDeclaredProjectInput(projectRoot, reference.path, `overlay:${overlayId}:fragment-asset`);
            const uri = pathToFileURL(target).href;
            const stream = await createStream(uri);
            streams.push({ ...stream, uri });
            urls.set(reference.path, stream.url);
        } catch {
            warnings.push(`overlay:${overlayId} fragment ${htmlPath} の参照 "${reference.raw}" が見つからない、または配信できない`);
            urls.set(reference.path, `about:invalid#${encodeURIComponent(reference.path)}`);
        }
    }
    for (const reference of fragment.extractAbsoluteFragmentAssetReferences(html, htmlPath)) {
        warnings.push(`overlay:${overlayId} fragment ${htmlPath} の参照 "${reference.raw}": 断片からの相対パスで書く`);
    }
    return {
        html: fragment.rewriteFragmentAssetUrls(html, { htmlPath, urlPrefix: '/', resolveUrl: reference => urls.get(reference.path) }),
        streams, warnings
    };
}
