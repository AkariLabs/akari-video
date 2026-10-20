import { t } from './preview-text';
/**
 * Dependency-free validation and asset-path rewriting for declarative Three.js scenes.
 *
 * The browser open handler supplies the actual asset-stream resolver. Keeping the scene contract
 * here lets node:test cover texts-only scenes without importing Theia browser dependencies.
 */

const FONT_EXTENSION_PATTERN = /\.(?:otf|ttf)$/i;

/**
 * `data-akari-3d-scene` の top-level key 許可リスト（シェル側の事前検査）。
 *
 * three-runtime.js の `ALLOWED_SCENE_KEYS` と**必ず同じ集合**に保つ。ここに無い key は宣言ごと
 * 拒否され `{ model: '' }` に置換されるため、ランタイムだけが受理する key があると
 * 「Web UI / 書き出しでは出るのにシェルのプレビューだけ 3D が空になる」事故になる
 * （environment / shadows で 1 回、fog / background で 1 回起きた）。
 * 一致は test/three-scene-keys-parity.test.mjs が runtime のソースと突き合わせて検査する。
 */
export const THREE_SCENE_KEYS: ReadonlySet<string> = new Set([
    'model',
    'camera',
    'environment',
    'fog',
    'background',
    'lights',
    'animationClip',
    'materialOverrides',
    'finishes',
    'shadows',
    'texts',
    'physics',
    // 描画バックエンドの opt-in（2026-10-21-three-webgpu-backend）。ランタイムと同じく
    // 省略 = "webgl" で、値の検証は three-runtime.js が行う。
    'renderer'
]);

/**
 * パスの出どころ。断片に書かれたパス（model・フォント・環境マップ・既定のテクスチャ）は断片のフォルダ基準、
 * item の source.vars から来たパス（ユーザーが入れた画面の動画など）はプロジェクト基準で探す
 * （内部契約 2026-10-11-3d-place §4）。
 */
export type ThreeSceneAssetOrigin = 'fragment' | 'vars';

