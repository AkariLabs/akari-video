/**
 * 左端のアイコン列（activity bar）の住人の ID — 1 枚の画面 v0（契約 §2.1）。
 *
 * 拡張どうしは型を import できない組み合わせがある（akari-surfaces → akari-shell-strip は可、
 * 逆は不可）ので、widget / 擬似タブの ID はここで文字列として凍結し、各拡張はこの値と
 * 一致する文字列を自分の widget に書く。一致はテストで照合する。
 */

/** ≡ — 押すと列そのものが横に広がり、名前と説明が読める（擬似タブ）。 */
export const RAIL_EXPAND_ID = 'akari-rail-expand';
/** プロジェクト（大きめ）— 素材 widget をプロジェクトのセグメントで開く（擬似タブ）。 */
export const RAIL_PROJECT_OPENER_ID = 'akari-project-opener';
/** ライブラリ — 素材 widget をライブラリのセグメントで開く（擬似タブ）。 */
export const RAIL_LIBRARY_OPENER_ID = 'akari-library-opener';
/** スキル — パートナーに頼める決まった仕事の一覧（左パネルの実タブ）。 */
export const RAIL_SKILLS_WIDGET_ID = 'akari-skills-widget';
/** 書き出し — 押すと書き出しの画面が直接開く（擬似タブ）。 */
export const RAIL_EXPORT_OPENER_ID = 'akari-export-opener';
/** チャンネル — 切り替え・チャンネルについて・プロジェクト一覧（左パネルの実タブ、akari-surfaces が実装）。 */
export const RAIL_CHANNEL_WIDGET_ID = 'akari-channel-widget';
/** 開発者 — 開発者モードのときだけ。設定の開発者節を開く（擬似タブ）。 */
export const RAIL_DEVELOPER_OPENER_ID = 'akari-developer-opener';
/** 設定（既存の擬似タブ）。 */
export const RAIL_SETTINGS_OPENER_ID = 'akari-settings-opener';
/** 素材 widget（akari-project）。タブは隠し、プロジェクト / ライブラリの擬似タブから開く。 */
export const RAIL_ROLE_BUCKETS_WIDGET_ID = 'akari-role-buckets-widget';

/** 真ん中のタブ。 */
export const HOME_WIDGET_ID = 'akari-home-widget';
export const PROJECT_LIST_WIDGET_ID = 'akari-project-list-widget';

/** 場所（契約 §1 裁定 1）。body[data-akari-scope] と context key `akari.scope` に同じ値が出る。 */
export type AkariScope = 'channel' | 'project';
export const AKARI_SCOPE_CONTEXT_KEY = 'akari.scope';
export const AKARI_SCOPE_BODY_ATTRIBUTE = 'data-akari-scope';

/** パートナーが作業中（契約 §2.3）。akari-partner が書き、ホーム・帯が読む。 */
export const AKARI_PARTNER_BUSY_CONTEXT_KEY = 'akari.partner.busy';

/** 素材 widget のセグメント。akari-project が body[data-akari-catalog-tab] に書く。 */
export const AKARI_CATALOG_TAB_BODY_ATTRIBUTE = 'data-akari-catalog-tab';

/** 最後にいたチャンネル（localStorage）。 */
export const AKARI_LAST_CHANNEL_STORAGE_KEY = 'akari.home.lastChannel';
/** 右のパネルで最後に選んだタブ（localStorage・アプリ全体で 1 つ）。 */
export const AKARI_RIGHT_RAIL_LAST_TAB_STORAGE_KEY = 'akari.rightRail.lastTab';
/** 「次から聞かずに、この画面で開く」（preference）。 */
export const AKARI_OPEN_PROJECT_WITHOUT_ASKING_PREFERENCE = 'akari.home.openProjectWithoutAsking';

/** コマンド ID（契約 §2.2）。 */
export const AKARI_COMMANDS = {
    openProject: 'akari.home.openProject',
    openProjectList: 'akari.home.openProjectList',
    closeProject: 'akari.home.closeProject',
    partnerTypePrompt: 'akari.partner.typePrompt',
    partnerIsBusy: 'akari.partner.isBusy',
    partnerOpen: 'akari.partner.open',
    previewServerOpen: 'akari.previewServer.open',
    projectCleanData: 'akari.project.cleanData',
    railToggleExpanded: 'akari.rail.toggleExpanded',
    catalogOpen: 'akari.catalog.open',
    exportOpenDialog: 'akari.export.openDialog',
    settingsOpen: 'akari.settings.open',
    homeOpen: 'akari.home.open',
    previewEnsureVisible: 'akari.preview.ensureVisible'
} as const;

/** 書き出しの擬似タブに付ける、オンボーディングの照準。 */
export const EXPORT_ONBOARDING_TARGET = 'export-button';
