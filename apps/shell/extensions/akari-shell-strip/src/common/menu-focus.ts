export type AkariMenuSectionId = 'open' | 'skills';

export interface AkariMenuFocusArgs {
    /** 節 id。省略時はメニューを開いて前面化するだけ（スクロール・強調はしない）。 */
    section?: AkariMenuSectionId;
    /** true でその節の見出し（section が 'skills' かつ skill 指定時はその行）を
     *  約 1.6 秒間、脈打つ強調表示にする。省略時は false 相当。 */
    pulse?: boolean;
    /** section が 'skills' のときだけ意味を持つ。今読み込まれているスキルの
     *  name と完全一致する行を対象にする。一致しなければ何もせず false。 */
    skill?: string;
}

export const AKARI_MENU_PULSE_MS = 1600;

export function isAkariMenuSectionId(value: unknown): value is AkariMenuSectionId {
    return value === 'open' || value === 'skills';
}

/**
 * 生の（型付けされていない）引数を検証しつつ正規化する。
 * - 引数省略（undefined/null）→ {}（有効・スクロールなし）
 * - オブジェクト以外／未知の section／pulse が boolean でない／skill が string でない
 *   ／skill 指定なのに section が 'skills' でない → undefined（不正）
 */
export function readAkariMenuFocusArgs(raw: unknown): AkariMenuFocusArgs | undefined {
    if (raw === undefined || raw === null) {
        return {};
    }
    if (typeof raw !== 'object') {
        return undefined;
    }
    const { section, pulse, skill } = raw as Record<string, unknown>;
    if (section !== undefined && !isAkariMenuSectionId(section)) {
        return undefined;
    }
    if (pulse !== undefined && typeof pulse !== 'boolean') {
        return undefined;
    }
    if (skill !== undefined && typeof skill !== 'string') {
        return undefined;
    }
    if (skill !== undefined && section !== 'skills') {
        return undefined;
    }
    const args: AkariMenuFocusArgs = {};
    if (section !== undefined) {
        args.section = section as AkariMenuSectionId;
    }
    if (pulse !== undefined) {
        args.pulse = pulse as boolean;
    }
    if (skill !== undefined) {
        args.skill = skill as string;
    }
    return args;
}