export type ThreeSceneAssetResolver = (relativePath: string, field: string, origin: ThreeSceneAssetOrigin) => Promise<string>;

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
        throw new TypeError(t('preview.threeScene.validation.mustRelativeEditJsonError', { p1: (field) }));
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
        throw new TypeError(t('preview.outputPreview.window.dataAkari3DSceneMustJsonObjectError'));
    }
    const source = value as ThreeSceneDescriptor;
    const hasModel = source.model !== undefined;
    if (hasModel) {
        assertRelativeAssetPath(source.model, 'data-akari-3d-scene.model');
    }
    if (source.texts !== undefined && !Array.isArray(source.texts)) {
        throw new TypeError(t('preview.threeScene.validation.dataAkari3DSceneTextsMustArrayError'));
    }
    const texts = source.texts as unknown[] | undefined;
    const hasNonEmptyTexts = Boolean(texts?.length);
    if (!hasModel && !hasNonEmptyTexts) {
        throw new TypeError(
            t('preview.threeScene.validation.sceneRequiresModelOrTextsError')
        );
    }

    const descriptor: ThreeSceneDescriptor = { ...source };
    let modelPath: string | undefined;
    if (hasModel) {
        modelPath = source.model as string;
        descriptor.model = await resolveAsset(modelPath, 'data-akari-3d-scene.model', 'fragment');
    }
    if (texts) {
        const resolvedTexts: Record<string, unknown>[] = [];
        for (const [index, entry] of texts.entries()) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                throw new TypeError(t('preview.threeScene.validation.textsMustObjectError', { p1: (index) }));
            }
            const textDescriptor = entry as Record<string, unknown>;
            const field = `data-akari-3d-scene.texts[${index}].font`;
            assertRelativeAssetPath(textDescriptor.font, field);
            if (!FONT_EXTENSION_PATTERN.test(textDescriptor.font)) {
                throw new TypeError(t('preview.threeScene.validation.mustTtfOtfFileError', { p1: (field) }));
            }
            resolvedTexts.push({
                ...textDescriptor,
                font: await resolveAsset(textDescriptor.font, field, 'fragment')
            });
        }
        descriptor.texts = resolvedTexts;
    }

    if (source.environment?.map !== undefined) {
        assertRelativeAssetPath(source.environment.map, 'data-akari-3d-scene.environment.map');
        descriptor.environment = {
            ...source.environment,
            map: await resolveAsset(source.environment.map, 'data-akari-3d-scene.environment.map', 'fragment')
        };
    }
    if (source.materialOverrides !== undefined) {
        if (!source.materialOverrides || typeof source.materialOverrides !== 'object'
            || Array.isArray(source.materialOverrides)) {
            throw new TypeError(t('preview.threeScene.validation.materialoverridesMustObjectError'));
        }
        const overrides: Record<string, unknown> = Object.create(null);
        for (const [name, value] of Object.entries(source.materialOverrides)) {
            if (!name || !value || typeof value !== 'object' || Array.isArray(value)) {
                throw new TypeError(t('preview.threeScene.validation.materialoverridesMustContainObjectEachMaterialNameError'));
            }
            const override = value as Record<string, unknown>;
            const field = `materialOverrides.${name}.texture`;
            if (typeof override.texture !== 'string' || !override.texture) {
                throw new TypeError(t('preview.threeScene.validation.mustRelativePathError', { p1: (field) }));
            }
            if (override.textureVar !== undefined && (typeof override.textureVar !== 'string'
                || !/^--[A-Za-z_][A-Za-z0-9_-]*$/.test(override.textureVar))) {
                throw new TypeError(t('preview.threeScene.validation.materialoverridesTexturevarMustCssCustomPropertyNameError', { p1: (name) }));
            }
            const variableTexture = typeof override.textureVar === 'string' ? overlayVars[override.textureVar] : undefined;
            let texture = variableTexture || override.texture;
            let origin: ThreeSceneAssetOrigin = variableTexture ? 'vars' : 'fragment';
            const match = typeof texture === 'string' ? /^var\(\s*(--[\w-]+)\s*\)$/.exec(texture) : null;
            if (match) { texture = overlayVars[match[1]]; origin = 'vars'; }
            assertRelativeAssetPath(texture, field);
            // Like export's embedder, resolve the chosen texture once and remove its variable
            // indirection. All non-path material settings are validated by three-runtime.js.
            const resolved: Record<string, unknown> = { ...override, texture: await resolveAsset(texture, field, origin) };
            delete resolved.textureVar;
            overrides[name] = resolved;
        }
        descriptor.materialOverrides = overrides;
    }

    return { descriptor, modelPath };
}

/** Match a JSON script declaration, never text displayed inside a fragment. */
export function threeSceneDeclarations(html: string): string[] {
    const declarations: string[] = [];
    const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
    const scripts = /<script\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/script\s*>/gi;
    for (const match of withoutComments.matchAll(scripts)) {
        const attributes = match[1];
        if (!/(?:^|\s)type\s*=\s*(?:"application\/json"|'application\/json'|application\/json(?=\s|$))/i.test(attributes)) continue;
        if (!/(?:^|\s)data-akari-3d-scene(?=\s|=|$)/i.test(attributes)) continue;
        declarations.push(match[2]);
    }
    return declarations;
}

/** Mirrors render-cut's declaration-time gate for the optional 3D text vendor bundle. */
export function hasThreeDimensionalTextOverlay(overlays: readonly { html: string }[]): boolean {
    return overlays.some(overlay => threeSceneDeclarations(overlay.html).some(body => {
        try {
            const descriptor: unknown = JSON.parse(body);
            return Boolean(descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor)
                && Array.isArray((descriptor as { texts?: unknown }).texts));
        } catch { return false; }
    }));
}
