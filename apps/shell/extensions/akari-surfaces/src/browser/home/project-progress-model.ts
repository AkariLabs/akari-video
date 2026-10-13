import { t } from '@akari-video/i18n';
/**
 * 進み具合 5 段（契約 `contract-2026-10-08-one-shell-v0.md` §2.4）の純関数。
 * Theia の browser モジュールを import しない（node --test から直接読める）。
 * ファイルの有無だけで決まる。判断を後付けで選ばないよう、判定はここに閉じる。
 *
 * **公開 API（凍結・レーン H / T が共有）**: `ProjectPresence` / `ProjectStage` / `ProjectStageKey` /
 * `computeProjectStages` / `currentStage` / `stageSummary` / `EMPTY_PRESENCE` / `PROJECT_STAGE_LABELS`。
 */
export type ProjectStageKey = 'plan' | 'assets' | 'edit' | 'check' | 'export';

export interface ProjectPresence {
    /** planning/ 配下に .md が 1 つ以上 */
    planningDocs: number;
    /** assets/ 直下のメディア */
    assetFiles: number;
    /** edit.json にタイムライン上の中身がある */
    editHasContent: boolean;
    /** ルートの analysis-report.html か .akari/reports/*.html */
    reportFiles: number;
    /** exports/ 直下の動画 */
    exportFiles: number;
}

export interface ProjectStage {
    key: ProjectStageKey;
    label: string;
    done: boolean;
    /** 済んだときの短い補足（「企画書あり」「6 件」…）。未完なら「まだ」 */
    detail: string;
    /** 「いまここ」 */
    current: boolean;
}

export const PROJECT_STAGE_LABELS: Record<ProjectStageKey, string> = {
    plan: t('surfaces.projects.planning.label'), assets: t('surfaces.projects.assets.label'), edit: t('surfaces.projects.edit.label'), check: t('surfaces.projects.review.label'), export: t('surfaces.projects.export.label')
};

export const EMPTY_PRESENCE: ProjectPresence = { planningDocs: 0, assetFiles: 0, editHasContent: false, reportFiles: 0, exportFiles: 0 };

/** 「いまここ」の段: 最初の未完。ただし 編集あり・確認なし は「編集」（編集の途中）。全部済みなら書き出し。 */
export function currentStage(p: ProjectPresence): ProjectStageKey {
    if (p.editHasContent && p.reportFiles === 0) { return 'edit'; }
    if (p.planningDocs === 0) { return 'plan'; }
    if (p.assetFiles === 0) { return 'assets'; }
    if (!p.editHasContent) { return 'edit'; }
    if (p.reportFiles === 0) { return 'check'; }
    return 'export';
}

export function computeProjectStages(p: ProjectPresence): ProjectStage[] {
    const now = currentStage(p);
    const done: Record<ProjectStageKey, boolean> = {
        plan: p.planningDocs > 0, assets: p.assetFiles > 0, edit: p.editHasContent, check: p.reportFiles > 0, export: p.exportFiles > 0
    };
    const detail: Record<ProjectStageKey, string> = {
        plan: done.plan ? t('surfaces.projects.computeProjectStagesPlanAvailable.label') : t('surfaces.projects.computeProjectStagesYet.label'),
        assets: done.assets ? t('surfaces.projects.computeProjectStagesItems.message', { assetFiles: p.assetFiles, n: p.assetFiles }) : t('surfaces.projects.computeProjectStagesYet.label'),
        edit: done.edit ? t('surfaces.projects.computeProjectStagesEdited.label') : t('surfaces.projects.computeProjectStagesYet.label'),
        check: done.check ? t('surfaces.projects.computeProjectStagesReportAvailable.label') : t('surfaces.projects.computeProjectStagesYet.label'),
        export: done.export ? t('surfaces.projects.computeProjectStagesVideos.message', { exportFiles: p.exportFiles, n: p.exportFiles }) : t('surfaces.projects.computeProjectStagesYet.label')
    };
    return (Object.keys(PROJECT_STAGE_LABELS) as ProjectStageKey[]).map(key => ({
        key, label: PROJECT_STAGE_LABELS[key], done: done[key], detail: detail[key],
        // 書き出しまで済んでいれば「いまここ」は無い（全部 done）
        current: key === now && !(key === 'export' && done.export)
    }));
}

/** 一覧のカードの札（モック v10 の stageOf と同じ語）。 */
export function stageSummary(p: ProjectPresence): string {
    if (p.planningDocs === 0 && p.assetFiles === 0 && !p.editHasContent) { return t('surfaces.projects.projectHomeCreated.label'); }
    if (!p.editHasContent) { return t('surfaces.projects.projectHomeAssetsAdded.label'); }
    if (p.reportFiles === 0) { return t('surfaces.projects.projectHomeEditing.label'); }
    if (p.exportFiles === 0) { return t('surfaces.projects.projectHomeReview.label'); }
    return t('surfaces.projects.projectHomeExported.label');
}
