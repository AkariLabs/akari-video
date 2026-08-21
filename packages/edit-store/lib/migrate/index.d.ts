/**
 * v0/v1 -> v2 凍結変換ユニット。
 *
 * 変換器は機能追加禁止・バグ修正のみ。未知ケースは「このプロジェクトは
 * 変換できません」と正直に止まる。将来 `akari-migrate` へそのまま切り出すため、
 * ファイル変換の意味論はこの 1 ファイルに閉じる。
 */
import type { EditV2 } from '../edit-v2';
export { LegacyEditVersionError } from './error';
export { parseEdit } from './legacy-parse';
export type { EditParseOrigins } from './legacy-parse';
export type LegacyVersion = 0 | 1;
export interface MigrateChange {
    path: string;
    note: string;
}
export type MigrateResult = {
    ok: true;
    version: LegacyVersion;
    doc: EditV2;
    changes: MigrateChange[];
    warnings: string[];
    unresolvedAudioDurations: ReadonlyArray<UnresolvedAudioDuration>;
} | {
    ok: false;
    version: number;
    blockers: string[];
};
export interface UnresolvedAudioDuration {
    trackIndex: number;
    itemIndex: number;
    path: string;
    atSeconds: number;
}
export interface MigrationProposal {
    filePath: string;
    version: LegacyVersion;
    changes: MigrateChange[];
    warnings: string[];
    nextText: string;
    previousText: string;
    backupPath: string;
}
export interface MigrationBlocked {
    ok: false;
    version: number;
    blockers: string[];
}
export declare function detectEditVersion(raw: unknown): number | undefined;
export declare function migrateEditToV2(raw: unknown, options?: {
    hasCaptions?: boolean;
}): MigrateResult;
export declare function planMigration(projectRoot: string, editPath: string, text: string, options?: {
    hasCaptions?: boolean;
    now?: Date;
    ffprobeCommand?: string;
}): MigrationProposal | MigrationBlocked;
/** 承認後のみ実行する。先に .akari/backup/ へ原文を退避し、次に atomic rename する。 */
export declare function applyMigration(proposal: MigrationProposal): Promise<void>;
/** 退避した原文を 1 手で edit.json へ戻す。backup 自体は監査記録として残す。 */
export declare function revertMigration(proposal: MigrationProposal): Promise<void>;
