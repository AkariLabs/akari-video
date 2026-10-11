/**
 * 3D モックアップ（scene3d 素材の three 断片）を置く・画面を差し替える・動きを選ぶための共有の純関数。
 * ライブラリからの配置（タイムライン / プレビュー）とインスペクタの「3D」セクションが同じ規則を使う。
 * 正本: 内部リポ planning/contract-2026-10-11-3d-place-v0.md §2・§4。
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

export interface Scene3dScreenKnobs {
    /** 画面に映す画像・動画のツマミ（type: media・cssVar が -screen-src で終わる）。 */
    src: string;
    /** 画面の中身のプリセット（dropdown・-screen-preset で終わり、options に custom を含む）。 */
    preset?: string;
}

const knobsOf = (meta: Scene3dMeta | undefined): Scene3dKnob[] =>
    Array.isArray(meta?.knobs) ? meta!.knobs.filter((knob): knob is Scene3dKnob => !!knob && typeof knob === 'object') : [];

/** scene3d 素材の断片のパスか（assets/scene3d/<id>/… またはライブラリの scene3d/<id>/…）。 */
export function isScene3dPath(path: string | undefined): boolean {
    return typeof path === 'string' && /(^|\/)scene3d\//u.test(path.replace(/\\/gu, '/'));
}

/** §4 の順で画面のツマミを探す。無ければ undefined（「この 3D には画面がありません」）。 */
export function scene3dScreenKnobs(meta: Scene3dMeta | undefined): Scene3dScreenKnobs | undefined {
    const knobs = knobsOf(meta);
    const src = knobs.find(knob => knob.type === 'media' && typeof knob.cssVar === 'string'
        && knob.cssVar.endsWith('-screen-src'))?.cssVar;
    if (!src) return undefined;
    const preset = knobs.find(knob => knob.type === 'dropdown' && typeof knob.cssVar === 'string'
        && knob.cssVar.endsWith('-screen-preset') && Array.isArray(knob.options) && knob.options.includes('custom'))?.cssVar;
    return preset ? { src, preset } : { src };
}

/** 画面に入れるときに source.vars へまとめて書く値（src とプリセット custom を一度に）。 */
export function scene3dScreenVars(meta: Scene3dMeta | undefined, projectRelativePath: string): Record<string, string> | undefined {
    const knobs = scene3dScreenKnobs(meta);
    const path = projectRelativePath.replace(/\\/gu, '/');
    if (!knobs || !path || path.startsWith('/') || /^[a-z]:/iu.test(path) || path.split('/').includes('..')) return undefined;
    return knobs.preset ? { [knobs.preset]: 'custom', [knobs.src]: path } : { [knobs.src]: path };
}

/** インスペクタの「動き」の選択肢。先頭は止める。値は --akari-3d-clip に入れる。 */
export function scene3dMotionOptions(meta: Scene3dMeta | undefined): { value: string; label: string }[] {
    const presets = Array.isArray(meta?.motion_presets) ? meta!.motion_presets as Scene3dMotionPreset[] : [];
    const seen = new Set<string>([SCENE3D_CLIP_NONE]);
    const options = [{ value: SCENE3D_CLIP_NONE, label: 'なし（止める）' }];
    for (const preset of presets) {
        if (!preset || typeof preset.clip !== 'string' || !preset.clip || seen.has(preset.clip)) continue;
        seen.add(preset.clip);
        options.push({ value: preset.clip, label: typeof preset.label === 'string' && preset.label ? preset.label : preset.clip });
    }
    return options;
}

/** ツマミの自動セクションから外すもの（3D セクションが受け持つ画面ツマミ）。 */
export function scene3dOwnedKnobVars(meta: Scene3dMeta | undefined): Set<string> {
    const knobs = scene3dScreenKnobs(meta);
    return new Set(knobs ? [knobs.src, ...(knobs.preset ? [knobs.preset] : [])] : []);
}

/** ライブラリから置いた直後の vars: 既定ツマミ + 静止（動きは後からインスペクタで選ぶ）。回転は書かない（0 扱い）。 */
export function scene3dPlacementVars(defaults: Record<string, string>): Record<string, string> {
    return { ...defaults, [SCENE3D_CLIP_VAR]: SCENE3D_CLIP_NONE };
}
