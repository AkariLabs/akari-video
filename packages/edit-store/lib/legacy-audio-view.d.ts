import type { InternalEdit } from './internal-model';
export type LegacyAudioDeclaration = Record<string, unknown>;
/**
 * tracks-first の内部表現を、旧 audio 消費者が読む形へ射影したビュー。
 * 生の edit.json.audio は参照せず、同じ宣言を二重に列挙しない。
 */
export interface LegacyAudioView {
    bgm?: LegacyAudioDeclaration;
    sfx: LegacyAudioDeclaration[];
    narration: LegacyAudioDeclaration[];
    speech?: LegacyAudioDeclaration[];
}
/**
 * 内部表現の audio item だけから legacy audio 形を組み立てる純関数。
 * render-cut の互換射影と同じく legacy.index 順で処理し、bgm は単数として後勝ちにする。
 */
export declare function projectLegacyAudioView(internal: InternalEdit): LegacyAudioView;
