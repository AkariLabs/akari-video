import { t } from '@akari-video/i18n';

/**
 * 3D モックアップ（scene3d 素材の three 断片）を置く・画面を差し替える・動きを選ぶための共有の純関数。
 * ライブラリからの配置（タイムライン / プレビュー）とインスペクタの「3D」セクションが同じ規則を使う。
 * 正本: 内部リポの 3D 配置 v0 の設計契約 §2・§4。
 */

/** three ランタイムの標準ツマミ: 動きのプリセット（"" = 断片の既定 / "none" = 止める / クリップ名）。 */
export const SCENE3D_CLIP_VAR = '--akari-3d-clip';
export const SCENE3D_CLIP_NONE = 'none';
/** three ランタイムの標準ツマミ: 向き（度）。X = 画面の横・Y = 真上・Z = 手前。edit-store の ROTATION_3D_VARS と同じ並び。 */
export const SCENE3D_ROTATION_VARS = ['--akari-3d-rot-x', '--akari-3d-rot-y', '--akari-3d-rot-z'] as const;
/** 書き出しが画面の動画を埋め込める上限（packages/overlay-runtime/runtimes.mjs）。 */
export const SCENE3D_MAX_SCREEN_BYTES = 24 * 1024 * 1024;

export interface Scene3dKnob {
    cssVar?: string;
    type?: string;
    options?: unknown[];
    label?: string;
}

export interface Scene3dMotionPreset {
    clip?: unknown;
    label?: unknown;
}

export interface Scene3dMeta {
    category?: unknown;
    knobs?: unknown;
    motion_presets?: unknown;
}

const knobsOf = (meta: Scene3dMeta | undefined): Scene3dKnob[] =>
    Array.isArray(meta?.knobs) ? meta!.knobs.filter((knob): knob is Scene3dKnob => !!knob && typeof knob === 'object') : [];

/** scene3d 素材の断片のパスか（assets/scene3d/<id>/… またはライブラリの scene3d/<id>/…）。 */
export function isScene3dPath(path: string | undefined): boolean {
    return typeof path === 'string' && /(^|\/)scene3d\//u.test(path.replace(/\\/gu, '/'));
}

/**
 * 画面の差し替え先（§4）。断片の 3D 宣言の materialOverrides のうち、名前に Screen を含み textureVar を持つもの
 * （ロゴなどの mask は除く）の textureVar。プレビューと書き出しのホストは、この変数の値を item の source.vars から
 * 取ってプロジェクト基準のパスとして画面に貼る。見つからなければ undefined（「この 3D には画面がありません」）。
 */
export function scene3dScreenTextureVar(fragmentHtml: string | undefined): string | undefined {
    if (typeof fragmentHtml !== 'string') return undefined;
    const html = fragmentHtml.replace(/<!--[\s\S]*?-->/gu, '');
    const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu;
    for (const match of html.matchAll(scripts)) {
        if (!/data-akari-3d-scene/u.test(match[1]) || !/application\/json/u.test(match[1])) continue;
        let descriptor: unknown;
        try { descriptor = JSON.parse(match[2]); } catch { continue; }
        const overrides = (descriptor as { materialOverrides?: unknown } | null)?.materialOverrides;
        if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) continue;
        const candidates = Object.entries(overrides as Record<string, unknown>)
            .filter(([name, value]) => /screen/iu.test(name) && !!value && typeof value === 'object'
                && typeof (value as { textureVar?: unknown }).textureVar === 'string'
                && (value as { target?: unknown }).target !== 'mask')
            .sort(([left], [right]) => Number(right === 'ScreenMaterial') - Number(left === 'ScreenMaterial'));
        const found = candidates[0]?.[1] as { textureVar: string } | undefined;
        if (found && /^--[A-Za-z_][A-Za-z0-9_-]*$/u.test(found.textureVar)) return found.textureVar;
    }
    return undefined;
}

/** 画面に入れるときに source.vars へ書く値（プロジェクト基準の相対パス）。絶対パス・.. は拒否して undefined。 */
export function scene3dScreenVars(screenVar: string | undefined, projectRelativePath: string): Record<string, string> | undefined {
    const path = projectRelativePath.replace(/\\/gu, '/');
    if (!screenVar || !path || path.startsWith('/') || /^[a-z]:/iu.test(path) || path.split('/').includes('..')) return undefined;
    return { [screenVar]: path };
}

/** インスペクタの「動き」の選択肢。先頭は止める。値は --akari-3d-clip に入れる。 */
export function scene3dMotionOptions(meta: Scene3dMeta | undefined): { value: string; label: string }[] {
    const presets = Array.isArray(meta?.motion_presets) ? meta!.motion_presets as Scene3dMotionPreset[] : [];
    const seen = new Set<string>([SCENE3D_CLIP_NONE]);
    const options = [{ value: SCENE3D_CLIP_NONE, label: t('annotationscommon.scene3dItem.label.motionNone') }];
    for (const preset of presets) {
        if (!preset || typeof preset.clip !== 'string' || !preset.clip || seen.has(preset.clip)) continue;
        seen.add(preset.clip);
        options.push({ value: preset.clip, label: typeof preset.label === 'string' && preset.label ? preset.label : preset.clip });
    }
    return options;
}

/**
 * ツマミの自動セクションから外すもの。素材の「画面の中身」系ツマミ（-screen-src / -screen-preset）は断片の CSS の
 * 中で画面の変数へつなぐ作りで、アプリのホストは CSS を評価せずに画面を決めるため効かない。3D セクションの
 * 「画面の中身」が代わりに受け持つ。
 */
export function scene3dOwnedKnobVars(meta: Scene3dMeta | undefined): Set<string> {
    return new Set(knobsOf(meta).map(knob => knob.cssVar)
        .filter((name): name is string => typeof name === 'string' && /-screen-(?:src|preset)$/u.test(name)));
}

/** ライブラリから置いた直後の vars: 既定ツマミ + 静止（動きは後からインスペクタで選ぶ）。回転は書かない（0 扱い）。 */
export function scene3dPlacementVars(defaults: Record<string, string>): Record<string, string> {
    return { ...defaults, [SCENE3D_CLIP_VAR]: SCENE3D_CLIP_NONE };
}
