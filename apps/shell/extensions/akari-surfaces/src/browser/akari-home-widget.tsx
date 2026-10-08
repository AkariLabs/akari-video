import * as React from '@theia/core/shared/react';
import { Message } from '@theia/core/shared/@lumino/messaging';
import URI from '@theia/core/lib/common/uri';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandRegistry, CommandService, MessageService } from '@theia/core/lib/common';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { ApplicationShell, OpenerService, open, QuickInputService, WidgetManager } from '@theia/core/lib/browser';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { ApplicationServer } from '@theia/core/lib/common/application-protocol';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { isOSX, isWindows } from '@theia/core/lib/common/os';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { FileStat, FileOperationResult, toFileOperationResult } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { WorkspaceCommands } from '@theia/workspace/lib/browser/workspace-commands';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { ContextKeyService } from '@theia/core/lib/browser/context-key-service';
import { captionSourcePathRule } from 'akari-project/lib/common/caption-source-path-rule';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import {
    IntakeAutonomy,
    IntakeDurationChoice,
    IntakeTaskId,
    INTAKE_AUTONOMY_DESCRIPTIONS,
    INTAKE_AUTONOMY_LABELS,
    INTAKE_AUTONOMY_ORDER,
    INTAKE_DEFAULT_AUTONOMY,
    INTAKE_DEFAULT_DURATION,
    INTAKE_DURATION_LABELS,
    INTAKE_DURATION_ORDER,
    INTAKE_TASK_DEFAULTS,
    INTAKE_TASK_DESCRIPTIONS,
    INTAKE_TASK_IDS,
    INTAKE_TASK_LABELS,
    durationChoiceToTarget
} from '../common/intake-labels';
import {
    resolveUpdateFeedUrl,
    ShellPlatformKey,
    UpdateCache,
    UpdateStatus,
    evaluateUpdateStatus,
    parseUpdateCache,
    resolveUpdateDownloadUrl,
    withDismissedVersion
} from '../common/update-feed';
import {
    applyImmediateUpdaterFallback,
    applyShellUpdaterEvent,
    beginUserInitiatedUpdaterCheck,
    checkForShellUpdatesOnHomeShow,
    INITIAL_SHELL_UPDATER_UI_STATE,
    reconcileVisibleUpdateEvent,
    resolveUpdateChannel,
    resolveUpdateButtonAction,
    shouldOpenUpdaterBrowserFallback,
    ShellUpdaterUiState
} from '../common/shell-update-applier';
import { ElectronAkariUpdaterApi, ShellUpdaterEvent } from '../electron-common/electron-api';
import {
    buildReleaseNotesUrl,
    evaluateVersionNotice,
    formatVersionNoticeText,
    parseShellLastVersion,
    withRecordedVersion
} from '../common/shell-version-notice';
import {
    AkariNewProjectService
} from '../common/akari-new-project-protocol';
import { FirstRunSetupOpenMode } from '../common/first-run-onboarding';
import { parseIntakeTitle, resolveProjectDisplayName } from '../common/project-display-name';
import { AkariFirstRunSetupDialog } from './akari-first-run-setup-dialog';
import { runAutomaticNetworkCheck } from '../common/automatic-network-check';
import { AkariSettingsMaintenanceService } from '../common/settings-maintenance-protocol';
import { AkariOnboardingService } from '../onboarding/protocol';
import { OnboardingController } from '../onboarding/controller';
import { GuideAnnouncementToast } from '../onboarding/announcement-toast';
import { shouldResumeOnboarding } from '../onboarding/model';
import { CurrentProjectBand, HomeScrim, homePanelCss } from './home/home-panels';
import { BUILTIN_PROJECT_TEMPLATES, defaultProjectTitle, parseTemplateMarkdown, planFileName, ProjectTemplate } from './home/project-templates';
import { computeProjectStages, EMPTY_PRESENCE, ProjectProgressService, stageSummary, ProjectStageKey } from './home/project-progress';
import { ProjectCard, ProjectListView, projectListCss } from './home/project-list-view';
import { resolveListChannel } from './home/project-list-channel';
import { projectHomeCss } from './home/project-home-style';
import { animateProjectOpen } from './home/open-motion';
import { decideOpenFlow, openChoices, OpenChoice } from './home/home-open-decision';
import { eventHistoryEntry, exportHistoryEntry, HomeHistoryEntry, sortHomeHistory } from './home/home-history';
import type { OpenProjectRequest } from './akari-home-command-contribution';
import { AkariScopeService } from 'akari-shell-strip/lib/browser/akari-scope-service';
import { AkariChannelContextService } from './channel/akari-channel-context-service';
import { AKARI_COMMANDS, AKARI_LAST_CHANNEL_STORAGE_KEY, AKARI_OPEN_PROJECT_WITHOUT_ASKING_PREFERENCE, AKARI_PARTNER_BUSY_CONTEXT_KEY, HOME_WIDGET_ID, PROJECT_LIST_WIDGET_ID, RAIL_CHANNEL_WIDGET_ID } from 'akari-shell-strip/lib/common/rail-ids';
import { AkariUpdateToast } from './home/update-toast';
import { buildHomeStats, hasPreviewContent, HomeStats, noticeStage, validateChannelName } from './home/home-model';
import { filterProjects, HOME_PROJECT_PAGE_SIZE, formatProjectUpdatedAt, projectEditStatus, ProjectDetails, PROJECT_PAGE_SIZE, PROJECT_SORT_ICON, PROJECT_SORT_LABELS, PROJECT_VIEW_ICONS, ProjectSortOrder, ProjectViewMode, readProjectSort, readProjectView, saveProjectSort, saveProjectView, shouldLoadMoreProjects, sortProjects } from '../common/project-browser';
import { AkariProjectLauncherDialog } from './akari-project-launcher-dialog';
import { PROJECT_CARD_BORDER, PROJECT_CARD_RADIUS_PX, PROJECT_CURRENT_STYLE, ProjectCardPreview } from './akari-project-card-preview';
import { AkariProjectService, AssetEntitlementsStatus } from 'akari-project/lib/common/akari-project-protocol';
import { AkariKitsService } from '../common/akari-kits-protocol';
import { OPEN_EXPORT_DIALOG } from 'akari-shell-strip/lib/browser/akari-export-toolbar-contribution';
import { buildKitCardModel, KitCardModel, KIT_LAB_URL } from '../common/kit-card-model';
import {
    AKARI_BORDER,
    AKARI_INK,
    AKARI_LINE,
    AKARI_RADIUS,
    AKARI_SURFACE
} from 'akari-project/lib/common/akari-surface-tokens';
import { resolveStorePlanBadge, StorePlanProduct } from '../common/store-plan-badge';

// ホーム v4（裁定 R1〜R3・notes-2026-08-02-home-v4-minimal）: dashboard の
// 構成要素を 3 つだけに削る — ①説明（2 動作） ②過去プロジェクト一覧
// ③接続案内カード（未接続時のみ）。v3 の intake カード・はじめかた 4 択・
// ワークフロー俯瞰カードはここで撤去した。工程はエージェント + ファイルが持ち、
// シェルは「今の状態を映すサーフェス」に徹する方針（v3 R1）は不変。
//
// D&D 復活（task 2026-08-02-home-dnd-restore・オーナー裁定追記）: 見た目 3 要素は
// 不変のまま、ホーム面全体（.akari-home-surface）をドロップターゲットにする。
// 専用のドロップゾーンカードは置かず、dragover 時のみオーバーレイで受け付けを
// 可視化する。取り込み処理（拡張子判定・重複回避・コピー・assets ロール解決）は
// bacd7f5 時点の v3 home dropzone と同じ経路を再利用した（挙動は変えていない）。
// `data-akari-dropzone='true'` は evidence 互換のため面全体の要素に復活させた。

const CONNECTIONS_RELATIVE_PATH = '.akari/connections.json';
const INTAKE_RELATIVE_PATH = '.akari/intake.json';
// ホームディレクトリ側の AKARI 共有ディレクトリ（`~/.akari/`。AKARI_HOME で
// 差し替え可・CLI と共有 — internal contract-2026-07-26-update-and-versioning.md §4）。
// プロジェクト直下の `.akari/` とは無関係。
const AKARI_HOME_SUBDIR = '.akari';
const UPDATE_CACHE_FILENAME = 'update-check.json';
// アプリ単位の「パートナー接続済み」マーカー。akari-partner の node バックエンドが
// 接続成立時に書く（ファイル契約のみで結合する — 拡張間の import 依存は増やさない）。
const PARTNER_CONNECTION_FILENAME = 'partner-connection.json';
// AKARI Store の接続資格情報。内蔵デバイスフローと launcher CLI が共有する。
const STORE_CREDENTIALS_FILENAME = 'store-credentials.json';
// 「AI パートナー接続」のプロジェクト単位 SSOT は connections.json の akari-cloud
// provider の doctor.status（partner pane が「akari-cloud・接続済み」と表示する対象と同一）。
const CLOUD_PROVIDER_ID = 'akari-cloud';
const SEND_TO_PARTNER_COMMAND = 'akari.partner.send';
// akari-project の akari-reveal-commands.ts とミラー（拡張間 npm 依存を作らない —
// akari-project-contribution.ts 冒頭コメントと同じ「薄いコマンド境界」流儀。
// task 2026-08-09-reveal-in-finder）。
const REVEAL_IN_FILE_MANAGER_COMMAND = 'akari.project.revealInFileManager';
/** ボタンの title/aria-label 用の一文（「を」の二重化を避けて OS ごとに文型を変える）。 */
function revealInFileManagerActionLabel(subject: string): string {
    return isOSX ? `${subject} を Finder で表示` : `${subject} のフォルダを開く`;
}

// --- D&D 復活（v3 home dropzone からの再利用。bacd7f5 時点の akari-home-widget.tsx） ---
// workflow.json の roles に assets kind が無いときの既定パス（v3 と同じ既定値）。
const DEFAULT_ASSETS_ROLE_PATH = 'assets';
// ドロップ／ダイアログで取り込める素材の拡張子。動画と写真のみ（音声・その他は対象外・v3 と同じ）。
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.gif', '.tiff', '.bmp'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg'];
const IMPORTABLE_EXTENSIONS = [...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS];

// 過去プロジェクト一覧（裁定 R3・2026-08-02）。作業場（creator-root）の規約は
// 公開リポ契約 `docs/contract-2026-08-02-creator-root-v1.md` §3 と
// `packages/creator-root/src/index.mjs` が正本。あちらは pure Node ESM で
// browser からは import できないため、ここではファイル名・schema 文字列だけを
// 規約として揃える（実装は複製しない — 読み取り専用でこの widget が使う分だけ）。
const CREATOR_ROOT_POINTER_FILENAME = 'creator-root.json';
const CREATOR_ROOT_MANIFEST_RELATIVE_PATH = '.akari/root.json';
const CREATOR_ROOT_SCHEMA = 'creator-root/v1';
const CREATOR_ROOT_CHANNELS_DIRNAME = 'channels';
const CREATOR_ROOT_VIDEOS_DIRNAME = 'videos';
// 既定チャンネル名（packages/creator-root/src/index.mjs の DEFAULT_CHANNEL_NAME と
// 同じ値。root.json の channels が空/未解決のときのフォールバックにのみ使う —
// 通常は manifest.channels[0]（誕生時に作られた最初のチャンネル）を使う）。
const CREATOR_ROOT_DEFAULT_CHANNEL = 'my-channel';

// --- F2 更新ポップアップ（task 2026-08-03-shell-quickwins-feedback） ---
// アプリ単位マーカーや更新キャッシュと同じ `<AKARI_HOME>/` 直下に置く。
const SHELL_LAST_VERSION_FILENAME = 'shell-last-version.json';

