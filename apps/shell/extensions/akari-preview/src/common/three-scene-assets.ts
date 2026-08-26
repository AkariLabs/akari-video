/**
 * Dependency-free validation and asset-path rewriting for declarative Three.js scenes.
 *
 * The browser open handler supplies the actual asset-stream resolver. Keeping the scene contract
 * here lets node:test cover texts-only scenes without importing Theia browser dependencies.
 */

const FONT_EXTENSION_PATTERN = /\.(?:otf|ttf)$/i;

export type ThreeSceneAssetResolver = (relativePath: string, field: string) => Promise<string>;

export interface ThreeSceneDescriptor extends Record<string, unknown> {
    environment?: { map?: unknown };
    materialOverrides?: unknown;
    model?: unknown;
    texts?: unknown;
}

export interface ResolvedThreeSceneDescriptor {
    descriptor: ThreeSceneDescriptor;
    modelPath?: string;
}

function assertRelativeAssetPath(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string'
        || !value
        || value.startsWith('/')
        || value.startsWith('\\')
        || /^[a-z][a-z\d+.-]*:/i.test(value)) {
        throw new TypeError(`${field} は edit.json 相対パスである必要があります`);
    }
}

/**
 * Validates the shell-side scene boundary and rewrites local model/font paths to asset streams.
 * Runtime-specific validation of camera, text animation, and physics values remains owned by
 * three-runtime.js; this helper only handles the assets that cannot be fetched as project paths
 * from a sandboxed webview.
 */
export async function resolveThreeSceneDescriptorAssets(
    value: unknown,
    resolveAsset: ThreeSceneAssetResolver
): Promise<ResolvedThreeSceneDescriptor> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('data-akari-3d-scene は JSON object である必要があります');
    }
    const source = value as ThreeSceneDescriptor;
    const hasModel = source.model !== undefined;
    if (hasModel) {
        assertRelativeAssetPath(source.model, 'data-akari-3d-scene.model');
    }
    if (source.texts !== undefined && !Array.isArray(source.texts)) {
        throw new TypeError('data-akari-3d-scene.texts は配列である必要があります');
    }
    const texts = source.texts as unknown[] | undefined;
    const hasNonEmptyTexts = Boolean(texts?.length);
    if (!hasModel && !hasNonEmptyTexts) {
        throw new TypeError(
            'data-akari-3d-scene は model または非空の texts[] の少なくとも一方を必要とします'
        );
    }

    const descriptor: ThreeSceneDescriptor = { ...source };
    let modelPath: string | undefined;
    if (hasModel) {
        modelPath = source.model as string;
        descriptor.model = await resolveAsset(modelPath, 'data-akari-3d-scene.model');
    }
    if (texts) {
        const resolvedTexts: Record<string, unknown>[] = [];
        for (const [index, entry] of texts.entries()) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                throw new TypeError(`texts[${index}] は object である必要があります`);
            }
            const textDescriptor = entry as Record<string, unknown>;
            const field = `data-akari-3d-scene.texts[${index}].font`;
            assertRelativeAssetPath(textDescriptor.font, field);
            if (!FONT_EXTENSION_PATTERN.test(textDescriptor.font)) {
                throw new TypeError(`${field} は .ttf または .otf である必要があります`);
            }
            resolvedTexts.push({
                ...textDescriptor,
                font: await resolveAsset(textDescriptor.font, field)
            });
        }
        descriptor.texts = resolvedTexts;
    }

    return { descriptor, modelPath };
}

/** Mirrors render-cut's declaration-time gate for the optional 3D text vendor bundle. */
export function hasThreeDimensionalTextOverlay(overlays: readonly { html: string }[]): boolean {
    return overlays.some(overlay =>
        overlay.html.includes('data-akari-3d-scene') && overlay.html.includes('"texts"')
    );
}
