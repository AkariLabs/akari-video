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
    resolveAsset: ThreeSceneAssetResolver,
    overlayVars: Record<string, string> = {}
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

    if (source.environment?.map !== undefined) {
        assertRelativeAssetPath(source.environment.map, 'data-akari-3d-scene.environment.map');
        descriptor.environment = {
            ...source.environment,
            map: await resolveAsset(source.environment.map, 'data-akari-3d-scene.environment.map')
        };
    }
    if (source.materialOverrides !== undefined) {
        if (!source.materialOverrides || typeof source.materialOverrides !== 'object'
            || Array.isArray(source.materialOverrides)) {
            throw new TypeError('materialOverrides は object である必要があります');
        }
        const overrides: Record<string, unknown> = Object.create(null);
        for (const [name, value] of Object.entries(source.materialOverrides)) {
            if (!name || !value || typeof value !== 'object' || Array.isArray(value)) {
                throw new TypeError('materialOverrides は material 名ごとの object である必要があります');
            }
            const override = value as Record<string, unknown>;
            const field = `materialOverrides.${name}.texture`;
            if (typeof override.texture !== 'string' || !override.texture) {
                throw new TypeError(`${field} は相対パスである必要があります`);
            }
            if (override.textureVar !== undefined && (typeof override.textureVar !== 'string'
                || !/^--[A-Za-z_][A-Za-z0-9_-]*$/.test(override.textureVar))) {
                throw new TypeError(`materialOverrides.${name}.textureVar は CSS カスタムプロパティ名である必要があります`);
            }
            const variableTexture = typeof override.textureVar === 'string' ? overlayVars[override.textureVar] : undefined;
            let texture = variableTexture || override.texture;
            const match = typeof texture === 'string' ? /^var\(\s*(--[\w-]+)\s*\)$/.exec(texture) : null;
            if (match) texture = overlayVars[match[1]];
            assertRelativeAssetPath(texture, field);
            // Like export's embedder, resolve the chosen texture once and remove its variable
            // indirection. All non-path material settings are validated by three-runtime.js.
            const resolved: Record<string, unknown> = { ...override, texture: await resolveAsset(texture, field) };
            delete resolved.textureVar;
            overrides[name] = resolved;
        }
        descriptor.materialOverrides = overrides;
    }

    return { descriptor, modelPath };
}

/** Mirrors render-cut's declaration-time gate for the optional 3D text vendor bundle. */
export function hasThreeDimensionalTextOverlay(overlays: readonly { html: string }[]): boolean {
    return overlays.some(overlay =>
        overlay.html.includes('data-akari-3d-scene') && overlay.html.includes('"texts"')
    );
}