// --- F5 新しい動画を始める（task 2026-08-03-shell-quickwins-feedback） ---
function newProjectNameStem(date = new Date()): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}-${hour}${minute}`;
}

function newProjectDisplayTitle(date = new Date()): string {
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `新しい動画 ${date.getMonth() + 1}/${date.getDate()} ${hour}:${minute}`;
}

function newProjectDisplayTitleFor(name: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(?:-\d+)?$/.exec(name);
    if (match) {
        const [, year, month, day, hour, minute] = match;
        return newProjectDisplayTitle(new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
    }
    return newProjectDisplayTitle();
}

// --- U3 プロジェクト一覧の「単体」行（task 2026-08-03-home-v5-terms） ---
interface CreatorRootProjectEntry extends ProjectDetails {
    /** フォルダ名（機械の ID。ソート・URI 解決に使う。表示には使わない — 表示は title ?? name）。 */
    name: string;
    channel: string;
    uri: URI;
    /** `.akari/intake.json` の title（task 2026-08-09-project-display-title）。無ければ null。 */
    title: string | null;
}

/** U3: 履歴から拾った「単体」（作業場外）プロジェクト 1 件。 */
interface StandaloneProjectEntry extends ProjectDetails {
    /** フォルダ名（機械の ID）。表示は title ?? name。 */
    name: string;
    uri: URI;
    title: string | null;
}

/**
 * U3: プロジェクト一覧（唯一のスイッチャー）1 行分。past/current/standalone を統合した表示用の形。
 * ランチャー（`akari-project-launcher-dialog.ts`）が列挙結果をそのまま受け取れるよう export する
 * （型だけの参照 — 列挙ロジック自体は `buildProjectRows` に残したまま複製しない）。
 */
export interface ProjectListRow extends ProjectDetails {
    key: string;
    name: string;
    uri: URI;
    channel?: string;
    current: boolean;
    standalone: boolean;
}

/**
 * U2 状態バッジの表示に使う解決結果（旧 F6「現在地 1 行」を置き換え・
 * task 2026-08-03-home-v5-terms）。「作業場」という語は UI から追放する裁定（U1）に
 * あわせ、ここでも表示用フィールドに rootPath という語は残すが文言には出さない
 * （sub 行は「データの場所」）。
 */
type CurrentLocation =
    | { kind: 'inside'; rootPath: string; channel: string; project: string }
    | { kind: 'outside'; projectUri: URI };

/** workflow.json の roles 要素（v3 から再利用。assets ロールパスの解決にのみ使う）。 */
interface WorkflowRole {
    path: string;
    label: string;
    kind: string;
}

/**
 * intake.json（方向性の SSOT）を読んだ結果。進め方フォームのプリフィルが
 * この 1 経路を通る（パースを二重に持たない）。
 */
interface IntakeSnapshot {
    status: 'absent' | 'draft' | 'submitted';
    tasks: IntakeTaskId[];
    duration: IntakeDurationChoice;
    autonomy: IntakeAutonomy;
    taste: string | null;
    /** 人間向け表示名（task 2026-08-09-project-display-title）。フォームの入力対象ではなく、
     * エージェントが企画確定時に書く。無い/壊れていれば null（表示側は title ?? フォルダ名）。 */
    title: string | null;
}

@injectable()
export class AkariHomeWidget extends ReactWidget {
    static readonly ID = HOME_WIDGET_ID;

    @inject(OpenerService) protected readonly openers: OpenerService;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(CommandRegistry) protected readonly commandRegistry!: CommandRegistry;
    @inject(ContextKeyService) protected readonly contextKeys!: ContextKeyService;
    @inject(PreferenceService) protected readonly preferences!: PreferenceService;
    @inject(ProjectProgressService) protected readonly progress!: ProjectProgressService;
    @inject(AkariScopeService) protected readonly scope!: AkariScopeService;
    @inject(AkariChannelContextService) protected readonly channelContext!: AkariChannelContextService;
    protected projectSort: ProjectSortOrder = readProjectSort('home');
    protected projectRefreshing = false;
    protected projectQuery = '';
    protected projectView: ProjectViewMode = readProjectView('home');
    protected projectVisibleCount = HOME_PROJECT_PAGE_SIZE;
    protected projectLauncherPreparing = false;
    protected storeCredentialsUri: URI | undefined;
    protected kitsLedgerUri: URI | undefined;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(FileDialogService) protected readonly fileDialogs: FileDialogService;
    @inject(AkariUpdateToast) protected readonly updateToast: AkariUpdateToast;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(CommandService)
    protected readonly commands: CommandService;

    @inject(MessageService)
    protected readonly messages: MessageService;

    @inject(WidgetManager)
    protected readonly widgets: WidgetManager;

    @inject(WindowService)
    protected readonly windowService: WindowService;

    @inject(QuickInputService)
    protected readonly quickInputService: QuickInputService;

    @inject(ApplicationServer)
    protected readonly applicationServer: ApplicationServer;

    @inject(EnvVariablesServer)
    protected readonly envVariables: EnvVariablesServer;

    @inject(AkariSettingsMaintenanceService)
    protected readonly updateSettings: AkariSettingsMaintenanceService;

    @inject(AkariNewProjectService)
    protected readonly newProjectService: AkariNewProjectService;

    @inject(AkariProjectService)
    protected readonly storeService: AkariProjectService;

    @inject(AkariKitsService)
    protected readonly kitsService: AkariKitsService;

    protected watching = false;
    // 起動時のホーム表示に必要なデータがすべて揃ったことを DOM から観測する。
    protected homeReady = false;

    // --- F11 ウェルカム画面（状態 0・task 2026-08-05-welcome-screen） ---
    // `workspaceService.roots` が空（プロジェクト未選択で起動）のときだけ true。
    // true の間は render() が renderWelcomeSurface() に分岐し、通常ホームの要素
    // （状態バッジ・説明・接続カード等）は一切描画しない（task.md §2）。
    protected welcomeMode = false;

    // 初回オンボーディング本体は専用モーダルが所有する。home は開く配線だけを保持する。
    protected firstRunSetupDialog: AkariFirstRunSetupDialog | undefined;
    protected firstRunSetupDialogClosed: Promise<void> | undefined;
    @inject(AkariOnboardingService)
    protected readonly onboardingService!: AkariOnboardingService;
    protected firstVideoGuide: OnboardingController | undefined;
    protected readonly guideAnnouncementToast = new GuideAnnouncementToast();
    protected guideAnnouncementPending = false;
    // セットアップ完了直後はワークスペース root がまだ無くても dashboard へ抜ける。
    protected showDashboardWithoutProject = false;

    // --- プロジェクト・ランチャー（task 2026-08-17-home-launcher-popup・裁定 D + §3.2）。
    // 中身（列挙・開く・新規作成）は一切複製せず、home widget 側の既存実装を props 経由で
    // 渡すだけ。ここは開閉のライフサイクルと「同一セッションで再ポップしない」の状態だけを持つ。
    protected projectLauncherDialog: AkariProjectLauncherDialog | undefined;
    protected projectLauncherDialogClosed: Promise<void> | undefined;
    protected launcherDismissedThisSession = false;

    // --- カードのサムネ（ポスター + ホバーでループするコマ）。
    // 生成はバックエンド（`resolveProjectCardThumbnails`）が持ち、ここは解決済みの
    // file URL をプロジェクト単位で覚えるだけ。ffmpeg が一覧ぶん一斉に立ち上がらないよう
    // 2 レーンの直列キューで流す。
    protected readonly projectCardFrames = new Map<string, string[]>();
    protected readonly projectCardLanes: Promise<unknown>[] = [Promise.resolve(), Promise.resolve()];
    protected projectCardLaneCursor = 0;
    // ホバー再生はランチャーと同じ `ProjectCardPreview`（素の DOM 制御）に持たせる。
    // React には「中身を描かせない span」を 1 個渡すだけで、コマの出し入れは制御側が所有する
    // — こうすると 650ms ごとに widget 全体を再描画せずに済み、挙動も 3 面で 1 実装に揃う。
    protected readonly projectCardPreviews = new Map<string, ProjectCardPreview>();
    // ref コールバックは行ごとに同一関数を使い回す。毎描画で新しい関数を渡すと React が
    // 「ref が変わった」と見なして null → node の付け外しを繰り返し、再生が毎回作り直される。
    protected readonly projectCardPreviewRefs = new Map<string, (node: HTMLElement | null) => void>();

    // --- AKARI Store 接続（オーナー要望 2026-08-03「アプリ側でも欲しい」） ---
    protected storeEmail: string | null = null;
    protected storeEntitlementsStatus: AssetEntitlementsStatus = 'no_credentials';
    /** ホーム右上のバッジが「Lifetime かどうか」を見るために保つ（拡張キット模型と同じ取得結果）。 */
    protected storeEntitledProducts: StorePlanProduct[] = [];
    protected kitCard: KitCardModel = { kind: 'hidden' };

    // --- D&D 復活: 素材の取り込み（v3 home dropzone から再利用） ---
    protected importing = false;
    protected importedNotice: string | undefined;
    protected dragActive = false;

    // --- U3 プロジェクト一覧 = 唯一のスイッチャー（旧・過去プロジェクト一覧 裁定 R3。
    // task 2026-08-03-home-v5-terms で「プロジェクト」へ改称・現在地/単体を統合） ---
    protected creatorRootAvailable = false;
    protected creatorRootProjects: CreatorRootProjectEntry[] = [];
    // F5/U2/U3 が resolveCreatorRootDir() の結果を再利用するために保持する。
    protected creatorRootUri: URI | undefined;
    // U3: 履歴由来の「単体」プロジェクト（縮退時は現在開いているものだけになる）。
    protected standaloneProjects: StandaloneProjectEntry[] = [];

    // --- F5 新しい動画を始める ---
    protected startingNewProject = false;
    protected newProjectOriginRect: DOMRect | undefined;

    // --- U2 状態バッジ（旧 F6 現在地 1 行を置換。task 2026-08-03-home-v5-terms） ---
    protected currentLocation: CurrentLocation | undefined;
    // U3 のプロジェクト一覧で「開いています」を判定するための現在ワークスペース root。
    protected currentProjectUri: URI | undefined;
    // U5「チャンネルに入れる」実行中フラグ。
    protected joiningChannel = false;
    protected homeDialog: 'templates' | 'open' | 'channels' | 'channel-create' | 'channel-choice' | 'standalone-create' | undefined;
    protected chosenFolder: URI | undefined;
    protected standaloneFolder: URI | undefined;
    protected standaloneDestination: URI | undefined;
    protected openChoice: 'channel' | 'standalone' = 'channel';
    protected channels: string[] = [];
    protected listChannelOverride: string | undefined;
    protected projectListRefreshToken = 0;
    protected pendingChannel: string | undefined;
    protected pendingChannelProjectUri: URI | undefined;
    protected newChannelName = '';
    protected newChannelError = '';
    protected creatingChannel = false;
    protected projectTemplates: ProjectTemplate[] = [...BUILTIN_PROJECT_TEMPLATES];
    protected applyingTemplate = false;
    protected renamingProject = false;
    protected projectNameDraft = '';
    /** 直近に描いた一覧の全件数。スクロール追い読み（{@link handleHomeScroll}）が参照する。 */
    protected projectRowsTotal = 0;
    protected currentFrames: string[] = [];
    protected currentStats: HomeStats = {};
    protected currentCanPreview = false;
    protected currentDisplayPath = '';
    protected openPrompt: { request: OpenProjectRequest; name: string; badge: string; updatedAt?: number; busy: boolean } | undefined;
    protected closePrompt = false;
    protected noAskChecked = false;
    protected queuedOpen: OpenProjectRequest | undefined;
    protected historyOpen = false;
    protected menuOpen = false;
    protected historyEntries: HomeHistoryEntry[] = [];
    protected latestReport: URI | undefined;
    protected latestExport: URI | undefined;

    // --- ホーム v3 由来: 接続状態の判定 / 進め方フォーム ---
    // 接続案内カード自体は裁定 C4 により撤去済み（task 2026-08-17-home-launcher-popup）。
    // `connected` の判定（readConnected 系）は接続状態の SSOT として他用途のために維持する。
    protected connectionsUri: URI | undefined;
    protected intakeUri: URI | undefined;
    protected connected = false;
    protected intakeStatus: 'absent' | 'draft' | 'submitted' = 'absent';
    protected intakeSnapshot: IntakeSnapshot | undefined;

    // 進め方フォームを dashboard 内の展開セクションとして開いているか。
    // 企画の「詳しく」と `akari.home.openIntakeForm` コマンドから開く。
    // 画面の切り替えではなく「開いている / 畳んでいる」だけの
    // 純粋な UI 状態で、工程の状態は一切表さない（工程の SSOT は intake.json のまま）。
    protected intakeFormOpen = false;
    // プリフィル時に intake.json から読んだ target.taste の生値。見直し中に
    // 変えなければ再送信時にそのまま使う（そうしないとアプリ再起動後の
    // 見直しで taste が消えてしまう）。
    protected intakeReviewTaste: string | null = null;

    protected intakeTasks: Set<IntakeTaskId> = new Set(INTAKE_TASK_DEFAULTS);
    protected intakeDuration: IntakeDurationChoice = INTAKE_DEFAULT_DURATION;
    protected intakeAutonomy: IntakeAutonomy = INTAKE_DEFAULT_AUTONOMY;
    protected intakeSubmitting = false;

    // --- 更新チェック（U2 v0・右下の通知） ---
    // `updateRawCache` は dismiss 書き込み時に feed 等の既存フィールドを
    // 保つために保持する（`updateStatus` は表示用に評価済みの結果だけを持つ）。
    protected updateCacheUri: URI | undefined;
    protected updateRawCache: UpdateCache | null = null;
    protected updateStatus: UpdateStatus = { available: false };

    // --- U3 electron-updater（内部リポ契約 update-and-versioning §11）: DL 済み・
    // 再起動待ちの状態。U2 のリモートフィード比較（updateStatus）とは独立した
    // 別 SSOT（main プロセスの IPC イベントだけで決まる — shell-update-applier.ts 参照）。
    protected updaterUiState: ShellUpdaterUiState = INITIAL_SHELL_UPDATER_UI_STATE;
    protected updateUiEnabled = true;
    protected updaterUnsubscribe: (() => void) | undefined;

    @postConstruct()
    protected init(): void {
        this.id = AkariHomeWidget.ID;
        this.title.label = 'ホーム';
        this.title.caption = 'ホーム';
        this.title.iconClass = 'codicon codicon-home';
        this.title.closable = false;
        this.title.label = this.scope.scope === 'channel' ? 'プロジェクト一覧' : 'ホーム';
        this.toDispose.push(this.scope.onDidChangeScope(scope => {
            this.title.label = scope === 'channel' ? 'プロジェクト一覧' : 'ホーム';
            if (scope === 'channel') this.setListChannelOverride(undefined);
            this.update();
        }));
        this.toDispose.push(this.progress.onDidChange(() => this.update()));
        this.toDispose.push(this.contextKeys.onDidChange(() => {
            if (this.queuedOpen && !this.isPartnerBusy()) {
                const request = this.queuedOpen;
                this.queuedOpen = undefined;
                void this.commitOpenProject(request, false);
            }
        }));
        const clearReservation = (): void => { this.queuedOpen = undefined; };
        window.addEventListener('beforeunload', clearReservation);
        this.toDispose.push({ dispose: () => window.removeEventListener('beforeunload', clearReservation) });
        void this.watchStoreConnection().catch(error => console.warn('[akari-surfaces] store status watch failed:', error));
        // カードのホバー再生は React の外で DOM を持つため、widget と一緒に必ず止める。
        this.toDispose.push({
            dispose: () => {
                for (const preview of this.projectCardPreviews.values()) {
                    preview.dispose();
                }
                this.projectCardPreviews.clear();
            }
        });
        this.toDispose.push({ dispose: () => this.guideAnnouncementToast.close() });
        this.update();
    }

    async start(): Promise<void> {
        const timings: Record<string, number> = {};
        const perf = typeof performance !== 'undefined'
            && typeof performance.mark === 'function' && typeof performance.measure === 'function'
            ? performance : undefined;
        const measureStep = async <T,>(step: string, run: () => Promise<T>): Promise<T> => {
            const name = `akari-home:${step}`;
            perf?.mark(`${name}:start`);
            try {
                return await run();
            } finally {
                if (perf) {
                    perf.mark(`${name}:end`);
                    timings[`${step} (ms)`] = perf.measure(name, `${name}:start`, `${name}:end`).duration;
                    // CDP が後から読む measure は残し、一時 mark だけを片付ける。
                    perf.clearMarks?.(`${name}:start`);
                    perf.clearMarks?.(`${name}:end`);
                }
            }
        };
        // F11: ウェルカム判定は roots の有無だけを見る軽い判定なので最初に済ませる
        // （後続のロードが終わるのを待たせない）。
        await measureStep('refreshWelcomeMode', () => this.refreshWelcomeMode());
        await measureStep('loadHomeFlow', () => this.loadHomeFlow());
        await measureStep('loadCreatorRootProjects', () => this.loadCreatorRootProjects());
        // U3: 履歴由来の「単体」プロジェクトは creatorRootProjects（重複除外に使う）の後に読む。
        await measureStep('loadStandaloneProjects', () => this.loadStandaloneProjects());
        const firstRunWillAutoOpen = await measureStep('initializeFirstRunSetup', () => this.initializeFirstRunSetup());
        // U2: 状態バッジの解決（creatorRootUri）の後に読む — 現在地がチャンネルの
        // 内側かどうかの判定に使うため。
        await measureStep('refreshCurrentLocation', () => this.refreshCurrentLocation());
        await measureStep('loadCurrentBand', () => this.loadCurrentBand());
        this.homeReady = true;
        this.update();
        await measureStep('initializeProjectLauncher', () => this.initializeProjectLauncher(firstRunWillAutoOpen));
        // 更新通知はホームの判定・一覧に依存されないため後段へ。
        await measureStep('loadUpdateStatus', () => this.loadUpdateStatus());
        // U3: electron-updater の main プロセスイベント購読（DL 済み・再起動ボタン状態）。
        // 同期メソッド（内部の IPC 呼び出しは fire-and-forget）— 起動をブロックしない。
        // 未署名の開発ビルド（`window.electronAkariUpdater` 不在）では何もせず沈黙する。
        this.updateToast.onDownload = this.downloadUpdate;
        this.updateToast.onOpenBrowser = () => this.openUpdateDownloadInBrowser();
        this.updateToast.onRestart = this.restartAndApplyUpdate;
        this.updateToast.onDismiss = () => void this.dismissUpdate();
        this.initUpdaterEvents();
        this.syncUpdateToast();
        // バージョン通知は独立したトーストと起動記録の更新で、ホーム面のデータを作らないため後段へ。
        await measureStep('checkVersionNotice', () => this.checkVersionNotice());
        if (perf) {
            console.table([timings]);
        }
        if (this.watching) {
            return;
        }
        this.watching = true;
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            if (
                (this.connectionsUri && event.contains(this.connectionsUri)) ||
                (this.intakeUri && event.contains(this.intakeUri)) ||
                (this.storeCredentialsUri && event.contains(this.storeCredentialsUri)) ||
                (this.kitsLedgerUri && event.contains(this.kitsLedgerUri))
            ) {
                void this.refreshHomeFlow();
            }
        }));
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        if (!this.node.contains(document.activeElement)) {
            this.node.tabIndex = -1;
            this.node.focus({ preventScroll: true });
        }
    }

    /**
     * ホームが再表示されるたびに接続状態・プロジェクト一覧を読み直す。
     * アプリ単位マーカーやプロジェクト一覧は watch していない（v0）ため、
     * 他のタブから戻ってきたときに取り残されないようにするのはこの経路。
     */
    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        this.projectView = readProjectView('home');
        this.projectSort = readProjectSort('home');
        checkForShellUpdatesOnHomeShow(this.resolveElectronUpdaterApi());
        void this.refreshWelcomeMode();
        void this.refreshHomeFlow();
        void this.loadCreatorRootProjects()
            .then(() => this.loadStandaloneProjects())
            .then(() => this.refreshCurrentLocation())
            .then(() => this.loadCurrentBand());
    }

    /**
     * F11 ウェルカム判定（task 2026-08-05-welcome-screen）。開いているワークスペース
     * root が 1 つも無ければウェルカム面へ（`roots.length === 0`）。
     */
    protected async refreshWelcomeMode(): Promise<void> {
        const roots = await this.workspaceService.roots;
        this.welcomeMode = roots.length === 0;
        this.update();
    }

    /** channel モードの一覧がランチャーを兼ねる。初期化段は既存の起動契約のため保持する。 */
    protected async initializeProjectLauncher(_firstRunWillAutoOpen: boolean): Promise<void> {
        this.showPendingGuideAnnouncement();
    }

    /**
     * 完全初回だけ、ウェルカム面の上へ専用モーダルを自動表示する。戻り値は自動表示したか
     * どうか — ランチャーの自動表示判定（`initializeProjectLauncher`）が「今回はセットアップが
     * 優先された」ことを知るために使う（正本 §3.2「完全初回はセットアップダイアログが優先」）。
     */
    protected async initializeFirstRunSetup(): Promise<boolean> {
        const roots = await this.workspaceService.roots;
        const hasProjectHistory = this.creatorRootProjects.length > 0 || this.standaloneProjects.length > 0;
        const stored = await this.onboardingService.load();
        (window as Window & { akariOnboardingAnswer?: string }).akariOnboardingAnswer = stored?.answer;
        window.dispatchEvent(new CustomEvent('akari.onboarding.answer', { detail: { answer: stored?.answer } }));
        if (shouldResumeOnboarding(stored, roots[0]?.resource.toString())) {
            void this.openFirstVideoGuide(stored);
            return true;
        }
        const dialog = this.createFirstRunSetupDialog();
        const willAutoOpen = await dialog.shouldAutoOpen({
            hasOpenProject: roots.length > 0,
            hasProjectHistory
        });
        if (!willAutoOpen) {
            try {
                if (await this.onboardingService.claimGuideAnnouncement({
                    hasOpenProject: roots.length > 0, hasProjectHistory
                })) {
                    this.guideAnnouncementPending = true;
                }
            } catch (error) {
                console.warn('[akari-surfaces] guide announcement could not be recorded:', error);
            }
            return false;
        }
        void this.openFirstVideoGuide();
        return true;
    }

    /** 初回ガイドはウィンドウを覆う独立した面として開く。プロジェクト切替後も保存済みの段から戻る。 */
    openFirstVideoGuide = async (state?: import('../onboarding/model').OnboardingState): Promise<void> => {
        this.guideAnnouncementToast.close();
        this.firstVideoGuide ??= new OnboardingController(
            this.onboardingService,
            this.fileService,
            async uri => { await this.commands.executeCommand(AKARI_COMMANDS.openProject, { uri, reason: 'onboarding' }); },
            async uri => {
                const editUri = new URI(uri).resolve('edit.json');
                if (await this.fileService.exists(editUri)) {
                    await open(this.openers, editUri);
                    await this.commands.executeCommand('akari.preview.ensureVisible', { editUri: editUri.toString() });
                }
            },
            async () => { await this.shell.revealWidget('akari-role-buckets-widget'); },
            async (uri, time) => {
                const editUri = new URI(uri).resolve('edit.json').toString();
                await this.commands.executeCommand('akari.preview.seekOutput', { editUri, time, waitForReady: true });
            },
            async () => { await this.openProjectLauncher(); },
            async () => { await this.commands.executeCommand('akari.settings.open', { section: 'start' }); },
            () => this.guideAnnouncementToast.showClosed()
        );
        try { await this.firstVideoGuide.open(state); }
        catch (error) {
            console.error('[akari-surfaces] first video guide could not open:', error);
            void this.messages.error('ガイドを開けませんでした。', '閉じる');
        }
    };

    /** Mount only after a launcher dialog is present: an already mounted body sibling becomes inert. */
    protected showPendingGuideAnnouncement(): void {
        if (!this.guideAnnouncementPending) return;
        this.guideAnnouncementPending = false;
        this.guideAnnouncementToast.show(() => {
            this.projectLauncherDialog?.close();
            void this.commands.executeCommand('akari.home.openFirstVideoGuide');
        });
    }

    /**
     * ランチャーを開く（自動表示・初回セットアップ onFinished からの継続・コマンド/ボタンからの
     * 手動再表示の共通入口）。既に開いていればそれを前面に出すだけで新しいダイアログは作らない
     * （`openFirstRunSetupDialog` と同じ流儀）。一覧・新規作成・開くの実処理はすべて props 経由で
     * 既存実装（`buildProjectRows` / `startNewProject` / `openCreatorRootProject`）へ委ねる。
     */
    openProjectLauncher = async (): Promise<void> => {
        if (this.projectLauncherDialog && this.projectLauncherDialogClosed) {
            this.projectLauncherDialog.activate();
            return this.projectLauncherDialogClosed;
        }
        if (this.projectLauncherPreparing) { return; }
        this.projectLauncherPreparing = true;
        try {
            await this.loadCreatorRootProjects();
            await this.loadStandaloneProjects();
        } finally { this.projectLauncherPreparing = false; }
        // 開き直すたびに覚え直す。前回開いてから書き出し・編集が進んでいれば絵も新しくなる
        // （バックエンドはディスクのキャッシュを見るだけなので、変わっていなければ即返る）。
        this.projectCardFrames.clear();
        const dialog = new AkariProjectLauncherDialog({
            title: 'プロジェクトを選ぶ',
            rows: this.buildProjectRows(),
            onStartNewProject: this.startNewProject,
            onOpenProject: this.openCreatorRootProject,
            loadThumbnails: this.loadProjectCardThumbnails,
            onRefresh: async () => {
                await this.loadCreatorRootProjects();
                await this.loadStandaloneProjects();
                return this.buildProjectRows();
            },
            onDismissed: () => {
                this.launcherDismissedThisSession = true;
            }
        });
        this.projectLauncherDialog = dialog;
        const closed = dialog.openLauncher().finally(() => {
            if (this.projectLauncherDialog === dialog) {
                this.projectLauncherDialog = undefined;
                this.projectLauncherDialogClosed = undefined;
            }
        });
        this.projectLauncherDialogClosed = closed;
        this.showPendingGuideAnnouncement();
        return closed;
    };

    /**
     * カード 1 枚ぶんのサムネを file URL の配列で返す（先頭がポスター、以降がホバー時の
     * ループ用）。絵が用意できないプロジェクトは空配列 = カードはプレースホルダのまま。
     *
     * 絵の元は「書き出し済みの完成品 → `edit.json` で組んだタイムライン → `assets/` の素材」の
     * 3 段で、良いほうが勝つ（判定と生成はバックエンドの
     * `resolveProjectCardThumbnails` が持つ）。ここは失敗を握り潰して空配列にするだけ —
     * サムネが出ないことでランチャーの主動線（新規作成・開く）を止めない。
     */
    protected loadProjectCardThumbnails = async (uri: URI): Promise<string[]> => {
        const key = uri.toString();
        const remembered = this.projectCardFrames.get(key);
        if (remembered) {
            return remembered;
        }
        const frames = await this.enqueueProjectCardWork(async () => {
            try {
                const outcome = await this.storeService.resolveProjectCardThumbnails(key);
                return outcome.available && outcome.frames?.length
                    ? outcome.frames.map(frame => uri.resolve(frame).toString())
                    : [];
            } catch (error) {
                console.warn('[akari-surfaces] failed to resolve project card thumbnails:', error);
                return [];
            }
        });
        this.projectCardFrames.set(key, frames);
        return frames;
    };

    /**
     * カード 1 枚のホバー再生をつなぐ ref。React に描かせない空の span を受け取り、
     * ランチャーと同じ {@link ProjectCardPreview} へ渡す。ホバーを受けるのは外枠のカード
     * （`[data-akari-project-card]`）— いま開いているプロジェクトは中の「開く」ボタンが
     * disabled で、disabled なボタンはマウスイベントを飲むため。
     *
     * 行ごとに同じ関数を返すこと（毎描画で新しい関数だと React が ref を付け外しする）。
     */
    protected projectCardPreviewRef(row: ProjectListRow): (node: HTMLElement | null) => void {
        const cached = this.projectCardPreviewRefs.get(row.key);
        if (cached) {
            return cached;
        }
        const uri = row.uri;
        const callback = (node: HTMLElement | null): void => {
            this.projectCardPreviews.get(row.key)?.dispose();
            this.projectCardPreviews.delete(row.key);
            if (!node) {
                return;
            }
            const card = node.closest('[data-akari-project-card]') as HTMLElement | null ?? node;
            const preview = new ProjectCardPreview(node, card);
            this.projectCardPreviews.set(row.key, preview);
            void this.loadProjectCardThumbnails(uri).then(frames => preview.adopt(frames));
        };
        this.projectCardPreviewRefs.set(row.key, callback);
        return callback;
    }

    /**
     * プロジェクトカード 1 枚（ウェルカム面・ホーム面の共通部品。ランチャーの
     * `createRow` と同じ造り）。上が 16:9 のサムネ、下が名前とバッジ。
     * `reveal` を立てるとサムネ右上に「Finder で表示」を重ねる（ホーム面だけ）。
     */
    protected renderProjectCard(row: ProjectListRow, options: { reveal?: boolean } = {}): React.ReactNode {
        const badgeText = row.current ? '開いています'
            : (!row.standalone && row.channel) ? row.channel
                : row.standalone ? '単体' : undefined;
        return (
            <div
                key={row.key}
                style={homeFlowStyles.projectCard}
                data-akari-project-card='true'
                data-akari-project-row='true'
            >
                <button
                    type='button'
                    className='theia-button secondary'
                    style={{ ...homeFlowStyles.projectCardButton, ...(row.current ? PROJECT_CURRENT_STYLE : {}) }}
                    disabled={row.current}
                    title={badgeText ? `${row.name}（${badgeText}）` : row.name}
                    data-akari-project-item='true'
                    aria-current={row.current ? 'true' : undefined}
                    data-akari-project-current={row.current ? 'true' : undefined}
                    data-akari-project-standalone={row.standalone ? 'true' : undefined}
                    onClick={() => !row.current && this.openCreatorRootProject(row.uri)}
                >
                    <span style={homeFlowStyles.projectCardThumb}>
                        <span className='codicon codicon-device-camera-video' aria-hidden='true' style={homeFlowStyles.projectCardPlaceholder} />
                        {/* この層の中身は ProjectCardPreview が所有する（React は描かない）。 */}
                        <span ref={this.projectCardPreviewRef(row)} style={homeFlowStyles.projectCardFrames} />
                    </span>
                    <span style={homeFlowStyles.projectCardBody}>
                        <strong data-akari-project-title='true' style={homeFlowStyles.projectCardName}>{row.name}</strong>
                        {badgeText && <span data-akari-project-channel='true' style={{ ...homeFlowStyles.projectCardBadge, ...(row.current ? { color: 'var(--akari-accent, var(--theia-focusBorder))', borderColor: 'var(--akari-accent, var(--theia-focusBorder))', fontWeight: 700 } : {}) }}>{badgeText}</span>}
                    </span>
                </button>
                {options.reveal && (
                    <button
                        type='button'
                        className='theia-button secondary'
                        title={revealInFileManagerActionLabel(row.name)}
                        aria-label={revealInFileManagerActionLabel(row.name)}
                        data-akari-project-reveal={row.key}
                        style={homeFlowStyles.projectCardReveal}
                        onClick={event => {
                            event.stopPropagation();
                            void this.revealProjectInFileManager(row);
                        }}
                    >
                        <span className='codicon codicon-folder-opened' aria-hidden='true' />
                    </button>
                )}
            </div>
        );
    }

    /**
     * サムネ生成を 2 レーンの直列キューで流す。初回はプロジェクトごとに ffmpeg が走るため、
     * 一覧を開いた瞬間に列挙ぶん一斉起動させない（先頭のカードから順に絵が埋まる）。
     */
    protected enqueueProjectCardWork<T>(work: () => Promise<T>): Promise<T> {
        const lane = this.projectCardLaneCursor % this.projectCardLanes.length;
        this.projectCardLaneCursor += 1;
        const result = this.projectCardLanes[lane].then(work, work);
        this.projectCardLanes[lane] = result.catch(() => undefined);
        return result;
    }

    async openEditData(): Promise<void> {
        const root = (await this.workspaceService.roots)[0]?.resource;
        if (!root || !await this.fileService.exists(root.resolve('edit.json'))) {
            this.messages.info('まだ編集データがありません。');
            return;
        }
        try { await open(this.openers, root.resolve('edit.json')); }
        catch { this.messages.error('編集データを開けませんでした。もう一度お試しください。'); }
    }

    protected async openStoreSettings(): Promise<void> {
        await this.commands.executeCommand('akari.settings.open', { section: 'account' });
    }

    /** コマンドパレット／ホームの導線から何度でも明示再表示できる。 */
    openFirstRunSetup = async (): Promise<void> => {
        this.showDashboardWithoutProject = false;
        this.update();
        await this.openFirstRunSetupDialog('manual');
    };

    protected createFirstRunSetupDialog(): AkariFirstRunSetupDialog {
        return new AkariFirstRunSetupDialog(
            {
                title: '初回セットアップ',
                onWorkspaceCreated: async () => {
                    await this.loadCreatorRootProjects();
                },
                onFinished: () => {
                    this.showDashboardWithoutProject = false;
                    this.update();
                    void this.refreshHomeFlow();
                }
            },
            this.fileService,
            this.envVariables,
            this.newProjectService,
            this.commands
        );
    }

    protected openFirstRunSetupDialog(
        mode: FirstRunSetupOpenMode,
        preparedDialog?: AkariFirstRunSetupDialog
    ): Promise<void> {
        if (this.firstRunSetupDialog && this.firstRunSetupDialogClosed) {
            this.firstRunSetupDialog.activate();
            return this.firstRunSetupDialogClosed;
        }
        const dialog = preparedDialog ?? this.createFirstRunSetupDialog();
        this.firstRunSetupDialog = dialog;
        const closed = dialog.openSetup(mode).finally(() => {
            if (this.firstRunSetupDialog === dialog) {
                this.firstRunSetupDialog = undefined;
                this.firstRunSetupDialogClosed = undefined;
            }
        });
        this.firstRunSetupDialogClosed = closed;
        return closed;
    }

    // --- ホーム v3: 状態読み取り（SSOT はファイル。裁定 R1/R5） ---

    protected async loadHomeFlow(): Promise<void> {
        const roots = await this.workspaceService.roots;
        const root = roots[0]?.resource;
        if (!root) {
            this.connectionsUri = undefined;
            this.intakeUri = undefined;
            this.connected = false;
            this.intakeStatus = 'absent';
            this.intakeSnapshot = undefined;
            this.update();
            return;
        }
        this.connectionsUri = root.resolve(CONNECTIONS_RELATIVE_PATH);
        this.intakeUri = root.resolve(INTAKE_RELATIVE_PATH);
        await this.refreshHomeFlow();
    }

    /**
     * ファイル watch（connections.json / intake.json）とホーム再表示から呼ばれる
     * 唯一の反映経路。エージェントが intake.json を直接書き換えた場合も、この
     * 経路で進め方フォームのプリフィルが追随する（裁定 R5）。
     * 展開中のフォームはここで畳まない — 編集中に外部書き込みが来ても
     * 入力が消えないようにするため（フォームの開閉は純粋な UI 状態）。
     */
    protected async refreshHomeFlow(): Promise<void> {
        const [connected, storeEmail, storeCatalog, kits, intake] = await Promise.all([
            this.readConnected(),
            this.readStoreConnection(),
            this.readStoreCatalogSnapshot(),
            this.kitsService.readInstalledKits().catch(() => ({ kits: [], pluginEnabled: null })),
            this.readIntake()
        ]);
        this.connected = connected;
        this.storeEmail = storeEmail;
        this.storeEntitlementsStatus = storeCatalog.entitlementsStatus;
        this.storeEntitledProducts = storeCatalog.entitledProducts;
        this.kitCard = buildKitCardModel({
            connected: storeEmail !== null,
            entitledProducts: storeCatalog.entitledProducts,
            installedKits: kits.kits,
            pluginEnabled: kits.pluginEnabled
        });
        this.intakeSnapshot = intake;
        this.intakeStatus = intake.status;
        this.update();
    }

    /**
     * AKARI Store の接続状態（`~/.akari/store-credentials.json`・AKARI_HOME で差し替え可）。
     * 読み方は partner-connection.json と同じ EnvVariablesServer + FileService 経路。
     * 無い/壊れていれば未接続扱い。設定で接続した結果は資格情報の変更通知から読み直す。
     */
    protected async watchStoreConnection(): Promise<void> {
        const akariHome = await this.resolveAkariHomeUri();
        this.storeCredentialsUri = akariHome.resolve(STORE_CREDENTIALS_FILENAME);
        const kitsUri = akariHome.resolve('kits');
        this.kitsLedgerUri = kitsUri.resolve('installed.json');
        if (!this.isDisposed) { this.toDispose.push(this.fileService.watch(this.storeCredentialsUri.parent)); }
        try {
            if (!this.isDisposed) { this.toDispose.push(this.fileService.watch(kitsUri)); }
        } catch {
            // kits/ は初回インストール前には存在しない。
        }
    }

    protected async readStoreConnection(): Promise<string | null> {
        try {
            const uri = (await this.resolveAkariHomeUri()).resolve(STORE_CREDENTIALS_FILENAME);
            const parsed = JSON.parse((await this.fileService.readFile(uri)).value.toString());
            if (typeof parsed?.token !== 'string') {
                return null;
            }
            return typeof parsed?.email === 'string' ? parsed.email : '接続済み';
        } catch {
            return null;
        }
    }

    /**
     * resolver と同じ entitlements 取得結果を akari-project のカタログ RPC 経由で読む。
     * ホーム独自のトークン検証は追加せず、カタログ面と判定元を一つに保つ。
     */
    protected async readStoreCatalogSnapshot(): Promise<{
        entitlementsStatus: AssetEntitlementsStatus;
        entitledProducts: Array<{ id: string; kind: string | null; currentVersion: number | null }>;
    }> {
        try {
            const catalog = await this.storeService.getAssetCatalogView(undefined, 'automatic');
            return {
                entitlementsStatus: catalog.entitlementsStatus,
                entitledProducts: catalog.entitledProducts ?? []
            };
        } catch {
            return { entitlementsStatus: 'error', entitledProducts: [] };
        }
    }

    /**
     * 01 ゲートの「接続済み」判定。ゲート自身の文言（「初回のみ · 完了すると
     * 次からは自動接続」）どおりに振る舞わせるため、**プロジェクト単位**の
     * connections.json だけでなく**アプリ単位**のマーカーも見る。どちらかが
     * ok ならゲートは出さない（connections.json が未整備の別プロジェクトを
     * 開いても、一度つないだアプリなら接続案内は出ない）。
     */
    protected async readConnected(): Promise<boolean> {
        return (await this.readProjectConnected()) || (await this.readAppConnected());
    }

    /**
     * connections.json の doctor 判定を読むだけで、判定ロジック自体は
     * 再実装しない（skills/manage-connections/bin/doctor.mjs が唯一の書き手）。
     * ファイルが無い/壊れている/対象 provider が無ければ未接続扱い
     * （フェイルセーフ側に倒す）。
     */
    protected async readProjectConnected(): Promise<boolean> {
        if (!this.connectionsUri) {
            return false;
        }
        try {
            const content = await this.fileService.readFile(this.connectionsUri);
            const parsed = JSON.parse(content.value.toString());
            const providers = Array.isArray(parsed?.providers) ? parsed.providers : [];
            const partner = providers.find((provider: { id?: unknown }) => provider?.id === CLOUD_PROVIDER_ID);
            return partner?.doctor?.status === 'ok';
        } catch {
            return false;
        }
    }

    /**
     * アプリ単位マーカー（`~/.akari/partner-connection.json`、`AKARI_HOME` で
     * 差し替え可）を読む。akari-partner への import 依存は増やさず、ファイル契約
     * だけで結合する（読み方は update-check.json と同じ EnvVariablesServer +
     * FileService 経路）。無い/壊れている/status が ok でなければ未接続扱い。
     *
     * v0 ではこのファイルの watch は張らない（マーカーは「次回起動時に効く」で
     * 足りる契約）。同一セッション内の反映はホーム再表示時の読み直しで担保する
     * （接続案内カード撤去〔裁定 C4〕前は接続フロー完了時の読み直しもあったが、
     * その呼び出し元自体が無くなったため今はここだけが反映経路）。
     */
    protected async readAppConnected(): Promise<boolean> {
        try {
            const uri = (await this.resolveAkariHomeUri()).resolve(PARTNER_CONNECTION_FILENAME);
            const content = await this.fileService.readFile(uri);
            const parsed = JSON.parse(content.value.toString());
            return parsed?.status === 'ok';
        } catch {
            return false;
        }
    }

    /**
     * intake.json を読んで進め方フォームが使う値まで正規化する。
     * 無い・壊れている・未解決の場合は `absent` + 既定値を返す（フェイルセーフ側）。
     * 判定ロジックの重複を避けるため、状態表示もプリフィルもここだけを通す。
     */
    protected async readIntake(): Promise<IntakeSnapshot> {
        const fallback: IntakeSnapshot = {
            status: 'absent',
            tasks: [...INTAKE_TASK_DEFAULTS],
            duration: INTAKE_DEFAULT_DURATION,
            autonomy: INTAKE_DEFAULT_AUTONOMY,
            taste: null,
            title: null
        };
        if (!this.intakeUri) {
            return fallback;
        }
        try {
            const content = await this.fileService.readFile(this.intakeUri);
            const parsed = JSON.parse(content.value.toString());
            const knownTasks = new Set<string>(INTAKE_TASK_IDS);
            const rawTasks: unknown[] = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
            const target = parsed?.target ?? {};
            return {
                status: parsed?.status === 'submitted' ? 'submitted' : 'draft',
                tasks: rawTasks.filter((id): id is IntakeTaskId => typeof id === 'string' && knownTasks.has(id)),
                duration: this.durationChoiceFromTarget(target),
                autonomy: (INTAKE_AUTONOMY_ORDER as readonly string[]).includes(parsed?.autonomy)
                    ? parsed.autonomy as IntakeAutonomy
                    : INTAKE_DEFAULT_AUTONOMY,
                taste: typeof target?.taste === 'string' ? target.taste : null,
                title: parseIntakeTitle(parsed)
            };
        } catch {
            return fallback;
        }
    }

    // --- ホーム v4: 過去プロジェクト一覧（裁定 R3・2026-08-02） -----------------

    /**
     * 作業場（creator-root）を解決し、各チャンネルの videos 配下を列挙する。
     * 規約は公開リポ契約 `docs/contract-2026-08-02-creator-root-v1.md` §3 と同じ:
     *   `<AKARI_HOME>/creator-root.json` の `lastRoot` →
     *   `<lastRoot>/.akari/root.json`（`schema === 'creator-root/v1'` を検証） →
     *   `<lastRoot>/channels/<channel>/videos/<project>`
     * 途中のどの段階が壊れていても（ポインタ不在・root.json 不在/壊れた JSON/
     * 未知 schema・channels/videos ディレクトリ不在）書き込み・修復はせず、
     * 一覧なしのフォールバック表示に倒す（読み取り専用の不変原則）。
     */
    protected async loadCreatorRootProjects(): Promise<void> {
        const rootUri = await this.resolveCreatorRootDir();
        if (!rootUri) {
            this.creatorRootAvailable = false;
            this.creatorRootProjects = [];
            this.creatorRootUri = undefined;
            this.channels = [];
            this.projectListRefreshToken++;
            this.update();
            return;
        }
        this.creatorRootAvailable = true;
        this.creatorRootUri = rootUri;
        this.channels = await this.resolveManifestChannels(rootUri);
        this.creatorRootProjects = await this.listCreatorRootProjects(rootUri);
        this.projectListRefreshToken++;
        this.update();
    }

    // --- U3 プロジェクト一覧「単体」行（task 2026-08-03-home-v5-terms） --------

    /**
     * Theia の最近開いたワークスペース履歴（`WorkspaceService#recentWorkspaces`）から、
     * 過去プロジェクト一覧（`creatorRootProjects`）に含まれない = 作業場外のものを拾う。
     * 「AKARI Video のプロジェクトである」の判定は `adoptProject`（creator-root）の
     * scaffold 済み判定と同じ基準（`.akari/connections.json` の存在）で揃える —
     * 無関係な履歴（他のフォルダ）を「単体」として誤表示しないため。
     * 履歴 API 自体が読めない場合は空配列（縮退: 現在開いている単体のみが
     * `renderProjectList` 側の合流ロジックで表示される）。
     */
    protected async loadStandaloneProjects(): Promise<void> {
        this.standaloneProjects = await this.resolveStandaloneProjects();
        this.update();
    }

    protected async resolveStandaloneProjects(): Promise<StandaloneProjectEntry[]> {
        let recent: string[];
        try {
            recent = await this.workspaceService.recentWorkspaces();
        } catch (error) {
            console.error('[akari-surfaces] failed to read recent workspaces (falling back to current-only standalone list):', error);
            return [];
        }
        const insidePaths = new Set(this.creatorRootProjects.map(project => project.uri.path.fsPath()));
        const seen = new Set<string>();
        const results: StandaloneProjectEntry[] = [];
        for (const raw of recent) {
            let uri: URI;
            try {
                uri = new URI(raw);
            } catch {
                continue;
            }
            const fsPath = uri.path.fsPath();
            if (insidePaths.has(fsPath) || seen.has(fsPath)) {
                continue;
            }
            seen.add(fsPath);
            if (!(await this.isScaffoldedProject(uri))) {
                continue;
            }
            results.push({ name: uri.path.base || fsPath, uri, title: await this.readProjectTitle(uri), ...await this.readProjectDetails(uri) });
        }
        return results;
    }

    /** 「AKARI Video のプロジェクトのマーカー」判定。adoptProject の scaffold 済み基準と同じ。 */
    protected async isScaffoldedProject(uri: URI): Promise<boolean> {
        try {
            return await this.fileService.exists(uri.resolve(CONNECTIONS_RELATIVE_PATH));
        } catch {
            return false;
        }
    }

    /**
     * 一覧 1 行分の表示名解決用に、`<projectUri>/.akari/intake.json` の title だけを読む
     * （task 2026-08-09-project-display-title）。無い・壊れている場合は null
     * （フェイルセーフ側 — 一覧描画自体は止めない）。
     */
    /** キャッシュ生成で更新順が変わらないよう、編集データ・進め方・ルートの日時を見る。 */
    protected async readProjectDetails(uri: URI): Promise<ProjectDetails> {
        const stat = async (resource: URI) => {
            try { return await this.fileService.resolve(resource, { resolveMetadata: true }); }
            catch (error) { return toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND ? null : undefined; }
        };
        const [folder, edit, intake] = await Promise.all([stat(uri), stat(uri.resolve('edit.json')), stat(uri.resolve(INTAKE_RELATIVE_PATH))]);
        const dates = [folder?.mtime, edit?.mtime, intake?.mtime].filter((value): value is number => Number.isFinite(value));
        return { updatedAt: dates.length ? Math.max(...dates) : undefined, hasEditData: edit === undefined ? undefined : !!edit?.isFile };
    }

    protected async readProjectTitle(uri: URI): Promise<string | null> {
        try {
            const content = await this.fileService.readFile(uri.resolve(INTAKE_RELATIVE_PATH));
            return parseIntakeTitle(JSON.parse(content.value.toString()));
        } catch {
            return null;
        }
    }

    /**
     * マシンポインタ `<AKARI_HOME>/creator-root.json` の `lastRoot` を読み、
     * `.akari/root.json` の schema 検証まで通った場合だけ作業場ルート URI を返す。
     * 失敗経路（ファイル不在・壊れた JSON・未知 schema）はすべて `undefined` に
     * 揉み消す — ここは「一覧を出すかどうか」の判定だけが目的で、エラー種別を
     * UI に出し分ける契約ではない（§task「案内 1 行にフォールバック」）。
     */
    protected async resolveCreatorRootDir(): Promise<URI | undefined> {
        try {
            const pointerUri = (await this.resolveAkariHomeUri()).resolve(CREATOR_ROOT_POINTER_FILENAME);
            const pointerContent = await this.fileService.readFile(pointerUri);
            const pointer = JSON.parse(pointerContent.value.toString());
            const lastRoot = pointer?.lastRoot;
            if (typeof lastRoot !== 'string' || lastRoot.length === 0) {
                return undefined;
            }
            const rootUri = URI.fromFilePath(lastRoot);
            const manifestContent = await this.fileService.readFile(rootUri.resolve(CREATOR_ROOT_MANIFEST_RELATIVE_PATH));
            const manifest = JSON.parse(manifestContent.value.toString());
            if (!manifest || typeof manifest !== 'object' || manifest.schema !== CREATOR_ROOT_SCHEMA) {
                return undefined;
            }
            return rootUri;
        } catch {
            return undefined;
        }
    }

    /** ディレクトリの子ディレクトリ一覧。解決できなければ空配列（フェイルセーフ側）。 */
    protected async resolveChildDirectories(uri: URI): Promise<FileStat[]> {
        try {
            const stat = await this.fileService.resolve(uri);
            return (stat.children ?? []).filter(child => child.isDirectory);
        } catch {
            return [];
        }
    }

    /**
     * `<root>/channels/<channel>/videos/<project>` をフラット列挙する（全チャンネル横断・
     * チャンネル名はサブラベル表示用に保持するだけ — §task「v1 では既定チャンネル +
     * 全チャンネル横断のフラット列挙でよい」）。
     */
    protected async listCreatorRootProjects(rootUri: URI): Promise<CreatorRootProjectEntry[]> {
        const entries: CreatorRootProjectEntry[] = [];
        const channelDirs = await this.resolveChildDirectories(rootUri.resolve(CREATOR_ROOT_CHANNELS_DIRNAME));
        for (const channelDir of channelDirs) {
            const projectDirs = await this.resolveChildDirectories(channelDir.resource.resolve(CREATOR_ROOT_VIDEOS_DIRNAME));
            for (const projectDir of projectDirs) {
                entries.push({ name: projectDir.name, channel: channelDir.name, uri: projectDir.resource, title: null });
            }
        }
        const sorted = this.sortCreatorRootProjects(entries);
        // 全件を検索対象に含め、ファイル読み込みだけを小さなバッチに分ける。
        for (let start = 0; start < sorted.length; start += PROJECT_PAGE_SIZE) {
            await Promise.all(sorted.slice(start, start + PROJECT_PAGE_SIZE).map(async entry => {
                const [title, details] = await Promise.all([this.readProjectTitle(entry.uri), this.readProjectDetails(entry.uri)]);
                Object.assign(entry, { title }, details);
            }));
        }
        return sorted;
    }

    /** 名前の日付プレフィックス（`YYYY-MM-DD-...`）降順。プレフィックスが無いものは末尾（辞書順）。 */
    protected sortCreatorRootProjects(entries: CreatorRootProjectEntry[]): CreatorRootProjectEntry[] {
        const datePrefix = (name: string): string | undefined => name.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
        return [...entries].sort((left, right) => {
            const leftDate = datePrefix(left.name);
            const rightDate = datePrefix(right.name);
            if (leftDate && rightDate) {
                return rightDate.localeCompare(leftDate);
            }
            if (leftDate) {
                return -1;
            }
            if (rightDate) {
                return 1;
            }
            return left.name.localeCompare(right.name);
        });
    }

    /**
     * クリックでそのプロジェクトをワークスペースとして開く。実際の open は既存の Theia
     * `WorkspaceService#open` をそのまま呼ぶだけで新規実装はしない
     * （§task「既存の Theia workspace open 系サービス/コマンドを使う」）。
     *
     * task 2026-08-25-shell-window-and-notify ③: プロジェクトを既に開いている状態では
     * 選択ポップアップを挟む。AI パートナーの処理や書き出しが走ったまま黙って
     * ウィンドウが増える/切り替わるより、「新しいウィンドウで並行」（既定）か
     * 「このウィンドウで切り替える」かを本人が選べるようにする。未オープン
     * （ウェルカム状態）のときは従来どおり即このウィンドウで開く。
     */
    protected openCreatorRootProject = (uri: URI, originRect?: DOMRect): void => {
        void this.commands.executeCommand(AKARI_COMMANDS.openProject, { uri: uri.toString(), originRect });
    };

    protected isPartnerBusy(): boolean {
        return this.contextKeys.match(AKARI_PARTNER_BUSY_CONTEXT_KEY);
    }

    async openProject(request: OpenProjectRequest): Promise<void> {
        const uri = new URI(request.uri);
        if (this.currentProjectUri?.toString() === uri.toString()) {
            await this.shell.activateWidget(this.id);
            return;
        }
        const busy = this.isPartnerBusy();
        const ask = !this.preferences.get<boolean>(AKARI_OPEN_PROJECT_WITHOUT_ASKING_PREFERENCE, false);
        if (decideOpenFlow({ ask, busy, hasOrigin: !!request.originRect, reducedMotion: false }) === 'direct') {
            await this.commitOpenProject(request, false);
            return;
        }
        const row = this.buildProjectRows().find(candidate => candidate.uri.toString() === uri.toString());
        const [name, details, presence] = await Promise.all([
            row?.name ?? this.readProjectTitle(uri).then(title => title ?? uri.path.base),
            row ?? this.readProjectDetails(uri),
            this.progress.readPresence(uri)
        ]);
        this.openPrompt = { request, name, badge: stageSummary(presence), updatedAt: details.updatedAt, busy };
        this.noAskChecked = false;
        this.historyOpen = false;
        this.menuOpen = false;
        this.update();
    }

    protected async chooseOpen(choice: OpenChoice): Promise<void> {
        const prompt = this.openPrompt;
        if (!prompt) return;
        this.openPrompt = undefined;
        this.update();
        if (choice === 'after-work') {
            this.queuedOpen = prompt.request;
            this.messages.info(`パートナーの作業が終わったら「${prompt.name}」を開きます`);
            if (!this.isPartnerBusy()) {
                const queued = this.queuedOpen; this.queuedOpen = undefined;
                if (queued) await this.commitOpenProject(queued, false);
            }
            return;
        }
        if (this.noAskChecked && !prompt.busy) {
            await this.preferences.set(AKARI_OPEN_PROJECT_WITHOUT_ASKING_PREFERENCE, true, PreferenceScope.User);
        }
        await this.commitOpenProject(prompt.request, choice === 'new-window', choice === 'here' && prompt.busy);
    }

    protected async commitOpenProject(request: OpenProjectRequest, newWindow: boolean, busyConfirmed = false): Promise<void> {
        if (this.isPartnerBusy() && !busyConfirmed) {
            await this.openProject(request);
            return;
        }
        const uri = new URI(request.uri);
        const root = this.creatorRootUri ?? await this.resolveCreatorRootDir();
        const relative = root?.relative(uri)?.toString().split('/').filter(Boolean);
        const channel = relative?.length === 4 && relative[0] === CREATOR_ROOT_CHANNELS_DIRNAME
            && relative[2] === CREATOR_ROOT_VIDEOS_DIRNAME ? relative[1] : undefined;
        if (!newWindow) {
            const row = this.buildProjectRows().find(candidate => candidate.uri.toString() === request.uri);
            await animateProjectOpen(request.originRect, row?.name ?? uri.path.base,
                row ? stageSummary(await this.progress.readPresence(uri)) : undefined, this.projectCardFrames.get(request.uri)?.[0]);
        }
        if (channel) localStorage.setItem(AKARI_LAST_CHANNEL_STORAGE_KEY, channel);
        // 再読み込み中の地の色を「開く先」（プロジェクトの中）にする（akari-theme の scope-ground が読む）。
        if (!newWindow) { try { localStorage.setItem('akari.ground.scope', 'project'); } catch { /* 保存不可なら直前の色のまま */ } }
        if (!newWindow && request.reason?.startsWith('start-kind:')) {
            sessionStorage.setItem('akari.home.start-kind', request.reason.slice('start-kind:'.length));
        }
        this.workspaceService.open(uri, { preserveWindow: !newWindow });
    }

    async closeProject(): Promise<void> {
        if (!this.currentProjectUri) return;
        this.historyOpen = false;
        this.menuOpen = false;
        this.closePrompt = true;
        this.update();
    }

    protected async confirmCloseProject(): Promise<void> {
        this.closePrompt = false;
        this.queuedOpen = undefined;
        this.update();
        await this.workspaceService.close();
    }

    /**
     * プロジェクトカードの「Finder で表示」ボタン（task 2026-08-09-reveal-in-finder）。
     * 実体は akari-project 拡張のコマンド（ID ミラー・存在確認とエラー表示もあちらが担う）。
     */
    protected async revealProjectInFileManager(row: ProjectListRow): Promise<void> {
        await this.commands.executeCommand(REVEAL_IN_FILE_MANAGER_COMMAND, row.uri);
    }

    // --- F5 新しい動画を始める（task 2026-08-03-shell-quickwins-feedback） -----

    /**
     * root.json の `channels` 一覧を読む。読めない・空配列のときは
     * `packages/creator-root` と同じ既定名 1 件へフォールバックする
     * （U5「チャンネルに入れる」の QuickPick 選択肢と、F5 の既定チャンネル解決の
     * 両方がこの 1 経路を通る — task 2026-08-03-home-v5-terms）。
     */
    protected async resolveManifestChannels(rootUri: URI): Promise<string[]> {
        try {
            const content = await this.fileService.readFile(rootUri.resolve(CREATOR_ROOT_MANIFEST_RELATIVE_PATH));
            const manifest = JSON.parse(content.value.toString());
            const channels: unknown = manifest?.channels;
            if (Array.isArray(channels)) {
                const names = channels.filter((value): value is string => typeof value === 'string' && value.length > 0);
                if (names.length > 0) {
                    return names;
                }
            }
        } catch {
            // フォールバックへ倒す。
        }
        return [CREATOR_ROOT_DEFAULT_CHANNEL];
    }

    /** 作業場の「既定チャンネル」= root.json の `channels` 先頭要素（誕生時に生成される最初のチャンネル。creator-root-v1 契約 §3・§5）。 */
    protected async resolveDefaultChannelName(rootUri: URI): Promise<string> {
        const channels = await this.resolveManifestChannels(rootUri);
        return channels[0];
    }

    /**
     * `<root>/channels/<channel>/videos/` 配下で空いているプロジェクト名を探す
     * （日時プレフィックスは過去プロジェクト一覧の並び順（sortCreatorRootProjects）と
     * 揃える）。同名衝突時は `-2` `-3` ... を試す（`availableTarget` と同じ流儀）。
     */
    protected async reserveNewProjectName(rootUri: URI, channel: string): Promise<string> {
        const videosUri = rootUri.resolve(CREATOR_ROOT_CHANNELS_DIRNAME).resolve(channel).resolve(CREATOR_ROOT_VIDEOS_DIRNAME);
        const stem = newProjectNameStem();
        let candidate = stem;
        for (let index = 2; await this.fileService.exists(videosUri.resolve(candidate)); index++) {
            candidate = `${stem}-${index}`;
        }
        return candidate;
    }

    /**
     * 「+ 新しい動画を始める」。作業場の既定チャンネルの `videos/` 配下に
     * 新規プロジェクトを作り、開く（孤児禁止 — task.md 指定）。作業場が一つも
     * 解決できていない（`creatorRootUri` 未解決 — ウェルカム画面の完全初回など）
     * ときは、F9 の ensureCreatorRoot 連結（確認 → 作成）を経てから同じ生成へ
     * 続ける（task 2026-08-05-welcome-screen §1「F9 の ensureCreatorRoot 連結に
     * 繋ぐ」指定）。確認をキャンセルした/作成に失敗したときは何も変えず戻る
     * （エラーメッセージは失敗時のみ ensureCreatorRootForNewProject 側で出す）。
     * 生成は `akari-project` 拡張の既存バックエンドサービス
     * `AkariProjectService#createProject()` を呼ぶだけで再実装しない
     * （テンプレコピー・フォールバック補完・スキル同梱・git init は向こう側の責務）。
     * 生成できたら**このウィンドウをそのまま**新しい動画へ切り替える
     * （`preserveWindow: true`）。`openCreatorRootProject`（過去プロジェクトを開く）が
     * 別ウィンドウなのと違うのは、こちらが「今から作る 1 本へ移動する」導線だから
     * （プロジェクト未選択のウェルカム画面では Theia 既定が元々同ウィンドウ切替に
     * なるため、状態によって挙動が変わらない形にも揃う）。
     *
     * 開くのに `WorkspaceService#open` は使えない: あれは `void` を返す
     * fire-and-forget で、内部の `doOpen` を await せず失敗も握り潰すため、
     * 開けなかったときに下の catch へ入らず「作成しています…」で固まる
     * （実機再現済み。`openWorkspace` は同じ経路を Promise で返す public API）。
     * フラグ復帰は finally に置く — 成功時に戻し忘れるとボタンが
     * disabled のまま二度と押せなくなる（同上）。
     */
    startNewProject = async (): Promise<void> => {
        if (this.startingNewProject) {
            return;
        }
        const originRect = this.newProjectOriginRect;
        this.newProjectOriginRect = undefined;
        this.startingNewProject = true;
        this.update();
        try {
            let rootUri = this.creatorRootUri ?? (this.creatorRootUri = await this.resolveCreatorRootDir());
            const channels = rootUri ? await this.resolveManifestChannels(rootUri) : [CREATOR_ROOT_DEFAULT_CHANNEL];
            const preferredChannel = this.listChannel();
            const channel = channels.includes(preferredChannel) ? preferredChannel : channels[0];
            if (!rootUri) {
                rootUri = new URI(await this.newProjectService.ensureCreatorRoot());
                this.creatorRootUri = rootUri;
                this.creatorRootAvailable = true;
            }
            const name = await this.reserveNewProjectName(rootUri, channel);
            const destination = rootUri.resolve(CREATOR_ROOT_CHANNELS_DIRNAME).resolve(channel).resolve(CREATOR_ROOT_VIDEOS_DIRNAME).resolve(name);
            await this.createAndOpenProject(destination, originRect);
        } catch (error) {
            this.reportNewProjectError(error);
            this.startingNewProject = false;
            this.update();
        }
    };

    async startNewProjectIn(destination: URI): Promise<void> {
        if (this.startingNewProject) { return; }
        await this.createAndOpenProject(destination);
    }

    protected async createAndOpenProject(destination: URI, originRect?: DOMRect): Promise<void> {
        this.startingNewProject = true;
        this.update();
        try {
            await this.newProjectService.createProject(destination.toString());
            const intake = {
                version: 1, tasks: [], target: { duration_s: null, keep_length: true, taste: null },
                autonomy: INTAKE_DEFAULT_AUTONOMY, status: 'draft', submitted_at: null, title: newProjectDisplayTitleFor(destination.path.base)
            };
            await this.fileService.writeFile(destination.resolve(INTAKE_RELATIVE_PATH),
                BinaryBuffer.fromString(`${JSON.stringify(intake, null, 2)}\n`));
            await this.loadCreatorRootProjects();
            await this.commands.executeCommand(AKARI_COMMANDS.openProject,
                { uri: destination.toString(), reason: 'new-project', originRect });
            if (this.openPrompt?.request.uri === destination.toString()
                && this.openPrompt.request.reason === 'new-project') {
                await this.chooseOpen('here');
            }
        } catch (error) {
            this.reportNewProjectError(error);
        } finally {
            this.startingNewProject = false;
            this.update();
        }
    }

    protected reportNewProjectError(error: unknown): void {
        console.error('[akari-surfaces] failed to start a new project:', error);
        // 雛形や権限など、失敗の理由を一緒に示す。
        this.messages.error(
            error instanceof Error && error.message
                ? `新しい動画の作成に失敗しました（${error.message}）。`
                : '新しい動画の作成に失敗しました。'
        );
    }

    // --- U2 状態バッジ（旧 F6 現在地 1 行を置換。task 2026-08-03-home-v5-terms） --

    /**
     * 状態バッジ（U2）の解決。開いているワークスペース root が無ければ何も表示しない
     * （ホーム = プロジェクト未選択の状態はそもそも状態を持たない）。作業場ルート
     * （`creatorRootUri`。loadCreatorRootProjects が解決済み）の
     * `channels/<channel>/videos/<project>` の内側なら `kind: 'inside'`
     * （「チャンネル <名前> の設定・スタイルが効いています」）、そうでなければ
     * `kind: 'outside'`（「単体プロジェクト — チャンネルの設定は効いていません」+
     * 「チャンネルに入れる」）。クリックでの階層ナビゲーションは付けない
     * （開き方の裁定は不変 — task.md 指定）。ウィンドウタイトルへの反映は
     * U1 裁定により撤去済み（旧 pushLocationToTitle は無くなった）。
     */
    protected async refreshCurrentLocation(): Promise<void> {
        const roots = await this.workspaceService.roots;
        const projectUri = roots[0]?.resource;
        this.currentProjectUri = projectUri;
        if (!projectUri) {
            this.currentLocation = undefined;
            this.update();
            return;
        }

        const rootUri = this.creatorRootUri;
        if (rootUri) {
            const relative = rootUri.relative(projectUri)?.toString();
            const segments = relative ? relative.split('/').filter(Boolean) : [];
            if (
                segments.length === 4 &&
                segments[0] === CREATOR_ROOT_CHANNELS_DIRNAME &&
                segments[2] === CREATOR_ROOT_VIDEOS_DIRNAME
            ) {
                const channel = segments[1];
                const project = segments[3];
                this.currentLocation = { kind: 'inside', rootPath: await this.formatDisplayPath(rootUri), channel, project };
                this.update();
                return;
            }
        }

        this.currentLocation = { kind: 'outside', projectUri };
        this.update();
    }

    // --- U5 チャンネルに入れる（養子縁組。task 2026-08-03-home-v5-terms） -------

    /**
     * 「チャンネルに入れる」ボタン。作業場が既に解決できていれば既存の確認 →
     * 移動 → 開き直しへ（`confirmAndAdopt`）。1 つも解決できない（マシンに
     * チャンネルの置き場がまだ無い）ときは、失敗させずに「作成 → 取り込み」の
     * 連結フローへ分岐する（`createChannelDestinationAndJoin` ・
     * task 2026-08-04-home-no-root-flow）。
     */
    protected joinChannel = async (): Promise<void> => {
        if (this.joiningChannel || this.currentLocation?.kind !== 'outside') {
            return;
        }
        const projectUri = this.currentLocation.projectUri;
        if (!this.creatorRootUri) {
            await this.createChannelDestinationAndJoin(projectUri);
            return;
        }
        await this.confirmAndAdopt(this.creatorRootUri, projectUri);
    };

    /**
     * 作業場が既に解決できている経路（home-v5 で検証済み・不変）。(a) チャンネルが
     * 1 つなら確認ダイアログのみ (b) 複数なら QuickPick でチャンネル名を選んでから
     * 確認 (c) 実行は `performAdopt` に委ねる。
     */
    protected async confirmAndAdopt(rootUri: URI, projectUri: URI): Promise<void> {
        const channels = await this.resolveManifestChannels(rootUri);
        const channel = channels.length > 1 ? await this.pickChannel(channels) : channels[0];
        if (!channel) {
            // QuickPick をキャンセルした場合を含む（何もしない）。
            return;
        }
        const confirmed = await new ConfirmDialog({
            title: 'チャンネルに入れますか？',
            msg: `${channel} に入れます。ファイルは所定の場所に移動し、プロジェクトを開き直します。`,
            ok: '入れる',
            cancel: 'キャンセル'
        }).open();
        if (!confirmed) {
            return;
        }
        this.joiningChannel = true;
        this.update();
        await this.performAdopt(rootUri, projectUri, channel);
    }

    /**
     * 無 root 時の「作成 → 取り込み」連結フロー（task 2026-08-04-home-no-root-flow）。
     * 確認は 1 回だけ — 文言自体が「作成して、このプロジェクトを入れますか？」と
     * 作成 + 取り込みをまとめて尋ねる形なので、作成直後に `confirmAndAdopt` の
     * 2 回目の確認は挟まない。「作業場」の語は出さない（U1）— 事実表記の
     * 「データの場所: ~/Akari」だけ許可される。ensure 直後の作業場は必ず
     * チャンネルが 1 つ（`createCreatorRoot` の既定チャンネル）なので QuickPick も
     * 不要 — 解決したチャンネル名をそのまま `performAdopt` に渡す。
     */
    protected async createChannelDestinationAndJoin(projectUri: URI): Promise<void> {
        const confirmed = await new ConfirmDialog({
            title: 'チャンネルの置き場を作成しますか？',
            msg: 'チャンネルの置き場がまだありません。作成して、このプロジェクトを入れますか？（データの場所: ~/Akari）',
            ok: '作成して入れる',
            cancel: 'キャンセル'
        }).open();
        if (!confirmed) {
            return;
        }

        this.joiningChannel = true;
        this.update();
        let rootUri: URI;
        try {
            const rootUriString = await this.newProjectService.ensureCreatorRoot();
            rootUri = new URI(rootUriString);
        } catch (error) {
            console.error('[akari-surfaces] failed to ensure a channel destination:', error);
            this.messages.error(error instanceof Error ? error.message : 'チャンネルの置き場の作成に失敗しました。');
            this.joiningChannel = false;
            this.update();
            return;
        }
        // 以後の一覧・状態バッジ解決が新しい置き場を見られるようにしておく
        // （このプロジェクトはこのあと開き直されるため即座には効かないが、
        // 途中でエラーになった場合でも次の再表示から反映される）。
        this.creatorRootUri = rootUri;
        this.creatorRootAvailable = true;

        const channels = await this.resolveManifestChannels(rootUri);
        await this.performAdopt(rootUri, projectUri, channels[0]);
    }

    /**
     * 実移動 + 開き直し（`AkariNewProjectService#adoptProject` を呼ぶだけ）。
     * 呼び出し側で確認済み・`joiningChannel` を立てた後に呼ぶ。失敗したら
     * `MessageService.error` で 1 行 + 何も壊さない（adoptProject は失敗時に
     * 元の場所を残す契約 — task.md §2(d) 指定どおり）。
     */
    protected async performAdopt(rootUri: URI, projectUri: URI, channel: string): Promise<void> {
        try {
            const destinationUri = await this.newProjectService.adoptProject(rootUri.toString(), projectUri.toString(), channel);
            // 成功後はワークスペースが切り替わり本ウィジェットは作り直されるため、
            // joiningChannel を戻す必要はない。
            await this.commands.executeCommand(AKARI_COMMANDS.openProject, { uri: destinationUri, reason: 'join-channel' });
        } catch (error) {
            console.error('[akari-surfaces] failed to adopt project into a channel:', error);
            this.messages.error(error instanceof Error ? error.message : 'チャンネルへの取り込みに失敗しました。');
            this.joiningChannel = false;
            this.update();
        }
    }

    /** 複数チャンネルから 1 つを選ばせる QuickPick（U5 (b)）。キャンセル時は undefined。 */
    protected async pickChannel(channels: string[]): Promise<string | undefined> {
        const picked = await this.quickInputService.showQuickPick(
            channels.map(name => ({ label: name })),
            { placeholder: '入れるチャンネルを選択' }
        );
        return picked?.label;
    }

    /** ホームディレクトリ配下なら `~` に短縮して表示する（絶対パスのままより読みやすいため）。 */
    protected async formatDisplayPath(uri: URI): Promise<string> {
        const fsPath = uri.path.fsPath();
        try {
            const homeDirUri = await this.envVariables.getHomeDirUri();
            const homeFsPath = new URI(homeDirUri).path.fsPath();
            if (fsPath === homeFsPath) {
                return '~';
            }
            if (fsPath.startsWith(`${homeFsPath}/`) || fsPath.startsWith(`${homeFsPath}\\`)) {
                return `~${fsPath.slice(homeFsPath.length)}`;
            }
        } catch {
            // ホームディレクトリが解決できなければ絶対パスのまま表示する（フェイルセーフ側）。
        }
        return fsPath;
    }

    // --- F2 更新ポップアップ（task 2026-08-03-shell-quickwins-feedback） ------

    /**
     * 前回起動版と現在版を比べ、違えば 1 回だけ MessageService の info トースト
     * （モーダルではない）で「更新されました」を通知する。初回起動（記録なし）は
     * ポップアップを出さず記録だけ書く（task.md 指定）。バージョン記録は
     * 通知の有無に関わらず、今回の版が前回の記録と違えば毎回更新する。
     */
    protected async checkVersionNotice(): Promise<void> {
        let cacheUri: URI;
        try {
            cacheUri = (await this.resolveAkariHomeUri()).resolve(SHELL_LAST_VERSION_FILENAME);
        } catch (error) {
            console.error('[akari-surfaces] failed to resolve shell-last-version.json location:', error);
            return;
        }

        let record: ReturnType<typeof parseShellLastVersion> = null;
        try {
            const content = await this.fileService.readFile(cacheUri);
            record = parseShellLastVersion(content.value.toString());
        } catch {
            // 初回起動・壊れた記録はどちらも record=null（フェイルセーフ側）。
        }

        const appInfo = await this.applicationServer.getApplicationInfo().catch(() => undefined);
        const currentVersion = appInfo?.version ?? '0.0.0';
        const status = evaluateVersionNotice(currentVersion, record);

        if (status.shouldNotify) {
            // `MessageService.info()` は利用者がトーストを閉じる/アクションを選ぶまで
            // 解決しない Promise を返す。`checkVersionNotice` は `start()`（=
            // `AkariHomeContribution.onDidInitializeLayout`）から await されているため、
            // ここを await すると起動シーケンス全体（プリロード画面が消えるところ）が
            // ユーザーがトーストを閉じるまで止まってしまう（実機で確認したフリーズ）。
            // 通知は fire-and-forget にし、後続のアクション処理だけ `.then()` で繋ぐ。
            void this.messages.info(formatVersionNoticeText(currentVersion), '変更点を見る').then(action => {
                if (action === '変更点を見る') {
                    // {external: true} が無いと Electron 版 WindowService は内蔵ウィンドウで開いてしまう
                    this.windowService.openNewWindow(buildReleaseNotesUrl(currentVersion), { external: true });
                }
            });
        }

        if (record?.lastVersion !== currentVersion) {
            try {
                const next = withRecordedVersion(currentVersion, new Date().toISOString());
                try {
                    await this.fileService.createFolder(cacheUri.parent);
                } catch {
                    // 既に存在する場合は無視する。
                }
                await this.fileService.writeFile(cacheUri, BinaryBuffer.fromString(`${JSON.stringify(next, null, 2)}\n`));
            } catch (error) {
                console.error('[akari-surfaces] failed to record shell-last-version.json:', error);
            }
        }
    }

    // --- 更新チェック（U2 v0）: 状態読み込み・バックグラウンド fetch・アクション ---

    /**
     * ホームディレクトリ側の AKARI 共有ディレクトリを解決する。`AKARI_HOME` が
     * 設定されていればそれ自体をルートとし（CLI 側 `resolveAkariHome` と同じ規約）、
     * 無ければホームディレクトリ配下の `.akari/` を使う。更新キャッシュ・
     * パートナー接続マーカー・作業場マシンポインタ（creator-root.json）は
     * いずれもこの直下に置かれる。
     */
    protected async resolveAkariHomeUri(): Promise<URI> {
        const override = await this.envVariables.getValue('AKARI_HOME');
        if (override?.value) {
            return URI.fromFilePath(override.value);
        }
        const homeDirUri = await this.envVariables.getHomeDirUri();
        return new URI(homeDirUri).resolve(AKARI_HOME_SUBDIR);
    }

    /** 更新チェックのキャッシュファイル（`<AKARI ホーム>/update-check.json`）。 */
    protected async resolveUpdateCacheUri(): Promise<URI> {
        return (await this.resolveAkariHomeUri()).resolve(UPDATE_CACHE_FILENAME);
    }

    /**
     * キャッシュを読み、現在のシェル版と比較して更新通知を出すか決める。
     * ファイルが無い・壊れている場合は「新版なし」と同じ扱いで沈黙する（契約の沈黙原則）。
     * 読み込み後、バックグラウンド fetch を fire-and-forget で起動する（await しない —
     * ここが「起動をブロックしない」の核）。
     */
    protected async loadUpdateStatus(): Promise<void> {
        const updaterApi = this.resolveElectronUpdaterApi();
        if (updaterApi) {
            this.updateUiEnabled = (await updaterApi.getCapabilities().catch(() => ({ updateUiEnabled: false }))).updateUiEnabled;
        }
        if (!this.updateUiEnabled) {
            this.syncUpdateToast();
            return;
        }
        try {
            const cacheUri = await this.resolveUpdateCacheUri();
            this.updateCacheUri = cacheUri;
            const content = await this.fileService.readFile(cacheUri);
            this.updateRawCache = parseUpdateCache(content.value.toString());
        } catch {
            this.updateRawCache = null;
        }
        const appInfo = await this.applicationServer.getApplicationInfo().catch(() => undefined);
        const currentVersion = appInfo?.version ?? '0.0.0';
        const settings = await this.updateSettings.getUpdateSettings().catch(() => ({ channel: 'stable' as const, autoCheck: true }));
        const override = await this.envVariables.getValue('AKARI_UPDATE_FEED_URL').catch(() => undefined);
        const channel = resolveUpdateChannel(settings.channel);
        const feedUrl = resolveUpdateFeedUrl(channel, override?.value);
        this.updateStatus = evaluateUpdateStatus(currentVersion, this.updateRawCache, this.resolveShellPlatformKey(), channel, feedUrl);
        this.syncUpdateToast();
        this.update();
        void this.triggerUpdateBackgroundFetch();
    }

    /** F7-v1（task 2026-08-03-home-v5-terms）: 「更新する」ボタンが読む自プラットフォームのキー。Linux 等は undefined（notes_url へフォールバック）。 */
    protected resolveShellPlatformKey(): ShellPlatformKey | undefined {
        if (isOSX) {
            return 'mac';
        }
        if (isWindows) {
            return 'win';
        }
        return undefined;
    }

    /**
     * バックグラウンド fetch。CLI 側は短命プロセスのため detached な子プロセスに
     * 切り離す必要があるが、シェルは長寿命プロセスなので await しない非同期呼び出し
     * だけで同じ非ブロッキング特性を得られる（fetch はブラウザ標準 API・
     * フロントエンドから直接呼べる）。失敗・オフライン・スキーマ不明はすべて沈黙する。
     */
    protected async triggerUpdateBackgroundFetch(): Promise<void> {
        try {
            await runAutomaticNetworkCheck(() => this.updateSettings.getUpdateSettings(), async () => {
                const feedUrlVar = await this.envVariables.getValue('AKARI_UPDATE_FEED_URL');
                const settings = await this.updateSettings.getUpdateSettings().catch(() => ({ channel: 'stable' as const, autoCheck: true }));
                const channel = resolveUpdateChannel(settings.channel);
                const feedUrl = resolveUpdateFeedUrl(channel, feedUrlVar?.value);
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000);
                let response: Response;
                try {
                    response = await fetch(feedUrl, { signal: controller.signal });
                } finally {
                    clearTimeout(timeout);
                }
                if (!response.ok) {
                    return;
                }
                const feed = await response.json();
                if (!feed || typeof feed !== 'object' || typeof feed.schema !== 'number' || typeof feed.product !== 'string') {
                    return;
                }
                const cacheUri = this.updateCacheUri ?? await this.resolveUpdateCacheUri();
                const nowIso = new Date().toISOString();
                const next: UpdateCache = { schema: 1, fetched_at: nowIso, feed, feed_url: feedUrl, dismissed: this.updateRawCache?.dismissed ?? {} };
                try {
                    await this.fileService.createFolder(cacheUri.parent);
                } catch {
                    // 既に存在する場合は無視する。
                }
                await this.fileService.writeFile(cacheUri, BinaryBuffer.fromString(`${JSON.stringify(next, null, 2)}\n`));
                // このセッション内でも次回のホーム表示から反映されるよう、状態を更新しておく
                // （契約は「次回セッションで効く」を許容するが、ここでは追加コストなく即時反映できる）。
                this.updateRawCache = next;
                const appInfo = await this.applicationServer.getApplicationInfo().catch(() => undefined);
                this.updateStatus = evaluateUpdateStatus(appInfo?.version ?? '0.0.0', next, this.resolveShellPlatformKey(), channel, feedUrl);
                this.syncUpdateToast();
                this.update();
            });
        } catch {
            // オフライン・タイムアウト・JSON パース失敗などをすべてここで沈黙する。
        }
    }

    /** この版を自動表示しない。通知一覧には再表示できる履歴を残す。 */
    protected dismissUpdate = async (): Promise<void> => {
        const version = this.updateStatus.latestVersion;
        if (!version) {
            return;
        }
        try {
            const cacheUri = this.updateCacheUri ?? await this.resolveUpdateCacheUri();
            const next = withDismissedVersion(this.updateRawCache, version, new Date().toISOString());
            try {
                await this.fileService.createFolder(cacheUri.parent);
            } catch {
                // 既に存在する場合は無視する。
            }
            await this.fileService.writeFile(cacheUri, BinaryBuffer.fromString(`${JSON.stringify(next, null, 2)}\n`));
            this.updateRawCache = next;
        } catch (error) {
            console.error('[akari-surfaces] failed to record update dismissal:', error);
        }
        this.updateStatus = { available: false, dismissed: true, latestVersion: version };
        this.syncUpdateToast();
        this.update();
    };

    /**
     * 「更新する」: electron-updater が使える環境（パッケージ済み Electron）では
     * main プロセスへ即時チェックを発火する — autoDownload で裏 DL が始まり、イベントが
     * 通知を「ダウンロード中」→「DL 済み・再起動で適用」へ進める（アプリ内で完結）。
     * 直近が error でも API があれば必ず先に再チェックする。再試行も失敗した場合、または
     * updater API が使えない場合だけ、理由を一行表示して外部ブラウザへ縮退する。
     */
    protected downloadUpdate = (): void => {
        if (!this.updateUiEnabled) { return; }
        const api = this.resolveElectronUpdaterApi();
        const action = resolveUpdateButtonAction(this.updaterUiState, api !== undefined);
        if (action === 'check' && api) {
            this.updaterUiState = beginUserInitiatedUpdaterCheck(this.updaterUiState);
            this.syncUpdateToast();
            this.update();
            const channel = this.updateStatus.channel ?? this.updateRawCache?.feed?.channel;
            void api.checkForUpdatesNow({
                userInitiated: true,
                channel: channel === 'stable' || channel === 'prerelease' ? channel : undefined
            }).catch(() => {
                this.applyUpdaterEvent({ kind: 'error', reason: '更新処理を開始できませんでした' });
            });
            return;
        }
        if (action === 'browser-fallback') {
            this.updaterUiState = applyImmediateUpdaterFallback(
                this.updaterUiState,
                'アプリ内更新機能を利用できませんでした'
            );
            this.syncUpdateToast();
            this.update();
            this.openUpdateDownloadInBrowser();
        }
    };

    /**
     * F7-v1（task 2026-08-03-home-v5-terms）: 自プラットフォームの配布物 URL（無ければ
     * notes_url。`evaluateUpdateStatus`/`resolveUpdateDownloadUrl` が解決済み）を外部
     * ブラウザで開いてダウンロードを開始する。`{ external: true }` を明示しないと
     * Electron 版 `WindowService`（`electron-main-window-service-impl.js`）は新規 Electron
     * ウィンドウで URL を内部的に開くだけになり（`shell.openExternal` が呼ばれない）、
     * バイナリ配布物のダウンロードが実ブラウザのダウンロードマネージャを経由しない。
     */
    protected openUpdateDownloadInBrowser(): void {
        if (!this.updateUiEnabled) { return; }
        const url = this.updateStatus.downloadUrl ?? resolveUpdateDownloadUrl(this.updateRawCache?.feed, this.resolveShellPlatformKey());
        if (url) {
            this.windowService.openNewWindow(url, { external: true });
        }
    }

    // --- U3 electron-updater（内部リポ契約 update-and-versioning §11）: main プロセス
    // イベントの購読と「今すぐ再起動して適用」アクション ---

    /**
     * `window.electronAkariUpdater`（akari-surfaces の electron-main/preload が
     * 公開する API）を取り出す。`Window` 型の直接プロパティアクセスに頼らず明示的に
     * キャストするのは akari-project の revealInFileManager と同じ流儀
     * （akari-project-contribution.ts 参照）。未署名の開発ビルド・`theia start`
     * （非 Electron）では存在しないため undefined を返し、呼び出し側で沈黙する。
     */
    protected resolveElectronUpdaterApi(): ElectronAkariUpdaterApi | undefined {
        return (window as Window & { electronAkariUpdater?: ElectronAkariUpdaterApi }).electronAkariUpdater;
    }

    /**
     * main プロセスの electron-updater イベントを購読する。既に発火済みのイベント
     * （このウィジェットの生成が DL 完了より後になったケース）は `getLastEvent` で
     * 追いつく。API 不在（開発ビルド）・IPC 失敗はすべて沈黙する（契約 §11）。
     */
    protected initUpdaterEvents(): void {
        const api = this.resolveElectronUpdaterApi();
        if (!api) {
            return;
        }
        api.getLastEvent().then(event => {
            if (event) {
                this.applyUpdaterEvent(event);
            }
        }).catch(() => {
            // 沈黙（契約 §11）。
        });
        this.updaterUnsubscribe = api.onEvent(event => this.applyUpdaterEvent(event));
        this.toDispose.push({ dispose: () => this.updaterUnsubscribe?.() });
    }

    protected applyUpdaterEvent(event: ShellUpdaterEvent): void {
        const resolvedEvent = reconcileVisibleUpdateEvent(this.updaterUiState, event, this.updateStatus.latestVersion);
        const shouldOpenFallback = shouldOpenUpdaterBrowserFallback(this.updaterUiState, resolvedEvent, this.updateUiEnabled);
        this.updaterUiState = applyShellUpdaterEvent(this.updaterUiState, resolvedEvent);
        this.syncUpdateToast();
        if (shouldOpenFallback) {
            // ユーザーが明示的に「更新する」を押した再試行の失敗だけ、理由を表示して
            // 手動 DL（外部ブラウザ）へ引き継ぐ。バックグラウンドチェックの失敗では開かない。
            this.openUpdateDownloadInBrowser();
        }
        this.update();
    }

    /** 「今すぐ再起動して適用」ボタン: main プロセスへ委ねる（quitAndInstall はこのウィジェット側では呼ばない）。 */
    protected restartAndApplyUpdate = (): void => {
        const api = this.resolveElectronUpdaterApi();
        if (!api) {
            return;
        }
        void api.restartAndInstall();
    };

    /** Theia notifications do not support the app icon and version-specific actions; the owned toast follows this widget's existing update state. */
    protected syncUpdateToast(): void {
        if (!this.updateUiEnabled) {
            this.updateToast.setState(undefined);
            return;
        }
        const stage = noticeStage(this.updateStatus.available || !!this.updateStatus.dismissed, !!this.updaterUiState.downloading, this.updaterUiState.downloaded);
        const version = this.updaterUiState.downloadedVersion ?? this.updaterUiState.downloadingVersion ?? this.updateStatus.latestVersion;
        const notesUrl = this.updateStatus.notesUrl ?? this.updateRawCache?.feed?.notes_url;
        this.updateToast.setState(stage && version ? {
            stage, version, notesUrl,
            channel: this.updateStatus.channel ?? this.updateRawCache?.feed?.channel,
            summary: this.updateStatus.summary,
            sizeLabel: this.updateStatus.sizeLabel,
            checking: !!this.updaterUiState.checkRequestedByUser,
            fallbackReason: this.updaterUiState.fallbackReason,
            downloadUrl: this.updateStatus.downloadUrl ?? resolveUpdateDownloadUrl(this.updateRawCache?.feed, this.resolveShellPlatformKey())
        } : undefined, { dismissed: this.updateStatus.dismissed });
    }

    /** CDP verification entry: window.theia.container.get(AkariHomeWidget).showUpdateForTest('found'|'downloading'|'ready'). */
    showUpdateForTest(stage: 'found' | 'downloading' | 'ready', version = '99.0.0', notesUrl?: string, progress?: number): void {
        this.updateToast.showForTest(stage, version, notesUrl, progress);
    }

    protected async loadCurrentBand(): Promise<void> {
        const uri = this.currentProjectUri;
        if (!uri) { return; }
        this.currentDisplayPath = await this.formatDisplayPath(uri);
        this.currentFrames = await this.loadProjectCardThumbnails(uri);
        let edit: unknown;
        try { edit = JSON.parse((await this.fileService.readFile(uri.resolve('edit.json'))).value.toString()); } catch { /* no edit yet */ }
        this.currentCanPreview = hasPreviewContent(edit);
        let assetCount: number | undefined;
        let assetBytes: number | undefined;
        try {
            const assets = await this.fileService.resolve(uri.resolve('assets'), { resolveMetadata: true });
            if (assets.children) {
                const media = assets.children.filter(child => child.isFile && /\.(mp4|mov|m4v|webm|mkv|avi|mp3|wav|m4a|flac|jpg|jpeg|png|webp|heic)$/i.test(child.name));
                assetCount = media.length;
                assetBytes = media.length ? media.reduce((sum, child) => sum + (child.size ?? 0), 0) : undefined;
            }
        } catch { /* optional metric */ }
        let lastExport: number | undefined;
        try {
            const exports = await this.fileService.resolve(uri.resolve('exports'), { resolveMetadata: true });
            const times = (exports.children ?? []).filter(child => child.isFile && child.mtime && /\.(mp4|mov|m4v|webm)$/i.test(child.name)).map(child => child.mtime!);
            lastExport = times.length ? Math.max(...times) : undefined;
        } catch { /* optional metric */ }
        this.currentStats = buildHomeStats(edit, assetCount, assetBytes, lastExport);
        await this.loadProjectHistory(uri);
        this.update();
    }

    protected async loadProjectHistory(root: URI): Promise<void> {
        const entries: HomeHistoryEntry[] = [];
        try {
            const dir = await this.fileService.resolve(root.resolve('.akari/events'), { resolveMetadata: true });
            await Promise.all((dir.children ?? []).filter(child => child.isFile && /\.json$/i.test(child.name)).map(async child => {
                try {
                    const value = JSON.parse((await this.fileService.readFile(child.resource)).value.toString());
                    const entry = eventHistoryEntry(value, child.mtime ?? 0);
                    if (entry) entries.push(entry);
                } catch { /* 壊れた記録だけ飛ばす。 */ }
            }));
        } catch { /* 記録が無い。 */ }
        this.latestExport = undefined;
        try {
            const dir = await this.fileService.resolve(root.resolve('exports'), { resolveMetadata: true });
            const videos = (dir.children ?? []).filter(child => child.isFile && /\.(mp4|mov|m4v|webm|mkv)$/i.test(child.name))
                .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
            this.latestExport = videos[0]?.resource;
            for (const video of videos) entries.push(exportHistoryEntry(video.name, video.mtime ?? 0));
        } catch { /* 書き出しが無い。 */ }
        this.latestReport = undefined;
        try {
            const dir = await this.fileService.resolve(root.resolve('.akari/reports'), { resolveMetadata: true });
            this.latestReport = (dir.children ?? []).filter(child => child.isFile && /\.html?$/i.test(child.name))
                .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))[0]?.resource;
        } catch { /* レポートが無い。 */ }
        if (!this.latestReport && await this.fileService.exists(root.resolve('analysis-report.html'))) {
            this.latestReport = root.resolve('analysis-report.html');
        }
        this.historyEntries = sortHomeHistory(entries);
    }

    async refreshProjectListData(): Promise<void> {
        await this.refreshProjectBrowser();
        this.projectListRefreshToken++;
        this.widgets.tryGetWidget<ReactWidget>(PROJECT_LIST_WIDGET_ID)?.update();
    }

    setListChannelOverride(channel: string | undefined): void {
        const next = channel !== undefined && this.channels.includes(channel) ? channel : undefined;
        if (this.listChannelOverride === next) return;
        this.listChannelOverride = next;
        this.widgets.tryGetWidget<ReactWidget>(PROJECT_LIST_WIDGET_ID)?.update();
    }

    protected listChannel(): string {
        return resolveListChannel({
            scope: this.scope.scope,
            override: this.listChannelOverride,
            workspaceChannel: this.scope.scope === 'project' && this.currentLocation?.kind === 'inside' ? this.currentLocation.channel : undefined,
            channels: this.channels,
            lastChannel: localStorage.getItem(AKARI_LAST_CHANNEL_STORAGE_KEY),
            fallback: CREATOR_ROOT_DEFAULT_CHANNEL
        });
    }

    renderProjectListForTab(): React.ReactNode {
        const channel = this.listChannel();
        const rows = this.buildProjectRows();
        return <ProjectListView channel={channel} rows={rows.filter(row => row.channel === channel)} refreshToken={this.projectListRefreshToken}
            standalone={rows.filter(row => row.standalone)}
            currentName={this.scope.scope === 'project' ? rows.find(row => row.current)?.name ?? this.currentProjectUri?.path.base : undefined}
            onNew={rect => { this.newProjectOriginRect = rect; void this.startNewProject(); }} onRefresh={() => void this.refreshProjectListData()}
            onNewStandalone={() => void this.chooseStandaloneFolder()}
            onOpenChannel={() => void this.shell.revealWidget(RAIL_CHANNEL_WIDGET_ID)}
            onOpen={(row, rect) => this.openCreatorRootProject(row.uri, rect)}
            readPresence={uri => this.progress.readPresence(uri)} loadThumbnails={uri => this.loadProjectCardThumbnails(uri)} />;
    }

    protected async runAvailableCommand(id: string, ...args: unknown[]): Promise<void> {
        this.menuOpen = false;
        this.update();
        if (!this.commandRegistry.getCommand(id)) { this.messages.warn('この版では使えません'); return; }
        await this.commands.executeCommand(id, ...args);
    }

    protected async openTemplateSheet(): Promise<void> {
        this.projectTemplates = [...BUILTIN_PROJECT_TEMPLATES];
        this.homeDialog = 'templates';
        this.update();
        const channel = this.currentLocation?.kind === 'inside' ? this.currentLocation.channel : undefined;
        if (!channel || !this.creatorRootUri) return;
        const directory = this.creatorRootUri.resolve(CREATOR_ROOT_CHANNELS_DIRNAME).resolve(channel).resolve('templates');
        try {
            const files = (await this.fileService.resolve(directory)).children ?? [];
            const loaded = await Promise.all(files.filter(file => !file.isDirectory && /\.md$/i.test(file.name))
                .map(async file => {
                    try { return parseTemplateMarkdown(file.name, (await this.fileService.readFile(file.resource)).value.toString()); }
                    catch { return undefined; }
                }));
            const templates = loaded.filter((template): template is ProjectTemplate => template !== undefined);
            if (this.homeDialog === 'templates') {
                this.projectTemplates = [...templates, ...BUILTIN_PROJECT_TEMPLATES];
                this.update();
            }
        } catch { /* チャンネルにテンプレが無ければ同梱だけを表示する。 */ }
    }

    protected async writeProjectTitle(title: string, onlyIfEmpty = false): Promise<void> {
        const root = this.currentProjectUri;
        if (!root) return;
        const uri = root.resolve(INTAKE_RELATIVE_PATH);
        const intake = JSON.parse((await this.fileService.readFile(uri)).value.toString());
        if (onlyIfEmpty && parseIntakeTitle(intake)) return;
        intake.title = title;
        await this.fileService.writeFile(uri, BinaryBuffer.fromString(`${JSON.stringify(intake, null, 2)}\n`));
        await Promise.all([this.refreshHomeFlow(), this.loadCreatorRootProjects()]);
    }

    protected beginProjectRename(): void {
        const root = this.currentProjectUri;
        if (!root) return;
        this.projectNameDraft = this.buildProjectRows().find(row => row.current)?.name ?? root.path.base;
        this.renamingProject = true;
        this.menuOpen = false;
        this.update();
    }

    protected async finishProjectRename(save: boolean): Promise<void> {
        if (!this.renamingProject) return;
        this.renamingProject = false;
        const title = this.projectNameDraft.trim();
        this.update();
        if (!save || !title) return;
        try { await this.writeProjectTitle(title); }
        catch { this.messages.error('名前を変更できませんでした。'); }
    }

    protected async applyProjectTemplate(template: ProjectTemplate): Promise<void> {
        const root = this.currentProjectUri;
        if (!root || this.applyingTemplate) return;
        this.applyingTemplate = true;
        this.update();
        try {
            const directory = root.resolve('planning');
            if (!await this.fileService.exists(directory)) await this.fileService.createFolder(directory);
            const existing = (await this.fileService.resolve(directory)).children?.map(file => file.name) ?? [];
            const target = directory.resolve(planFileName(existing));
            await this.fileService.writeFile(target, BinaryBuffer.fromString(template.planMarkdown));
            await this.writeProjectTitle(defaultProjectTitle(template.name, new Date()), true);
            this.closeHomeDialog();
            this.messages.info('企画書のひな形が planning/ に入りました');
        } catch {
            this.messages.error('企画書のひな形を追加できませんでした。');
        } finally {
            this.applyingTemplate = false;
            this.update();
        }
    }

    protected async startFromMaterials(): Promise<void> {
        await this.importForStartKind('import');
        try {
            const result = await this.commands.executeCommand<string>('akari.partner.typePrompt', '素材を見て企画を下書きして');
            if (result === 'no-partner') this.messages.info('右の「パートナー」からパートナーを開くと、企画を下書きしてもらえます');
        } catch { this.messages.info('右の「パートナー」からパートナーを開くと、企画を下書きしてもらえます'); }
    }

    protected async startByTalking(): Promise<void> {
        try {
            await this.commands.executeCommand('akari.partner.open');
            await this.commands.executeCommand('akari.partner.typePrompt', 'この動画の企画書を一緒に作って');
        } catch { this.messages.info('右の「パートナー」からパートナーを開いてください'); }
    }

    protected async openProgressStage(key: ProjectStageKey): Promise<void> {
        if (key === 'plan' || key === 'assets') {
            await this.runAvailableCommand(AKARI_COMMANDS.catalogOpen, { tab: 'project' });
        } else if (key === 'edit') {
            await this.runAvailableCommand(AKARI_COMMANDS.previewEnsureVisible, { editUri: this.currentProjectUri?.resolve('edit.json').toString() });
        } else if (key === 'check') {
            if (this.latestReport) await open(this.openers, this.latestReport);
            else this.messages.info('まだレポートがありません。');
        } else {
            await this.runAvailableCommand(AKARI_COMMANDS.exportOpenDialog);
        }
    }

    protected renderProjectHome(): React.ReactNode {
        const root = this.currentProjectUri;
        if (!root) return undefined;
        const rows = this.buildProjectRows();
        const current = rows.find(row => row.current);
        const name = current?.name ?? root.path.base;
        const channel = this.currentLocation?.kind === 'inside' ? this.currentLocation.channel : undefined;
        const others = channel ? rows.filter(row => row.channel === channel && !row.current) : [];
        const presence = this.progress.presence ?? EMPTY_PRESENCE;
        const summary = stageSummary(presence);
        const status: { title: string; body: string; primary?: { label: string; run: () => void }; secondary: { label: string; run: () => void } } =
            summary === '素材まで' && presence.assetFiles === 0
                ? { title: '企画ができました', body: '次は素材を入れます。動画・写真・音声をこのプロジェクトに入れてください。',
                    primary: { label: '素材を入れる', run: () => void this.openProgressStage('assets') },
                    secondary: { label: 'パートナーに頼む', run: () => void this.runAvailableCommand(AKARI_COMMANDS.partnerOpen) } }
                : { title: summary === '素材まで' ? '企画と素材がそろっています' : summary === '編集の途中' ? '編集の途中' : summary === '確認中' ? '確認中' : '書き出しました',
                    body: summary === '素材まで' ? `素材 ${presence.assetFiles} 件。次は並べる段です。` : summary === '編集の途中' ? '続きから開けます。' : summary === '確認中' ? '直したら書き出せます。' : '上の絵を押すと再生します。',
                    primary: summary === '書き出し済み' ? undefined : { label: summary === '素材まで' ? '編集に入る' : summary === '編集の途中' ? '続きを編集する' : '書き出す',
                        run: () => void this.openProgressStage(summary === '確認中' ? 'export' : 'edit') },
                    secondary: { label: 'AI エージェントを開く', run: () => void this.runAvailableCommand(AKARI_COMMANDS.partnerOpen) } };
        return <div className='akari-os-project-home'>
            <div className='akari-os-phead'>
                {this.latestExport ? <div className='akari-os-poster'><video src={this.latestExport.toString()} controls preload='metadata' /></div>
                    : this.currentCanPreview ? <button type='button' className='akari-os-poster' data-akari-project-poster='true' aria-label='プレビューで見る'
                        onClick={() => void this.openProgressStage('edit')}>
                        {this.currentFrames[0] && <img src={this.currentFrames[0]} alt='' />}<span className='play'>▶</span></button>
                        : <div className='akari-os-poster'><span className='codicon codicon-device-camera-video' aria-hidden='true' /></div>}
                <div style={{ minWidth: 0, position: 'relative' }}><div className='akari-os-project-title'>
                    {this.renamingProject ? <input type='text' className='theia-input akari-os-name-input' autoFocus
                        aria-label='プロジェクトの名前' value={this.projectNameDraft}
                        onChange={event => { this.projectNameDraft = event.currentTarget.value; this.update(); }}
                        onKeyDown={event => { if (event.key === 'Enter') void this.finishProjectRename(true); else if (event.key === 'Escape') void this.finishProjectRename(false); }}
                        onBlur={() => void this.finishProjectRename(true)} />
                        : <h1><button type='button' className='akari-os-name-button' data-akari-project-rename='true'
                            title='名前を変える' onClick={() => this.beginProjectRename()}>{name}</button></h1>}
                    <span className='actions'>
                    <button type='button' data-akari-project-history='true' onClick={() => { this.historyOpen = !this.historyOpen; this.menuOpen = false; this.update(); }}>履歴</button>
                    <button type='button' data-akari-project-menu='true' aria-label='このプロジェクトのメニュー' onClick={() => { this.menuOpen = !this.menuOpen; this.historyOpen = false; this.update(); }}>⋯</button>
                </span></div>
                    <p>{this.currentStats.duration && <span>尺 <b>{this.currentStats.duration}</b></span>}
                        <span>素材 <b>{presence.assetFiles}</b></span>
                        <span>最後に触った <b>{current?.updatedAt ? new Date(current.updatedAt).toLocaleString('ja-JP') : '不明'}</b></span></p>
                    {this.historyOpen && <div className='akari-os-popover akari-os-history'><h4>履歴 · {name}</h4>
                        <ul>{this.historyEntries.map((entry, index) => <li key={index}><time>{entry.time ? new Date(entry.time).toLocaleString('ja-JP') : '日時なし'}</time><span>{entry.label}</span></li>)}</ul>
                        {!this.historyEntries.length && <p>まだ履歴がありません。</p>}
                        {this.latestReport && <button type='button' data-akari-project-report='true' onClick={() => void open(this.openers, this.latestReport!)}>分析レポートを見る</button>}</div>}
                    {this.menuOpen && <div className='akari-os-popover'>
                        <button type='button' data-akari-project-rename-menu='true' onClick={() => this.beginProjectRename()}>名前を変える</button>
                        <button type='button' data-akari-project-reveal='true' onClick={() => void this.runAvailableCommand('akari.project.revealProjectRoot')}>{isOSX ? 'Finder で表示' : 'エクスプローラーで開く'}</button>
                        <button type='button' data-akari-project-browser-preview='true' onClick={() => void this.runAvailableCommand(AKARI_COMMANDS.previewServerOpen)}>ブラウザプレビュー</button>
                        <button type='button' data-akari-project-clean='true' onClick={() => void this.runAvailableCommand(AKARI_COMMANDS.projectCleanData)}>不要なデータを整理</button>
                        <hr /><button type='button' data-akari-project-close='true' onClick={() => void this.commands.executeCommand(AKARI_COMMANDS.closeProject)}>このプロジェクトを閉じる</button>
                    </div>}
                </div>
            </div>
            <div className='akari-os-steps' aria-label='進み具合'>{(this.progress.stages ?? computeProjectStages(presence)).map((stage, index, stages) => <div className='akari-os-stage-cell' key={stage.key}><button type='button' data-akari-project-stage={stage.key}
                className={`akari-os-step${stage.done ? ' done' : ''}${stage.current ? ' now' : ''}${index > 0 && stages[index - 1].done ? ' after-done' : ''}`}
                onClick={() => void this.openProgressStage(stage.key)}><span className='dot'>{stage.done ? '✓' : '○'}</span><b>{stage.label}</b>
                <small>{stage.current ? 'いまここ' : stage.detail}</small></button>
                {stage.key === 'plan' && <button type='button' className='akari-os-stage-detail' data-akari-plan-detail='true'
                    onClick={() => void this.openIntakeForm()}>詳しく</button>}</div>)}</div>
            {summary === '作ったばかり' ? <section className='akari-os-start-section'><h2>どこから始めますか</h2>
                <div className='akari-os-start-grid'>
                    <button type='button' className='akari-os-start-card' data-akari-start='templates' onClick={() => void this.openTemplateSheet()}><b>テンプレから</b><span>このチャンネルのテンプレ。枠・字幕・企画書のひな形が入ります。</span></button>
                    <button type='button' className='akari-os-start-card' data-akari-start='materials' onClick={() => void this.startFromMaterials()}><b>素材から</b><span>動画・写真・音声を入れると、パートナーが中身を見て企画を下書きします。</span></button>
                    <button type='button' className='akari-os-start-card' data-akari-start='talk' onClick={() => void this.startByTalking()}><b>話して</b><span>作りたい動画をパートナーに話すと、企画書から一緒に作ります。</span></button>
                </div></section> : <section className='akari-os-status'><div><span className='label'>いまの状態</span><h4>{status.title}</h4><p>{status.body}</p></div>
                <div className='actions'>{status.primary && <button type='button' className='theia-button main' onClick={status.primary.run}>{status.primary.label}</button>}
                    <button type='button' className='theia-button secondary' onClick={status.secondary.run}>{status.secondary.label}</button></div>
            </section>}
            {channel && <section><div className='akari-os-other-heading'><h3>{channel} のほかのプロジェクト</h3><small>{others.length} 本</small>
                <button type='button' data-akari-project-list='true' onClick={() => void this.commands.executeCommand(AKARI_COMMANDS.openProjectList)}>プロジェクト一覧へ</button></div>
                <div className='akari-os-other-grid'>{others.map(row => <ProjectCard key={row.key} row={row} compact refreshToken={this.projectListRefreshToken}
                    onOpen={(item, rect) => this.openCreatorRootProject(item.uri, rect)}
                    readPresence={uri => this.progress.readPresence(uri)} loadThumbnails={uri => this.loadProjectCardThumbnails(uri)} />)}</div></section>}
        </div>;
    }

    protected renderCurrentBand(): React.ReactNode {
        if (!this.currentProjectUri) { return undefined; }
        const row = this.buildProjectRows().find(candidate => candidate.current);
        const name = row?.name ?? this.currentProjectUri.path.base;
        const channel = this.currentLocation?.kind === 'inside' ? this.currentLocation.channel : undefined;
        return <CurrentProjectBand name={name} channel={channel} path={this.currentDisplayPath || this.currentProjectUri.path.fsPath()}
            frames={this.currentFrames} stats={this.currentStats} canPreview={this.currentCanPreview}
            onPreview={() => void this.openOutputPreview(true)} onReveal={() => void this.commands.executeCommand(REVEAL_IN_FILE_MANAGER_COMMAND, this.currentProjectUri)}
            onSwitch={() => void this.openChannelSwitcher()} onJoin={() => void this.joinChannel()} />;
    }

    protected async openExportDialog(): Promise<void> {
        await this.commands.executeCommand(OPEN_EXPORT_DIALOG.id);
    }

    protected async openOutputPreview(play: boolean): Promise<void> {
        const root = this.currentProjectUri;
        if (!root || !this.currentCanPreview || !await this.fileService.exists(root.resolve('edit.json'))) {
            this.messages.info('まだ映像がありません。素材を入れてください。');
            return;
        }
        try {
            const widget = await open(this.openers, root.resolve('edit.json'), { mode: 'activate' });
            if (play) {
                (widget as unknown as { sendMessage?: (message: unknown) => void }).sendMessage?.({ type: 'akari-preview-set-playback', playing: true });
            }
        } catch { this.messages.error('出力プレビューを開けませんでした。'); }
    }

    protected closeHomeDialog = (): void => { this.homeDialog = undefined; this.update(); };

    protected async chooseStandaloneFolder(): Promise<void> {
        const picked = await this.fileDialogs.showOpenDialog({
            title: '単体プロジェクトを作るフォルダを選ぶ',
            canSelectFiles: false, canSelectFolders: true, canSelectMany: false
        });
        if (!picked) { return; }
        const folder = Array.isArray(picked) ? picked[0] : picked;
        if (!folder) { return; }
        this.standaloneFolder = folder;
        const stem = newProjectNameStem();
        let name = stem;
        for (let index = 2; await this.fileService.exists(folder.resolve(name)); index++) {
            name = `${stem}-${index}`;
        }
        this.standaloneDestination = folder.resolve(name);
        this.homeDialog = 'standalone-create';
        this.update();
    }

    protected async chooseFolder(): Promise<void> {
        const folder = await this.fileDialogs.showOpenDialog({ title: 'プロジェクトを開く', canSelectFiles: false, canSelectFolders: true });
        if (!folder) { return; }
        if (await this.fileService.exists(folder.resolve('.akari'))) {
            await this.commands.executeCommand(AKARI_COMMANDS.openProject, { uri: folder.toString(), reason: 'folder' });
            return;
        }
        this.chosenFolder = folder;
        this.openChoice = 'channel';
        this.homeDialog = 'open';
        this.update();
    }

    protected async beginChosenFolder(): Promise<void> {
        const folder = this.chosenFolder;
        if (!folder) { return; }
        this.closeHomeDialog();
        try {
            await this.newProjectService.createProject(folder.toString());
            let target = folder;
            if (this.openChoice === 'channel') {
                let root = this.creatorRootUri;
                if (!root) { root = new URI(await this.newProjectService.ensureCreatorRoot()); }
                const channel = this.currentLocation?.kind === 'inside' ? this.currentLocation.channel : await this.resolveDefaultChannelName(root);
                target = new URI(await this.newProjectService.adoptProject(root.toString(), folder.toString(), channel));
            }
            await this.commands.executeCommand(AKARI_COMMANDS.openProject, { uri: target.toString(), reason: 'new-project' });
        } catch (error) { this.messages.error(error instanceof Error ? error.message : 'プロジェクトを開けませんでした。'); }
    }

    protected async openChannelSwitcher(): Promise<void> {
        if (!this.creatorRootUri) { return; }
        this.channels = await this.resolveManifestChannels(this.creatorRootUri);
        this.homeDialog = 'channels';
        this.update();
    }

    protected chooseChannel(channel: string): void {
        this.pendingChannel = channel;
        this.pendingChannelProjectUri = undefined;
        this.homeDialog = 'channel-choice';
        this.update();
    }

    async openNewChannelDialog(): Promise<void> {
        this.newChannelName = '';
        this.newChannelError = '';
        if (!this.creatorRootUri) {
            this.creatorRootUri = await this.resolveCreatorRootDir();
        }
        if (this.creatorRootUri && this.channels.length === 0) {
            this.channels = await this.resolveManifestChannels(this.creatorRootUri);
        }
        if (!this.creatorRootUri) {
            this.newChannelError = '作業場が見つかりません。';
        }
        this.homeDialog = 'channel-create';
        this.update();
    }

    /** チャンネルのフォルダとマニフェスト登録を作る。 */
    protected async createNewChannel(): Promise<void> {
        if (this.creatingChannel) { return; }
        if (!this.creatorRootUri) {
            this.newChannelError = '作業場が見つかりません。';
            this.update();
            return;
        }
        const validation = validateChannelName(this.newChannelName, this.channels);
        if (!validation.name) {
            this.newChannelError = validation.error ?? 'チャンネル名を確認してください。';
            this.update();
            return;
        }
        const channel = validation.name;
        const root = this.creatorRootUri;
        this.creatingChannel = true;
        this.newChannelError = '';
        this.update();
        try {
            const videos = root.resolve(CREATOR_ROOT_CHANNELS_DIRNAME).resolve(channel).resolve(CREATOR_ROOT_VIDEOS_DIRNAME);
            await this.fileService.createFolder(videos);
            const manifestUri = root.resolve(CREATOR_ROOT_MANIFEST_RELATIVE_PATH);
            let manifest: Record<string, unknown> = { schema: CREATOR_ROOT_SCHEMA };
            try {
                const parsed: unknown = JSON.parse((await this.fileService.readFile(manifestUri)).value.toString());
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    manifest = parsed as Record<string, unknown>;
                }
            } catch {
                // 読み込めない場合はチャンネル一覧を補う。
            }
            const existing = Array.isArray(manifest.channels)
                ? manifest.channels.filter((value): value is string => typeof value === 'string' && value.length > 0)
                : this.channels;
            manifest.channels = [...new Set([...existing, channel])];
            await this.fileService.writeFile(manifestUri, BinaryBuffer.fromString(`${JSON.stringify(manifest, null, 2)}\n`));
            this.channels = await this.resolveManifestChannels(root);
            this.creatorRootProjects = await this.listCreatorRootProjects(root);
            await this.channelContext.refresh();
            this.channelContext.setViewingChannel(channel);
            this.setListChannelOverride(channel);
            this.closeHomeDialog();
            this.messages.info(`『${channel}』を作りました`);
        } catch (error) {
            this.newChannelError = error instanceof Error ? error.message : '作成に失敗しました。';
        } finally {
            this.creatingChannel = false;
            this.update();
        }
    }

    protected openChannelProject(newWindow: boolean): void {
        const row = this.buildProjectRows().find(candidate => candidate.channel === this.pendingChannel);
        const uri = this.pendingChannelProjectUri ?? row?.uri;
        this.closeHomeDialog();
        if (!uri) { this.messages.info('このチャンネルにはまだプロジェクトがありません。'); return; }
        void this.commands.executeCommand(AKARI_COMMANDS.openProject, { uri: uri.toString(), reason: newWindow ? 'new-window' : 'channel' });
    }

    protected renderHomeDialog(): React.ReactNode {
        if (this.homeDialog === 'templates') {
            return <HomeScrim kind='templates' onClose={this.closeHomeDialog}>
                <h3>テンプレを選ぶ</h3>
                <p>企画書のひな形を追加します。名前はあとから変えられます。</p>
                <div className='akari-os-template-grid'>{this.projectTemplates.map(template => <button type='button'
                    className='akari-os-template-card' key={template.id} data-akari-template={template.id}
                    disabled={this.applyingTemplate} onClick={() => void this.applyProjectTemplate(template)}>
                    <b>{template.name}</b><small>{template.description}</small>
                </button>)}</div>
            </HomeScrim>;
        }
        if (this.homeDialog === 'open' && this.chosenFolder) {
            const channel = this.currentLocation?.kind === 'inside' ? this.currentLocation.channel : this.channels[0] ?? CREATOR_ROOT_DEFAULT_CHANNEL;
            return <HomeScrim kind='open-confirm' onClose={this.closeHomeDialog}><h3>このフォルダはまだ AKARI のプロジェクトではありません</h3><p>このまま開くと、ここに単体プロジェクト（チャンネルの外）として AKARI のファイルを作ります。チャンネルのテロップのスタイルや好みの設定は効きません。</p><div className='akari-home-dialog-path'>{this.chosenFolder.path.fsPath()}</div>{(['channel', 'standalone'] as const).map(choice => <button type='button' key={choice} className='akari-home-choice' data-akari-open-choice={choice} data-selected={this.openChoice === choice} onClick={() => { this.openChoice = choice; this.update(); }}><b>{choice === 'channel' ? 'チャンネルに入れて始める' : 'この場所で単体プロジェクトとして始める'}</b><small>{choice === 'channel' ? `「${channel}」の中に新しいプロジェクトとして作る（おすすめ）` : 'あとからチャンネルに入れることもできます'}</small></button>)}<div className='akari-home-dialog-actions'><button type='button' className='theia-button secondary' onClick={() => { this.closeHomeDialog(); void this.chooseFolder(); }}>別のフォルダを選ぶ</button><button type='button' className='theia-button main' onClick={() => void this.beginChosenFolder()}>始める</button></div></HomeScrim>;
        }
        if (this.homeDialog === 'channels') {
            return <HomeScrim kind='channel-switch' onClose={this.closeHomeDialog}><h3>チャンネル</h3><div className='akari-home-channel-list'>{this.channels.map(channel => <button type='button' key={channel} className='akari-home-channel-row' data-akari-channel={channel} onClick={() => this.chooseChannel(channel)}><b>{channel}</b><small>プロジェクト {this.creatorRootProjects.filter(project => project.channel === channel).length}</small>{this.currentLocation?.kind === 'inside' && this.currentLocation.channel === channel && <span>✓</span>}</button>)}<div className='akari-home-channel-separator' /><button type='button' className='akari-home-channel-row' data-akari-create-channel='true' onClick={() => this.openNewChannelDialog()}>＋ 新しいチャンネルを作る</button></div></HomeScrim>;
        }
        if (this.homeDialog === 'channel-create') {
            return <HomeScrim kind='channel-create' onClose={this.closeHomeDialog}>
                <h3>新しいチャンネルを作る</h3>
                <p>チャンネルのフォルダ（channels/&lt;名前&gt;/）を作ります。設計・デザイン・辞書は左の『チャンネル』から</p>
                <label className='akari-home-channel-name-label'>チャンネル名
                    <input className='theia-input akari-home-channel-name' type='text' autoFocus
                        data-akari-channel-name='true' value={this.newChannelName}
                        onChange={event => { this.newChannelName = event.currentTarget.value; this.newChannelError = ''; this.update(); }} />
                </label>
                {this.newChannelError && <p className='akari-home-channel-error' role='alert' data-akari-channel-error='true'>{this.newChannelError}</p>}
                <div className='akari-home-dialog-actions'>
                    <button type='button' className='theia-button secondary' onClick={this.closeHomeDialog}>やめる</button>
                    <button type='button' className='theia-button main' disabled={this.creatingChannel}
                        data-akari-channel-create-submit='true' onClick={() => void this.createNewChannel()}>
                        {this.creatingChannel ? '作成しています…' : '作る'}
                    </button>
                </div>
            </HomeScrim>;
        }
        if (this.homeDialog === 'standalone-create' && this.standaloneDestination) {
            return <HomeScrim kind='standalone-create' onClose={this.closeHomeDialog}>
                <h3>チャンネルに入れずに作る</h3>
                <p>好きなフォルダに、単体のプロジェクトとして作ります。チャンネルの設計やスタイルは効きません。あとからチャンネルに入れられます。</p>
                <div className='akari-home-dialog-path'>{this.standaloneDestination.path.fsPath()}</div>
                <div className='akari-home-dialog-actions'>
                    <button type='button' className='theia-button secondary' onClick={this.closeHomeDialog}>やめる</button>
                    <button type='button' className='theia-button main' data-akari-standalone-create-submit='true'
                        disabled={this.startingNewProject} onClick={() => {
                            const destination = this.standaloneDestination;
                            if (!destination) { return; }
                            this.closeHomeDialog();
                            void this.startNewProjectIn(destination);
                        }}>作る</button>
                </div>
            </HomeScrim>;
        }
        if (this.homeDialog === 'channel-choice') {
            return <HomeScrim kind='channel-window-choice' onClose={this.closeHomeDialog}><h3>「{this.pendingChannel}」を開く</h3><p>開くウィンドウを選んでください。</p><div className='akari-home-dialog-actions'><button type='button' className='theia-button secondary' onClick={() => this.openChannelProject(false)}>このウィンドウで開く</button><button type='button' className='theia-button main' onClick={() => this.openChannelProject(true)}>新しいウィンドウで開く</button></div></HomeScrim>;
        }
        return undefined;
    }

    /** 旧プロジェクトのセッション情報を読む互換処理。新規作成からは呼ばない。 */
    protected async resumeStartKind(): Promise<void> {
        const kind = sessionStorage.getItem('akari.home.start-kind');
        if (!kind || !this.currentProjectUri) return;
        sessionStorage.removeItem('akari.home.start-kind');
        if (kind === 'partner') {
            await this.commands.executeCommand('akari.partner.open').catch(() => undefined);
        } else if (kind === 'import' || kind === 'transcribe') {
            await this.importForStartKind(kind);
        } else if (kind === 'generate') {
            try { await this.commands.executeCommand('akari.inspector.open', { tabId: 'generation' }); }
            catch (error) { console.warn('[akari-surfaces] could not open generation inspector:', error); }
        }
    }

    /** ホームの「素材から」で使う取り込み経路。 */
    protected async importForStartKind(kind: 'import' | 'transcribe'): Promise<void> {
        const picked = await this.fileDialogs.showOpenDialog({
            title: kind === 'transcribe' ? '文字起こしする素材を選ぶ' : '素材を入れる',
            canSelectFiles: true, canSelectFolders: false, canSelectMany: true
        });
        if (!picked) { return; }
        const root = this.currentProjectUri;
        const selected = (Array.isArray(picked) ? picked : [picked]).filter(uri => kind === 'transcribe'
            ? captionSourcePathRule(uri.path.toString(), root?.path.toString()).status === 'voice'
            : [...IMPORTABLE_EXTENSIONS, ...AUDIO_EXTENSIONS].includes(this.extensionOf(uri.path.base)));
        if (!selected.length) {
            this.messages.warn(kind === 'transcribe' ? '声の入った動画または音声を選んでください。' : '動画・写真・音声のファイルを選んでください。');
            return;
        }
        const imported = await this.importDroppedSources(selected, true);
        if (kind !== 'transcribe') { return; }
        const first = imported.find(uri => captionSourcePathRule(uri.path.toString(), root?.path.toString()).status === 'voice');
        if (!first) {
            this.messages.info('文字起こしには動画または音声が必要です。');
            return;
        }
        const relativePath = root?.relative(first)?.toString();
        if (!root || !relativePath) { return; }
        try {
            await this.commands.executeCommand('akari.transcribe.openDialog', { projectRoot: root.toString(), relativePath });
            await this.commands.executeCommand('akari.daihon.open');
        } catch (error) {
            this.messages.error(error instanceof Error ? error.message : '文字起こしを開けませんでした。');
        }
    }

    // --- ホーム v2: アクション ---
    // 接続案内カード（旧 connectPartner・BEGIN_ONBOARDING_COMMAND）は裁定 C4 により撤去済み
    // （task 2026-08-17-home-launcher-popup）。接続は右側「パートナーを追加」パネルが正。


    /**
     * 進め方フォームを dashboard 内の展開セクションとして開く（裁定 R5）。
     * 企画の「詳しく」と `AkariHomeCommandContribution`
     * （`akari.home.openIntakeForm` コマンド）から呼ばれる。
     * コマンドのため public にしてある。「進め方を決める」（absent / draft）と
     * 「進め方を見直す」（submitted）はどちらもこの 1 経路で、intake.json が
     * 読めればその内容をプリフィルする — ファイルが SSOT なので、エージェントが
     * 書いた draft もそのまま編集の出発点になる。
     *
     * submitted 済みなのに読めなかったときだけ開かずにエラーを出す
     * （空フォームからの送信で既存の内容を失わせないため）。
     */
    openIntakeForm = async (): Promise<void> => {
        const snapshot = await this.readIntake();
        if (this.intakeStatus === 'submitted' && snapshot.status !== 'submitted') {
            console.error('[akari-surfaces] failed to read submitted intake.json for review');
            this.messages.error('進め方の読み込みに失敗しました。');
            return;
        }
        this.intakeSnapshot = snapshot;
        this.intakeStatus = snapshot.status;
        if (snapshot.status !== 'absent') {
            this.intakeTasks = new Set(snapshot.tasks);
            this.intakeDuration = snapshot.duration;
            this.intakeAutonomy = snapshot.autonomy;
            this.intakeReviewTaste = snapshot.taste;
        }
        this.intakeFormOpen = true;
        this.update();
    };

    /**
     * フォームを畳む唯一の導線（「ホームに戻る」）。戻り先はホームの
     * 1 種類だけで、どこへ着地するかが状態次第で変わることはない。
     */
    protected closeIntakeForm = (): void => {
        this.intakeFormOpen = false;
        this.update();
    };

    /** target.duration_s / keep_length から選択肢を逆引きする（プリフィル用）。 */
    protected durationChoiceFromTarget(target: { duration_s?: unknown; keep_length?: unknown }): IntakeDurationChoice {
        if (target?.keep_length === true) {
            return 'keep';
        }
        const match = INTAKE_DURATION_ORDER.find(choice => choice !== 'keep' && Number(choice) === target?.duration_s);
        return match ?? INTAKE_DEFAULT_DURATION;
    }

    protected toggleIntakeTask(id: IntakeTaskId): void {
        if (this.intakeTasks.has(id)) {
            this.intakeTasks.delete(id);
        } else {
            this.intakeTasks.add(id);
        }
        this.update();
    }

    protected setIntakeDuration(choice: IntakeDurationChoice): void {
        this.intakeDuration = choice;
        this.update();
    }

    protected setIntakeAutonomy(choice: IntakeAutonomy): void {
        this.intakeAutonomy = choice;
        this.update();
    }

    /**
     * 送信 = A → B の順（契約 §4）: A) intake.json を submitted で書く
     * → B) パートナーへ要約メッセージを流す。
     */
    protected async submitIntake(): Promise<void> {
        if (this.intakeSubmitting || !this.intakeUri) {
            return;
        }
        this.intakeSubmitting = true;
        this.update();

        const tasks = INTAKE_TASK_IDS.filter(id => this.intakeTasks.has(id));
        const target = {
            ...durationChoiceToTarget(this.intakeDuration),
            taste: this.intakeReviewTaste
        };
        const body = {
            version: 1,
            tasks,
            target,
            autonomy: this.intakeAutonomy,
            status: 'submitted' as const,
            submitted_at: new Date().toISOString(),
            // フォームに title の入力欄は無い（本タスクのスコープ外）。エージェントが
            // 別経路で書いた値を送信のたびに消してしまわないよう、読み込み済みの
            // スナップショットからそのまま持ち回って書き戻す。
            title: this.intakeSnapshot?.title ?? null
        };

        try {
            try {
                await this.fileService.createFolder(this.intakeUri.parent);
            } catch {
                // 既に存在する場合はここで無視してよい。
            }
            await this.fileService.writeFile(this.intakeUri, BinaryBuffer.fromString(`${JSON.stringify(body, null, 2)}\n`));
        } catch (error) {
            console.error('[akari-surfaces] failed to write intake.json:', error);
            this.messages.error('進め方の保存に失敗しました。もう一度お試しください。');
            this.intakeSubmitting = false;
            this.update();
            return;
        }

        // A（ファイル書き込み）の後に B（パートナーへの要約送信）。
        void this.commands.executeCommand(SEND_TO_PARTNER_COMMAND, this.buildIntakeSummaryText(tasks, target));

        this.intakeSubmitting = false;
        // 送信が終わればフォームを畳んで dashboard に戻る（初回送信でも見直しの
        // 再送信でも同じ挙動 — 戻り先は常に dashboard の 1 種類）。
        this.intakeFormOpen = false;
        await this.refreshHomeFlow();
        this.messages.info('進め方をパートナーに送りました');
    }

    protected buildIntakeSummaryText(tasks: IntakeTaskId[], target: { duration_s: number | null; keep_length: boolean; taste: string | null }): string {
        const taskLabels = tasks.length ? tasks.map(id => INTAKE_TASK_LABELS[id]).join('、') : '（未選択）';
        const durationLabel = INTAKE_DURATION_LABELS[this.intakeDuration];
        const autonomyLabel = INTAKE_AUTONOMY_LABELS[this.intakeAutonomy];
        const lines = [
            'この内容でパートナーに依頼します。',
            `やること: ${taskLabels}`,
            `仕上がりの尺: ${durationLabel}`,
            `おまかせの度合い: ${autonomyLabel}`
        ];
        if (target.taste) {
            lines.push(target.taste);
        }
        return lines.join('\n');
    }

    // --- D&D 復活: 素材の取り込み（v3 home dropzone [bacd7f5] からの再利用。
    // 挙動は変えていない — 差分は「専用カード」ではなく「面全体」が対象になった点のみ） ---

    /**
     * 取り込み先ディレクトリ（assets ロール）の相対パスを workflow.json から解決する。
     * v3 の `normalizeRoles` + `roleForKind('assets')` と同じアルゴリズム・同じ既定値
     * （`DEFAULT_ASSETS_ROLE_PATH = 'assets'`）。v3 は起動時に読んで stages 表示等と
     * 一緒にフィールドへキャッシュしていたが、v4 はホーム俯瞰カード自体が無いため、
     * ドロップの都度フレッシュに読み直す（常に最新の workflow.json を見る・
     * 新しい watch ライフサイクルを増やさない）。読めない/未設定なら既定値。
     */
    protected async resolveAssetsRolePath(root: URI): Promise<string> {
        try {
            const content = await this.fileService.readFile(root.resolve('.akari/workflow.json'));
            const parsed = JSON.parse(content.value.toString());
            const roles = this.normalizeRoles(parsed);
            return this.roleForKind(roles, 'assets') ?? DEFAULT_ASSETS_ROLE_PATH;
        } catch {
            return DEFAULT_ASSETS_ROLE_PATH;
        }
    }

    protected normalizeRoles(workflow: any): WorkflowRole[] {
        const source = Array.isArray(workflow?.roles) ? workflow.roles : [];
        return source
            .filter((entry: any) => entry && typeof entry.path === 'string')
            .map((entry: any) => ({
                path: entry.path,
                label: String(entry.label ?? entry.path),
                kind: String(entry.kind ?? '')
            }));
    }

    protected roleForKind(roles: WorkflowRole[], kind: string): string | undefined {
        return roles.find(role => role.kind === kind)?.path;
    }

    protected handleDragOver = (event: React.DragEvent): void => {
        if (!this.hasImportableDrag(event.dataTransfer)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
        if (!this.dragActive) {
            this.dragActive = true;
            this.update();
        }
    };

    protected handleDragLeave = (event: React.DragEvent): void => {
        const next = event.relatedTarget as Node | null;
        if (next && event.currentTarget.contains(next)) {
            return;
        }
        if (this.dragActive) {
            this.dragActive = false;
            this.update();
        }
    };

    /**
     * v3 は `data-akari-dropzone` を持つ専用の小さな div にだけ付けていたハンドラを、
     * v4 ではホーム面全体（`.akari-home-surface`）に付ける。子要素（カード・ボタン等）を
     * 跨ぐ dragenter/dragleave は `handleDragLeave` の `relatedTarget` ガードで吸収される
     * （v3 から無変更）。
     */
    protected handleDrop = (event: React.DragEvent): void => {
        if (!this.hasImportableDrag(event.dataTransfer)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.dragActive = false;
        const sources = this.resolveDroppedSources(event.dataTransfer);
        if (!sources.length) {
            this.messages.warn('動画または写真のファイルをドロップしてください。');
            this.update();
            return;
        }
        this.update();
        void this.importDroppedSources(sources);
    };

    /**
     * v3 は `this.projectRoot`（起動時にキャッシュ済み）を直接参照していたが、v4 は
     * その俯瞰用フィールドを持たないため、ドロップの都度 `workspaceService.roots` から
     * 解決する。未接続時と同じく「先にプロジェクトを開いてください」の警告文言は
     * v3 のまま維持。
     */
    protected async importDroppedSources(sources: URI[], includeAudio = false): Promise<URI[]> {
        const roots = await this.workspaceService.roots;
        const root = roots[0]?.resource;
        if (!root) {
            this.messages.warn('先にプロジェクトを開いてください。');
            return [];
        }
        return this.importSources(sources, root, includeAudio);
    }

    protected hasImportableDrag(transfer: DataTransfer | null): boolean {
        return !!transfer && (transfer.types.includes('Files') || transfer.types.includes('text/uri-list'));
    }

    /**
     * ドロップされた実ファイルの絶対パスを解決する。Electron の preload ブリッジ
     * （`electronTheiaCore.getPathForFile`）を優先し、無い環境では `File#path` に
     * フォールバックする（akari-project の動画ドロップ実装と同じ経路。v3 から無変更）。
     */
    protected resolveDroppedSources(transfer: DataTransfer | null): URI[] {
        if (!transfer) {
            return [];
        }
        const fromFiles = Array.from(transfer.files)
            .filter(file => IMPORTABLE_EXTENSIONS.includes(this.extensionOf(file.name)))
            .map(file => {
                const theiaCore = (window as Window & {
                    electronTheiaCore?: { getPathForFile?: (candidate: File) => string };
                }).electronTheiaCore;
                let sourcePath: string | undefined;
                if (typeof theiaCore?.getPathForFile === 'function') {
                    try {
                        sourcePath = theiaCore.getPathForFile(file) || undefined;
                    } catch {
                        // Fall back for environments without the Electron preload bridge.
                    }
                }
                sourcePath ||= (file as File & { path?: string }).path;
                return sourcePath ? URI.fromFilePath(sourcePath) : undefined;
            })
            .filter((uri): uri is URI => !!uri);
        if (fromFiles.length) {
            return fromFiles;
        }
        const uriList = transfer.getData('text/uri-list');
        return uriList.split(/\r?\n/)
            .filter(line => line.startsWith('file:') && IMPORTABLE_EXTENSIONS.includes(this.extensionOf(line)))
            .map(line => new URI(line));
    }

    protected async importSources(sources: URI[], root: URI, includeAudio = false): Promise<URI[]> {
        const extensions = includeAudio ? [...IMPORTABLE_EXTENSIONS, ...AUDIO_EXTENSIONS] : IMPORTABLE_EXTENSIONS;
        const supported = sources.filter(uri => extensions.includes(this.extensionOf(uri.path.base)));
        if (!supported.length) {
            this.messages.warn('動画または写真のファイルを選んでください。');
            return [];
        }
        this.importing = true;
        this.update();
        const assetsRolePath = await this.resolveAssetsRolePath(root);
        const assetsUri = root.resolve(assetsRolePath);
        let imported = 0;
        let failed = 0;
        const importedUris: URI[] = [];
        for (const source of supported) {
            try {
                // FileService.copy は同名ファイルがあると例外になる（自動リネームはしない）。
                // 同じ素材の再ドロップを失敗にしないため、空いている名前を探してからコピーする。
                const target = await this.availableTarget(assetsUri, this.safeFileName(source.path.base));
                await this.fileService.copy(source, target, { fromUserGesture: true });
                imported++;
                importedUris.push(target);
            } catch (error) {
                failed++;
                console.error('[akari-surfaces] failed to import asset', error);
            }
        }
        this.importing = false;
        if (imported) {
            this.importedNotice = failed
                ? `${imported} 件を取り込みました（${failed} 件は失敗）。分析やプラン作成に進めます。`
                : '素材を取り込みました。分析やプラン作成に進めます。';
            this.messages.info(this.importedNotice);
            await this.refreshExplorer();
        } else {
            this.messages.error('取り込めませんでした。Finder からもう一度お試しください。');
        }
        this.update();
        return importedUris;
    }

    protected async refreshExplorer(): Promise<void> {
        try {
            const navigator = await this.widgets.getOrCreateWidget('files') as any;
            await navigator.model?.refresh?.();
        } catch {
            // Explorer がまだ無い場合はワークスペースの監視側で追従する。
        }
    }

    protected safeFileName(name: string): string {
        return name.replace(/[\\/]/g, '_').replace(/[^\p{L}\p{N}._ -]/gu, '_');
    }

    /** 同名ファイルが既にあるときは `name-2.ext` 形式で空きを探す（上書きしない）。 */
    protected async availableTarget(directory: URI, name: string): Promise<URI> {
        const extension = this.extensionOf(name);
        const stem = extension ? name.slice(0, -extension.length) : name;
        let candidate = directory.resolve(name);
        for (let index = 2; await this.fileService.exists(candidate); index++) {
            candidate = directory.resolve(`${stem}-${index}${extension}`);
        }
        return candidate;
    }

    protected extensionOf(name: string): string {
        const match = name.match(/\.[^./\\]+$/);
        return match ? match[0].toLowerCase() : '';
    }

    // --- レンダリング ---

    /**
     * ホーム v4: 分岐なしで常に dashboard 1 枚を描く。上から
     * (a) 説明ブロック（2 動作） (b) 過去プロジェクト一覧（あれば列挙・無ければ
     * 案内 1 行） (c) 接続案内カード（未接続時のみ） (d) 進め方フォーム
     * （コマンドから開いたときだけ展開）。それ以外の静的な制御 UI は持たない
     * （裁定 R1・R4）。`data-akari-home-stage` は v3 からの既存 evidence /
     * 検証スクリプトの掴みどころとして値 `"dashboard"` のまま残す。
     *
     * D&D 復活（task 2026-08-02-home-dnd-restore）: 面全体（このルート div）が
     * ドロップターゲット。専用カードは足さず、dragover 中だけ
     * {@link renderDropOverlay} を重ねて可視化する。`data-akari-dropzone='true'`
     * は evidence 互換のためこの要素に復活させた。
     *
     * F11（task 2026-08-05-welcome-screen）: `welcomeMode` の間は dashboard を
     * 一切描かず {@link renderWelcomeSurface} だけを返す — 通常ホームの要素
     * （状態バッジ・説明・接続カード等）を混在させない（task.md §2 指定）。
     */
    protected override render(): React.ReactNode {
        if (!this.scope) {
            if (this.welcomeMode) return this.renderWelcomeSurface();
            return <div className='akari-home-surface' data-akari-home-stage='dashboard'
                data-akari-home-ready={this.homeReady ? 'true' : 'false'}>
                <style>{homePanelCss}</style>{this.renderHomeTopBar()}{this.renderDashboardHeader()}
                {this.renderProjectList()}{this.renderHomeDialog()}
            </div>;
        }
        const channelMode = this.welcomeMode || this.scope.scope === 'channel';
        return (
            <div
                className='akari-home-surface'
                data-akari-home-stage={channelMode ? 'project-list' : 'dashboard'}
                data-akari-home-ready={this.homeReady ? 'true' : 'false'}
                data-akari-dropzone='true'
                onDragOver={this.handleDragOver}
                onDragLeave={this.handleDragLeave}
                onDrop={this.handleDrop}
                onScroll={this.handleHomeScroll}
                style={{ height: '100%', overflow: 'auto', padding: '18px 22px', boxSizing: 'border-box', position: 'relative', containerType: 'inline-size' }}
            >
                <style>{homePanelCss + projectListCss + projectHomeCss}</style>
                {this.renderHomeTopBar()}
                {channelMode ? this.renderProjectListForTab() : this.renderProjectHome()}
                {this.importedNotice && this.renderImportedNotice()}
                {this.renderHomeDialog()}
                {this.renderOpenClosePrompts()}
                {/* 2026-09-26 オーナー指摘（ホームの認知負荷を下げる）: AKARI Store の
                    接続状態は面の右上（{@link renderHomeTopBar}）へ移し、拡張キットの
                    棚卸しはホームから外した。{@link renderKitCard} は描画から外れただけで、
                    戻す判断が出たときのために実装は残してある（kitCard の算出も同様）。 */}
                {this.intakeFormOpen && this.renderIntakeForm()}
                {this.dragActive && this.renderDropOverlay()}
            </div>
        );
    }

    protected renderOpenClosePrompts(): React.ReactNode {
        const prompt = this.openPrompt;
        const current = this.buildProjectRows().find(row => row.current)?.name ?? this.currentProjectUri?.path.base;
        return <>
            {prompt && <HomeScrim kind='open-project' onClose={() => { this.openPrompt = undefined; this.update(); }}>
                <h3>「{prompt.name}」を開きますか？</h3>
                <p>{current ? `いま開いている「${current}」は保存されています。`
                    : `${prompt.badge} · 最後に触ったのは ${prompt.updatedAt ? new Date(prompt.updatedAt).toLocaleString('ja-JP') : '不明'}`}</p>
                {prompt.busy && <div className='akari-os-warn'>右のパートナーが作業中です。この画面で開くと、この作業は止まります。</div>}
                {openChoices(prompt.busy).map(choice => <button key={choice} type='button' className='akari-os-choice' data-akari-open-choice={choice}
                    onClick={() => void this.chooseOpen(choice)}><b>{choice === 'after-work' ? '作業が終わってから開く'
                        : choice === 'here' ? prompt.busy ? '作業を止めて、この画面で開く' : 'この画面で開く'
                            : '新しいウィンドウで開く'}</b><small>{choice === 'after-work' ? `終わったら「${prompt.name}」がこの画面で開きます`
                                : choice === 'here' ? current ? `「${current}」から切り替えます` : 'この画面がプロジェクトの中になります'
                                    : current ? `「${current}」はこのまま残ります` : 'この一覧はこのまま残ります'}</small></button>)}
                {!prompt.busy && <label><input type='checkbox' checked={this.noAskChecked}
                    onChange={event => { this.noAskChecked = event.currentTarget.checked; this.update(); }} /> 次から聞かずに、この画面で開く</label>}
                <div className='akari-home-dialog-actions'><button type='button' className='theia-button secondary'
                    onClick={() => { this.openPrompt = undefined; this.update(); }}>やめる</button></div>
            </HomeScrim>}
            {this.closePrompt && <HomeScrim kind='close-project' onClose={() => { this.closePrompt = false; this.update(); }}>
                <h3>「{current}」を閉じますか？</h3><p>保存されています。プロジェクト一覧の画面に戻ります。</p>
                {this.isPartnerBusy() && <div className='akari-os-warn'>右のパートナーが作業中です。閉じると、この作業は止まります。</div>}
                <div className='akari-home-dialog-actions'><button type='button' className='theia-button secondary'
                    onClick={() => { this.closePrompt = false; this.update(); }}>やめる</button>
                    <button type='button' className='theia-button main' onClick={() => void this.confirmCloseProject()}>
                        {this.isPartnerBusy() ? '止めて閉じる' : 'このプロジェクトを閉じる'}</button></div>
            </HomeScrim>}
        </>;
    }

    /** プロジェクト未選択時の既存ウェルカム面。更新のお知らせは右下の通知で扱う。 */
    protected renderWelcomeSurface(): React.ReactNode {
        return (
            <div
                className='akari-home-surface akari-home-welcome'
                data-akari-home-stage='welcome'
                data-akari-home-ready={this.homeReady ? 'true' : 'false'}
                style={homeFlowStyles.welcomeSurface}
            >
                <style>{homePanelCss}</style>
                <div style={homeFlowStyles.welcomeTopBar}>{this.renderHomeTopBar()}</div>
                <div style={homeFlowStyles.welcomeStack}>
                    {this.renderWelcomeCard()}
                </div>
            </div>
        );
    }

    /**
     * ウェルカムカード本体（モックの `.w-card`）。新規ボタンは常時表示
     * （F9 ensureCreatorRoot 連結込みの {@link startNewProject} を流用）。一覧は
     * 既存の {@link buildProjectRows}（U3）をそのまま流用する — ウェルカム中は
     * `currentProjectUri`/`currentLocation` がどちらも undefined のため「開いて
     * います」判定は自然に出ない（現在開いているプロジェクトという概念自体が
     * 無い）。作業場もプロジェクト履歴も無い完全初回（rows が空）は見出しごと
     * 出さない。フォルダ選択とセットアップ再表示は、主操作を邪魔しない末尾の
     * 副次導線として常に残す。
     */
    protected renderWelcomeCard(): React.ReactNode {
        const rows = this.buildProjectRows();
        return (
            <div data-akari-welcome-card='true' style={homeFlowStyles.welcomeCard}>
                <div style={homeFlowStyles.welcomeLogo}>🏮 AKARI Video</div>
                <div style={homeFlowStyles.welcomeSub}>プロジェクトを開いてはじめましょう</div>
                <button
                    type='button'
                    className='theia-button main'
                    style={homeFlowStyles.welcomeNewButton}
                    disabled={this.startingNewProject}
                    data-akari-welcome-new-project='true'
                    onClick={event => { this.newProjectOriginRect = event.currentTarget.getBoundingClientRect(); void this.startNewProject(); }}
                >
                    {this.startingNewProject ? '作成しています…' : '＋ 新しい動画を始める'}
                </button>
                {rows.length > 0 && <>
                    <p style={homeFlowStyles.welcomeListHeading}>最近のプロジェクト</p>
                    {this.renderProjectBrowser(rows)}
                </>}
                <button
                    type='button'
                    className='theia-button quiet'
                    style={homeFlowStyles.welcomeOpenFolder}
                    data-akari-welcome-open-folder='true'
                    onClick={this.openFolderAdvanced}
                >
                    フォルダを開く…（上級者向け）
                </button>
                <button
                    type='button'
                    className='theia-button secondary'
                    style={homeFlowStyles.welcomeSetupButton}
                    data-akari-open-project-launcher='true'
                    onClick={() => void this.openProjectLauncher()}
                >
                    <span className='codicon codicon-layout' aria-hidden='true' />
                    プロジェクト・ランチャーを開く
                </button>
                <button
                    type='button'
                    className='theia-button secondary'
                    style={homeFlowStyles.welcomeSetupButton}
                    data-akari-open-edit-data='true'
                    onClick={() => void this.openEditData()}
                >
                    <span className='codicon codicon-edit' aria-hidden='true' />
                    編集データを開く
                </button>
            </div>
        );
    }

    /**
     * 「フォルダを開く…（上級者向け）」= 既存の Open Folder コマンド呼び出し
     * （task.md §1 指定・新規実装はしない）。Electron 版 Theia 標準の
     * `workspace:openFolder`（`WorkspaceCommands.OPEN_FOLDER`）をそのまま叩く。
     */
    protected openFolderAdvanced = (): void => {
        void this.commands.executeCommand(WorkspaceCommands.OPEN_FOLDER.id);
    };

    /**
     * ドロップ受け付けの可視化（dragover 中のみ）。静的レイアウトには何も足さず、
     * このオーバーレイだけが一時的に重なる。`pointerEvents: 'none'` により
     * オーバーレイ自身が `dragenter`/`dragleave` の relatedTarget にならないようにする
     * （面全体が対象になったことで子要素間の drag イベントが増えるため重要）。
     */
    protected renderDropOverlay(): React.ReactNode {
        return (
            <div role='status' aria-live='polite' style={homeFlowStyles.dropOverlay}>
                <span className='codicon codicon-cloud-upload' aria-hidden='true' style={{ fontSize: 26 }} />
                <strong style={{ fontSize: 14.5 }}>ここに落とすと素材に取り込みます</strong>
            </div>
        );
    }

    /** 取り込み完了後の一時的なステータス表示（v3 renderProjectOverview から再利用）。 */
    protected renderImportedNotice(): React.ReactNode {
        return (
            <div role='status' style={homeFlowStyles.importedNotice}>
                {this.importedNotice}
            </div>
        );
    }

    protected renderDashboardHeader(): React.ReactNode {
        if (this.currentProjectUri) { return this.renderCurrentBand(); }
        return <header style={homeFlowStyles.dashboardHeader}><h1 style={homeFlowStyles.dashboardTitle}>ホーム</h1></header>;
    }

    /**
     * U3「プロジェクト一覧 = 唯一のスイッチャー」（task 2026-08-03-home-v5-terms・
     * 旧・過去プロジェクト一覧 裁定 R3 を改称・拡張）。creatorRootProjects（過去+
     * 現在）と standaloneProjects（単体・履歴由来）を 1 本の行配列に統合する。
     * 現在開いているプロジェクトは ▶ +「開いています」を付け、クリックを無効化する
     * （task.md 指定）。作業場が解決できないときは、現在のプロジェクトの帯（単体なら「チャンネルに入れる」がそこに出る）と
     * 案内が二重にならないよう、ここは
     * 見出し下の薄い 1 行だけに留める（task 2026-08-04-home-no-root-flow）。
     */
    protected async refreshProjectBrowser(): Promise<void> {
        if (this.projectRefreshing) { return; }
        this.projectRefreshing = true;
        this.update();
        try { await this.loadCreatorRootProjects(); await this.loadStandaloneProjects(); }
        finally { this.projectRefreshing = false; this.update(); }
    }

    protected renderProjectBrowser(allRows: ProjectListRow[]): React.ReactNode {
        const rows = sortProjects(filterProjects(allRows, this.projectQuery), this.projectSort);
        const list = this.projectView === 'list';
        const iconStyle: React.CSSProperties = { minWidth: 32, width: 32, height: 32, margin: 0, padding: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
        this.projectRowsTotal = rows.length;
        return <div data-akari-project-browser={this.projectView}>
            {/* 1 段目 = 見出しと「作る / 開く」。2 段目 = 絞り込みと表示の操作
                （2026-09-26 オーナー指摘「検索から右は 1 行下の段へ」）。 */}
            {!this.welcomeMode && <div className='akari-home-project-toolbar' data-akari-project-toolbar='true'>
                {/* 一覧はもともとチャンネル横断（listCreatorRootProjects が全チャンネルを歩く）。
                    見出しが「このチャンネルの」だったのは実態と合っていなかったうえ、
                    幅が狭いと真っ先に "…" で潰れる長さだった。 */}
                <h3>最近のプロジェクト</h3>
                <button type='button' className='theia-button main akari-home-toolbar-button'
                    disabled={this.startingNewProject} data-akari-new-project='true'
                    onClick={event => { this.newProjectOriginRect = event.currentTarget.getBoundingClientRect(); void this.startNewProject(); }}>
                    <span className={`codicon ${this.startingNewProject ? 'codicon-loading codicon-modifier-spin' : 'codicon-add'}`} aria-hidden='true' />
                    <span>{this.startingNewProject ? '作成しています…' : '新しい動画'}</span>
                </button>
                <button type='button' className='theia-button secondary' style={iconStyle}
                    title='プロジェクトを開く…' aria-label='プロジェクトを開く…'
                    data-akari-open-folder='true' onClick={() => void this.chooseFolder()}>
                    <span className='codicon codicon-folder-opened' aria-hidden='true' />
                </button>
            </div>}
            <div className='akari-home-project-filters' data-akari-project-filters='true'>
                <input type='search' className='theia-input' aria-label='プロジェクトを検索'
                    placeholder='名前・チャンネルで検索' value={this.projectQuery}
                    style={{ flex: '1 1 160px', minWidth: 120, maxWidth: 260 }}
                    onChange={event => { this.projectQuery = event.currentTarget.value; this.projectVisibleCount = HOME_PROJECT_PAGE_SIZE; this.update(); }} />
                <button type='button' className='theia-button secondary' style={iconStyle}
                    data-akari-project-sort={this.projectSort}
                    title={`並べ替え: ${PROJECT_SORT_LABELS[this.projectSort]}`}
                    aria-label={`並べ替え: ${PROJECT_SORT_LABELS[this.projectSort]}`}
                    onClick={() => void this.pickProjectSort()}>
                    <span className={`codicon ${PROJECT_SORT_ICON}`} aria-hidden='true' />
                </button>
                {(['cards', 'list'] as const).map(mode => <button key={mode} type='button' className='theia-button secondary'
                    style={{ ...iconStyle, ...(this.projectView === mode ? { boxShadow: 'inset 0 0 0 1px var(--theia-focusBorder)' } : {}) }}
                    title={mode === 'cards' ? 'カード表示' : 'リスト表示'} aria-label={mode === 'cards' ? 'カード表示' : 'リスト表示'}
                    aria-pressed={this.projectView === mode} onClick={() => { this.projectView = mode; saveProjectView(mode, 'home'); this.update(); }}>
                    <span className={`codicon ${PROJECT_VIEW_ICONS[mode]}`} aria-hidden='true' />
                </button>)}
                <button type='button' className='theia-button secondary' title='更新' aria-label='更新' style={iconStyle}
                    disabled={this.projectRefreshing} onClick={() => void this.refreshProjectBrowser()}>
                    <span className={`codicon codicon-refresh${this.projectRefreshing ? ' codicon-modifier-spin' : ''}`} aria-hidden='true' />
                </button>
                <small role='status' style={{ marginLeft: 'auto', color: 'var(--theia-descriptionForeground)' }}>{rows.length} 件</small>
            </div>
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
                {list && <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) 100px 150px 110px 40px', gap: 12, minWidth: 680, padding: '8px 12px', boxSizing: 'border-box', color: 'var(--theia-descriptionForeground)' }}>
                    <span>プロジェクト / 保存場所</span><span>チャンネル</span><span>最終更新</span><span>編集データ</span><span />
                </div>}
                <div style={{ ...(this.welcomeMode ? homeFlowStyles.welcomeList : homeFlowStyles.projectList), ...(list ? { gridTemplateColumns: '1fr', minWidth: 680, gap: 6 } : {}) }}>
                    {rows.slice(0, this.projectVisibleCount).map(row => list ? <div key={row.key} data-akari-project-card='true' style={{ display: 'flex', gap: 8 }}>
                        <button type='button' className='theia-button secondary' disabled={row.current}
                            style={{ flex: 1, minWidth: 0, margin: 0, height: 'auto', padding: '10px 12px', display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) 100px 150px 110px', alignItems: 'center', gap: 12, textAlign: 'left', ...(row.current ? PROJECT_CURRENT_STYLE : {}) }}
                            data-akari-project-current={row.current ? 'true' : undefined} aria-current={row.current ? 'true' : undefined}
                            data-akari-project-row='true' onClick={() => this.openCreatorRootProject(row.uri)}>
                            <span style={{ display: 'flex', alignItems: 'center', minWidth: 0, gap: 12 }}>
                                <span data-akari-list-thumbnail='true' style={{ ...homeFlowStyles.projectCardThumb, width: 64, height: 36, flex: '0 0 64px', borderRadius: AKARI_RADIUS.chip }}>
                                    <span className='codicon codicon-device-camera-video' aria-hidden='true' style={{ ...homeFlowStyles.projectCardPlaceholder, fontSize: 18 }} />
                                    <span ref={this.projectCardPreviewRef(row)} style={homeFlowStyles.projectCardFrames} />
                                </span>
                                <span style={{ display: 'grid', minWidth: 0, gap: 4 }}>
                                <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}{row.current ? ' · 開いています' : ''}</strong>
                                <small title={row.uri.path.fsPath()} style={{ color: 'var(--theia-descriptionForeground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.uri.path.fsPath()}</small>
                                </span>
                            </span>
                            <small style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.channel ?? '単体'}</small>
                            <time style={{ whiteSpace: 'nowrap' }} dateTime={row.updatedAt ? new Date(row.updatedAt).toISOString() : undefined}>{formatProjectUpdatedAt(row.updatedAt)}</time>
                            <small>{projectEditStatus(row)}</small>
                        </button>
                        <button type='button' className='theia-button secondary' style={{ ...iconStyle, alignSelf: 'center' }} title={revealInFileManagerActionLabel(row.name)}
                            aria-label={revealInFileManagerActionLabel(row.name)} onClick={() => void this.revealProjectInFileManager(row)}>
                            <span className='codicon codicon-folder-opened' aria-hidden='true' />
                        </button>
                    </div> : this.renderProjectCard(row, { reveal: !this.welcomeMode }))}
                </div>
                {rows.length === 0 && <p>{this.projectQuery ? '一致するプロジェクトがありません。' : 'まだプロジェクトがありません。'}</p>}
            </div>
            {/* 通常はスクロールで自動的に足りる（{@link handleHomeScroll}）。この控えは
                「12 件が画面に収まってスクロールが生まれない」大きな窓のための最後の 1 手。 */}
            {rows.length > this.projectVisibleCount && <button type='button' className='theia-button secondary' style={{ marginTop: 12 }}
                data-akari-project-load-more='true'
                onClick={() => { this.projectVisibleCount += HOME_PROJECT_PAGE_SIZE; this.update(); }}>
                もっと見る（残り {rows.length - this.projectVisibleCount} 件）
            </button>}
        </div>;
    }

    protected renderProjectList(): React.ReactNode {
        const rows = this.buildProjectRows();
        return (
            <section style={{ marginBottom: 16 }}>{this.renderProjectBrowser(rows)}</section>
        );
    }

    /**
     * U3 の行配列を組み立てる（純粋・副作用なし）。creatorRootProjects の中に
     * 現在開いているものがあればそこへ current フラグを立てる。それが無く
     * `currentLocation.kind === 'outside'` なら standaloneProjects の中の同一
     * エントリへ current を立てる（履歴で拾えていれば自然な位置のまま）。
     * どちらにも見つからなければ（例: 履歴 API が読めなかった縮退時）末尾へ
     * 1 行だけ追加する — 「実装困難なら現在開いている単体のみ表示」の最終防波堤。
     */
    protected buildProjectRows(): ProjectListRow[] {
        const currentFsPath = this.currentProjectUri?.path.fsPath();
        const rows: ProjectListRow[] = this.creatorRootProjects.map(project => ({
            key: project.uri.toString(),
            name: resolveProjectDisplayName(project.title, project.name),
            uri: project.uri,
            channel: project.channel,
            current: currentFsPath !== undefined && project.uri.path.fsPath() === currentFsPath,
            standalone: false, updatedAt: project.updatedAt, hasEditData: project.hasEditData
        }));

        let matchedCurrent = rows.some(row => row.current);
        for (const project of this.standaloneProjects) {
            const isCurrent = !matchedCurrent && currentFsPath !== undefined && project.uri.path.fsPath() === currentFsPath;
            if (isCurrent) {
                matchedCurrent = true;
            }
            rows.push({
                key: project.uri.toString(),
                name: resolveProjectDisplayName(project.title, project.name),
                uri: project.uri,
                current: isCurrent,
                standalone: true, updatedAt: project.updatedAt, hasEditData: project.hasEditData
            });
        }

        if (!matchedCurrent && this.currentLocation?.kind === 'outside') {
            const uri = this.currentLocation.projectUri;
            const folderName = uri.path.base || uri.path.fsPath();
            rows.push({
                key: uri.toString(),
                // このフォールバック行は「現在開いているプロジェクト」だけが通る経路 —
                // すでに読み込み済みの intakeSnapshot（現在のワークスペース root の
                // intake.json）をそのまま使えば、ここだけ別に intake.json を読み直さずに済む。
                name: resolveProjectDisplayName(this.intakeSnapshot?.title, folderName),
                uri,
                current: true,
                standalone: true
            });
        }

        return rows;
    }

    /**
     * 一覧の下端に近づいたら次のページを足す（2026-09-26 オーナー指摘
     * 「もっと読み込むを押さなくても読めないか」）。
     *
     * 追加コストはサムネ生成だけで、それは 2 レーンの直列キュー
     * （{@link enqueueProjectCardWork}）に並び、生成済みはディスクキャッシュから即返る。
     * 判定は純関数 {@link shouldLoadMoreProjects} に置き、ここは実測値を渡すだけ。
     */
    protected handleHomeScroll = (event: React.UIEvent<HTMLDivElement>): void => {
        const node = event.currentTarget;
        if (!shouldLoadMoreProjects(node.scrollTop, node.clientHeight, node.scrollHeight,
            this.projectVisibleCount, this.projectRowsTotal)) {
            return;
        }
        this.projectVisibleCount = Math.min(this.projectRowsTotal, this.projectVisibleCount + HOME_PROJECT_PAGE_SIZE);
        this.update();
    };

    /**
     * 並べ替えの選択（2026-09-26 オーナー指摘「select ではなくアイコンに」）。
     * ツールバーに幅を食う `<select>` を置く代わりに、アイコン 1 個 + シェル標準の
     * QuickPick で選ばせる（{@link pickChannel} と同じ流儀）。
     */
    protected async pickProjectSort(): Promise<void> {
        const picked = await this.quickInputService.showQuickPick(
            Object.entries(PROJECT_SORT_LABELS).map(([value, label]) => ({
                label, value, description: value === this.projectSort ? '現在の並び' : undefined
            })),
            { placeholder: 'プロジェクトの並べ替え' }
        );
        if (!picked) { return; }
        this.projectSort = picked.value as ProjectSortOrder;
        saveProjectSort(this.projectSort, 'home');
        this.projectVisibleCount = HOME_PROJECT_PAGE_SIZE;
        this.update();
    }

    /**
     * ホーム面の右上に常設する AKARI Store の在席表示
     * （2026-09-26 オーナー指摘: 「パネルの右上ではなくホームの中へ。製品名ではなく
     * 今の状態 = メールアドレスを出す」）。旧 `renderStoreCard`（帯の下の
     * 「AKARI Store · 接続中」ボタン）の置き換え。
     *
     * 押すと設定面の AKARI アカウント節を開く。
     * `data-akari-store-connection` は旧カードと同じ語彙のまま残してあるので、
     * 既存の L1 / evidence の掴みどころは変わらない。
     */
    protected renderHomeTopBar(): React.ReactNode {
        const badge = resolveStorePlanBadge({
            email: this.storeEmail,
            entitlementsStatus: this.storeEntitlementsStatus,
            entitledProducts: this.storeEntitledProducts
        });
        return <div className='akari-home-topbar'>
            <button type='button' className='akari-store-badge'
                data-akari-store-connection={badge.state}
                data-akari-plan-tone={badge.tone}
                data-akari-plan-lifetime={badge.lifetime ? 'true' : undefined}
                title={badge.tooltip} aria-label={badge.tooltip}
                onClick={() => void this.openStoreSettings()}>
                <span className={`codicon ${badge.icon}`} aria-hidden='true' />
                {badge.plan && <span className='plan'>{badge.plan}</span>}
                <span className='who'>{badge.label}</span>
            </button>
        </div>;
    }

    protected renderKitCard(): React.ReactNode {
        if (this.kitCard.kind === 'hidden') { return false; }
        const card = this.kitCard;
        return (
            <section data-akari-kit-card={card.kind} style={homeFlowStyles.kitCard}>
                <strong style={homeFlowStyles.cardTitle}>拡張キット</strong>
                {card.kind === 'installed' && (
                    <>
                        <div style={homeFlowStyles.kitList}>
                            {card.kits.map(kit => (
                                <div key={kit.id} style={homeFlowStyles.kitItem}>
                                    <strong>{kit.id}</strong>
                                    <span>version: {kit.version ?? '不明'}</span>
                                    <span>スキル: {kit.skills.length > 0 ? kit.skills.join(', ') : 'なし'}</span>
                                    <span>素材数: {kit.assetCount}</span>
                                </div>
                            ))}
                        </div>
                        {card.showEnableHint && (
                            <div style={homeFlowStyles.kitAction}>
                                <span>Claude Code で有効化</span>
                                <button type='button' className='theia-button secondary'
                                    onClick={() => void this.copyKitCommand(card.enableCommand, '有効化コマンド')}>
                                    有効化コマンドをコピー
                                </button>
                            </div>
                        )}
                    </>
                )}
                {card.kind === 'purchased' && (
                    <div style={homeFlowStyles.kitAction}>
                        <span><code style={{ whiteSpace: 'pre-line' }}>{card.installCommand}</code> で導入</span>
                        <button type='button' className='theia-button secondary'
                            onClick={() => void this.copyKitCommand(card.installCommand, '導入コマンド')}>
                            導入コマンドをコピー
                        </button>
                    </div>
                )}
                {card.kind === 'unpurchased' && (
                    <div style={homeFlowStyles.kitAction}>
                        <span>AKARI Video Lab で入手できます（Lifetime パス対象）</span>
                        <button type='button' className='theia-button secondary'
                            onClick={() => this.windowService.openNewWindow(KIT_LAB_URL, { external: true })}>
                            Lab で見る
                        </button>
                    </div>
                )}
            </section>
        );
    }

    protected async copyKitCommand(command: string, label: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(command);
            this.messages.info(`${label}をコピーしました。`);
        } catch {
            this.messages.error(`${label}をコピーできませんでした。`);
        }
    }

    /** 企画の「詳しく」とコマンドから開く進め方フォーム。 */
    protected renderIntakeForm(): React.ReactNode {
        return (
            <HomeScrim kind='intake' onClose={this.closeIntakeForm}>
                {this.intakeStatus === 'submitted' && (
                    <p style={homeFlowStyles.reviewNotice}>
                        以前送信した内容を表示しています。内容を直して送信すると上書きされます。
                    </p>
                )}
                <h2 style={homeFlowStyles.h2}>今回の進め方</h2>
                <p style={homeFlowStyles.sub}>チェックした内容がそのままパートナーへの指示になります。あとから変更も OK。</p>
                <div style={homeFlowStyles.formWrap}>
                    <div>
                        <p style={homeFlowStyles.glabel}>やること — この製品ができること一覧でもある</p>
                        <div style={homeFlowStyles.checks}>
                            {INTAKE_TASK_IDS.map(id => (
                                <label key={id} style={homeFlowCheckStyle(this.intakeTasks.has(id))}>
                                    <input
                                        type='checkbox'
                                        checked={this.intakeTasks.has(id)}
                                        onChange={() => this.toggleIntakeTask(id)}
                                        style={{ marginTop: 4 }}
                                    />
                                    <span>
                                        <b style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{INTAKE_TASK_LABELS[id]}</b>
                                        <small style={{ display: 'block', fontSize: 11.5, opacity: 0.65, lineHeight: 1.6 }}>{INTAKE_TASK_DESCRIPTIONS[id]}</small>
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>
                    <div>
                        <p style={homeFlowStyles.glabel}>仕上がりの尺</p>
                        <div style={homeFlowStyles.pills}>
                            {INTAKE_DURATION_ORDER.map(choice => (
                                <label key={choice} style={homeFlowPillStyle(this.intakeDuration === choice)}>
                                    <input
                                        type='radio'
                                        name='akari-intake-duration'
                                        checked={this.intakeDuration === choice}
                                        onChange={() => this.setIntakeDuration(choice)}
                                        style={{ position: 'absolute', opacity: 0 }}
                                    />
                                    <span>{INTAKE_DURATION_LABELS[choice]}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                    <div>
                        <p style={homeFlowStyles.glabel}>おまかせの度合い</p>
                        <div style={homeFlowStyles.pills}>
                            {INTAKE_AUTONOMY_ORDER.map(choice => (
                                <label key={choice} style={homeFlowPillStyle(this.intakeAutonomy === choice)}>
                                    <input
                                        type='radio'
                                        name='akari-intake-autonomy'
                                        checked={this.intakeAutonomy === choice}
                                        onChange={() => this.setIntakeAutonomy(choice)}
                                        style={{ position: 'absolute', opacity: 0 }}
                                    />
                                    <span>
                                        <b style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{INTAKE_AUTONOMY_LABELS[choice]}</b>
                                        <small style={{ display: 'block', fontSize: 11.5, opacity: 0.65, lineHeight: 1.6 }}>{INTAKE_AUTONOMY_DESCRIPTIONS[choice]}</small>
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>
                </div>
                <p style={{ fontSize: 11, opacity: 0.55, lineHeight: 1.7 }}>
                    保存先: .akari/intake.json（schema 検証つき）<br />チャットにも同じ内容が流れます
                </p>
                <div className='akari-home-dialog-actions'>
                    <button type='button' className='theia-button secondary' onClick={this.closeIntakeForm}>閉じる</button>
                    <button type='button' className='theia-button main' disabled={this.intakeSubmitting} onClick={() => void this.submitIntake()}>
                        {this.intakeSubmitting ? '送信しています…' : 'この内容でパートナーに依頼する'}
                    </button>
                </div>
            </HomeScrim>
        );
    }
}

// ホーム v4（dashboard）のスタイル。色は Theia テーマ変数のみ参照する
// （T1 が --theia-* を LP トークン=黒×オレンジへ差し替え済みのため、ここは
// 無変更で追随する。akari-partner-widget.tsx の chatStyles と同じ流儀）。
// v3 から持ち込む語彙は「1px widget-border + editorWidget-background +
// focusBorder アクセント」のカード再構成のみ（v4 で新規の語彙は増やさない）。
// プロジェクトカード格子。`min(目標幅, calc(33.333% - gap 調整))` は素材／カタログ面
// （akari-project の `MATERIAL_GRID_COLUMNS` / `CATALOG_GRID_COLUMNS`）と同じ流儀で、
// 「広ければ列が増え、狭くても 3 列を割らない」を 1 本の式で満たす。ウェルカムの 480px
// カード内でちょうど 3 列、ホーム面の中央カラムでは 4 列前後になる。
const PROJECT_CARD_GRID_GAP = 10;
const PROJECT_CARD_GRID_COLUMNS = 'repeat(auto-fill, minmax(min(150px, calc(33.333% - 7px)), 1fr))';

//
// 2026-09-05（カード言語そろえ・レーン B）: 面と線を
// `akari-project/common/akari-surface-tokens` へ一本化した。
// それまでは `--theia-editorWidget-background`(=VS Code 既定の #252526) と
// `--theia-widget-border`(=#262626) を直接参照していたため、
//   * 面が黒×オレンジのパレットから浮く（#252526 はパレットに無い灰）
//   * 項目の枠（#262626）がカード外周のヘアライン（alpha .13 ≒ 33）より明るく、
//     線の階層が逆転する
// という 2 つの症状が出ていた。spec.md §1 §2 §3 に合わせ、
//   面 = raised(--akari-card) / 線 = hairline(外周の約半分) / 角丸 = 8 か 6
// で統一する。色は必ずトークン経由（= 変数参照）にすること。
const homeFlowStyles: Record<string, React.CSSProperties> = {
    eyebrow: { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.18em', color: 'var(--theia-focusBorder)', textTransform: 'uppercase', marginBottom: 10 },
    h2: { fontSize: 22, fontWeight: 800, lineHeight: 1.4, margin: 0 },
    sub: { color: 'var(--theia-descriptionForeground)', fontSize: 13.5, marginTop: 8, maxWidth: '38em' },

    // ダッシュボード見出し行。見出しが「ホー / ム」と折り返さないよう縮ませない。
    dashboardHeader: { marginBottom: 14 },
    dashboardTitle: { margin: 0, fontSize: 21, flex: '0 0 auto', whiteSpace: 'nowrap' },
    cta: {
        display: 'inline-block', padding: '12px 30px', borderRadius: AKARI_RADIUS.panel, fontWeight: 700, fontSize: 14.5,
        minHeight: 'auto', height: 'auto'
    },

    cardTitle: { display: 'block', fontSize: 15, fontWeight: 700 },
    kitCard: {
        display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8, marginBottom: 12,
        padding: '13px 15px', borderRadius: AKARI_RADIUS.panel,
        border: AKARI_BORDER.hairline, background: AKARI_SURFACE.raised
    },
    kitList: { display: 'flex', flexDirection: 'column', gap: 8 },
    kitItem: {
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '8px 10px', borderRadius: AKARI_RADIUS.chip,
        background: AKARI_SURFACE.elevated, fontSize: 12
    },
    kitAction: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 12.5 },

    // プロジェクト一覧 = 唯一のスイッチャー（U3。旧・過去プロジェクト一覧 裁定 R3）。
    projectList: { display: 'grid', gridTemplateColumns: PROJECT_CARD_GRID_COLUMNS, gap: PROJECT_CARD_GRID_GAP },

    // プロジェクトカード（ウェルカム面・ホーム面・ランチャーで同じ造り）。
    projectCard: { position: 'relative', display: 'flex', minWidth: 0 },
    projectCardButton: {
        display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0, width: '100%',
        padding: 0, margin: 0, borderRadius: PROJECT_CARD_RADIUS_PX, overflow: 'hidden', textAlign: 'left',
        minHeight: 'auto', height: 'auto', cursor: 'pointer',
        border: PROJECT_CARD_BORDER, boxSizing: 'border-box', background: AKARI_SURFACE.card,
        color: 'var(--theia-editorWidget-foreground)'
    },
    projectCardThumb: {
        position: 'relative', display: 'block', width: '100%', aspectRatio: '16 / 9',
        background: 'var(--theia-sideBar-background)', overflow: 'hidden'
    },
    projectCardPlaceholder: {
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20, opacity: 0.35
    },
    // コマを敷く層。中身は ProjectCardPreview が所有する（React は空のまま渡す）。
    projectCardFrames: { position: 'absolute', inset: 0, display: 'block' },
    projectCardBody: { display: 'flex', flexDirection: 'column', alignItems: 'stretch', flex: 1, gap: 7, padding: '9px 10px', minWidth: 0 },
    projectCardName: {
        display: 'block', flex: 1, minWidth: 0, minHeight: '2.8em', fontSize: 12, fontWeight: 600,
        lineHeight: 1.4, whiteSpace: 'normal', overflowWrap: 'anywhere'
    },
    projectCardBadge: {
        alignSelf: 'flex-start', flex: '0 0 auto', maxWidth: '100%', boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontSize: 10, padding: '1px 7px', borderRadius: 999,
        border: '1px solid var(--theia-widget-border)', color: 'var(--theia-descriptionForeground)'
    },
    // 「Finder で表示」はサムネ右上に重ねる（行だった頃は横に並べていた）。
    projectCardReveal: {
        position: 'absolute', top: 5, right: 5,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, minWidth: 24, minHeight: 'auto', padding: 0,
        borderRadius: 6, fontSize: 12
    },
    // 行 = 本体ボタン（開く）+ 「Finder で表示」ボタン（task 2026-08-09-reveal-in-finder）。
    // button の入れ子は無効な HTML のため、行を div にして両ボタンを兄弟にする。
    projectRow: { display: 'flex', alignItems: 'stretch', gap: 6 },
    projectRevealButton: {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flex: '0 0 auto', minHeight: 'auto', height: 'auto', padding: '0 12px',
        borderRadius: AKARI_RADIUS.panel
    },
    // リスト項目は spec §2 の「原則 枠を持たず背景（raised）で分ける」。
    projectItem: {
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px', borderRadius: AKARI_RADIUS.panel,
        fontSize: 12.5, minHeight: 'auto', height: 'auto', width: '100%',
        border: '1px solid transparent', background: AKARI_SURFACE.raised,
        color: AKARI_INK, cursor: 'pointer', textAlign: 'left'
    },
    projectItemBody: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
    projectItemName: { fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    projectItemChannel: { opacity: 0.6, fontSize: 11 },
    chipIcon: { fontSize: 14, color: 'var(--theia-focusBorder)' },
    // U3: 現在開いている行の ▶ マークと「開いています」/「単体」バッジ。
    projectCurrentArrow: { color: 'var(--theia-focusBorder)', fontSize: 11, flex: '0 0 auto' },
    // チップは枠を持たず、1 段上の面（elevated）で親のリスト項目から分ける。
    projectBadge: {
        marginLeft: 'auto', flex: '0 0 auto', fontSize: 10.5, padding: '2px 9px',
        borderRadius: AKARI_RADIUS.chip, border: '1px solid transparent',
        color: 'var(--theia-descriptionForeground)', background: AKARI_SURFACE.elevated
    },

    formWrap: { marginTop: 22, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 },
    glabel: { fontFamily: 'monospace', fontSize: 10.5, letterSpacing: '0.16em', color: 'var(--theia-focusBorder)', textTransform: 'uppercase', marginBottom: 10 },
    checks: { display: 'flex', flexDirection: 'column', gap: 8 },
    pills: { display: 'flex', flexWrap: 'wrap', gap: 8 },

    reviewNotice: {
        marginBottom: 16, padding: '9px 13px', borderRadius: AKARI_RADIUS.panel, fontSize: 12.5,
        border: AKARI_BORDER.hairline, background: AKARI_SURFACE.raised,
        color: 'var(--theia-descriptionForeground)'
    },
    importedNotice: {
        marginBottom: 16, padding: '10px 14px', borderRadius: AKARI_RADIUS.panel,
        border: AKARI_BORDER.hairline, background: AKARI_SURFACE.raised
    },

    // D&D 復活: dragover 中だけ面全体に重なるオーバーレイ（静的レイアウトには何も足さない）。
    dropOverlay: {
        position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
        background: 'var(--theia-list-dropBackground, rgba(127,127,127,0.12))',
        border: '2px dashed var(--theia-focusBorder)', borderRadius: AKARI_RADIUS.card,
        color: AKARI_INK
    },

    // F11 ウェルカム面（状態 0・task 2026-08-05-welcome-screen）。見た目の正は
    // shell-home-mock.html の `.w-card` 系（幅 min(480px,92%) の中央カード）。
    welcomeSurface: {
        position: 'relative',
        height: '100%', overflow: 'auto', padding: '18px 22px', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
    },
    // ウェルカム面は中央寄せなので、右上の在席表示だけは面の幅いっぱいで右へ寄せる。
    welcomeTopBar: { position: 'absolute', top: 14, right: 18, left: 18, display: 'flex', justifyContent: 'flex-end' },
    welcomeStack: { width: 'min(480px, 92%)', display: 'flex', flexDirection: 'column', gap: 14 },
    // ウェルカムは「カード面の上に置く 1 枚のパネル」。外殻カードと同じ 12px にすると
    // 二重の 12px が入れ子になって見えるので、内側のパネル階層 = 8px に揃える。
    welcomeCard: {
        width: '100%', boxSizing: 'border-box', padding: '28px 28px 22px', borderRadius: AKARI_RADIUS.panel,
        border: AKARI_BORDER.hairline, background: AKARI_SURFACE.raised,
        display: 'flex', flexDirection: 'column', alignItems: 'stretch'
    },
    welcomeLogo: { fontSize: 22, fontWeight: 800, textAlign: 'center', marginBottom: 4 },
    welcomeSub: { color: 'var(--theia-descriptionForeground)', fontSize: 13, textAlign: 'center', marginBottom: 20 },
    welcomeNewButton: {
        width: '100%', padding: '13px', borderRadius: AKARI_RADIUS.panel, fontSize: 15, fontWeight: 800,
        minHeight: 'auto', height: 'auto', marginBottom: 16
    },
    welcomeListHeading: {
        fontFamily: 'monospace', fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'var(--theia-descriptionForeground)', margin: '0 0 8px'
    },
    welcomeList: { display: 'grid', gridTemplateColumns: PROJECT_CARD_GRID_COLUMNS, gap: PROJECT_CARD_GRID_GAP, marginBottom: 4 },
    // ウェルカムカード（raised）の中の項目。同じ面だと沈むので 1 段上の elevated で分ける。
    welcomeProjectItem: {
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px', borderRadius: AKARI_RADIUS.panel,
        fontSize: 13, minHeight: 'auto', height: 'auto', width: '100%',
        border: '1px solid transparent', background: AKARI_SURFACE.elevated,
        color: AKARI_INK, cursor: 'pointer', textAlign: 'left'
    },
    welcomeProjectBadge: {
        marginLeft: 'auto', flex: '0 0 auto', fontSize: 10.5, padding: '2px 9px',
        borderRadius: AKARI_RADIUS.chip, border: AKARI_BORDER.hairline,
        color: 'var(--theia-descriptionForeground)', background: 'transparent'
    },
    welcomeOpenFolder: {
        display: 'block', margin: '14px auto 0', fontSize: 12, cursor: 'pointer',
        textDecoration: 'underline', padding: 0, minHeight: 'auto', height: 'auto'
    },
    welcomeSetupButton: {
        alignSelf: 'center', display: 'inline-flex', alignItems: 'center', gap: 6,
        marginTop: 10, padding: '5px 9px', minHeight: 'auto', height: 'auto',
        fontSize: 11.5
    }
};

function homeFlowCheckStyle(checked: boolean): React.CSSProperties {
    return {
        display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 13px', borderRadius: AKARI_RADIUS.panel,
        background: checked ? 'var(--theia-list-activeSelectionBackground)' : AKARI_SURFACE.elevated,
        border: `1px solid ${checked ? AKARI_LINE.accent : 'transparent'}`, cursor: 'pointer'
    };
}

function homeFlowPillStyle(selected: boolean): React.CSSProperties {
    return {
        position: 'relative', display: 'inline-block', padding: '7px 15px', borderRadius: AKARI_RADIUS.chip, fontSize: 12.5,
        border: `1px solid ${selected ? AKARI_LINE.accent : 'transparent'}`,
        background: selected ? 'var(--theia-list-activeSelectionBackground)' : AKARI_SURFACE.elevated,
        cursor: 'pointer'
    };
}
