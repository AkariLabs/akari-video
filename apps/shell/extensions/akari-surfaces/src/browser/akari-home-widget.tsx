import * as React from '@theia/core/shared/react';
import { Message } from '@theia/core/shared/@lumino/messaging';
import URI from '@theia/core/lib/common/uri';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { QuickInputService, WidgetManager } from '@theia/core/lib/browser';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { ApplicationServer } from '@theia/core/lib/common/application-protocol';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { isOSX, isWindows } from '@theia/core/lib/common/os';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { WorkspaceCommands } from '@theia/workspace/lib/browser/workspace-commands';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import {
    IntakeAutonomy,
    IntakeDurationChoice,
    IntakeTaskId,
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
    DEFAULT_UPDATE_FEED_URL,
    ShellPlatformKey,
    UpdateCache,
    UpdateStatus,
    evaluateUpdateStatus,
    formatHomeBannerText,
    parseUpdateCache,
    withDismissedVersion
} from '../common/update-feed';
import {
    buildReleaseNotesUrl,
    evaluateVersionNotice,
    formatVersionNoticeText,
    parseShellLastVersion,
    withRecordedVersion
} from '../common/shell-version-notice';
import { AkariNewProjectService } from '../common/akari-new-project-protocol';

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
// AKARI Store の接続資格情報。書き手は launcher CLI（`akari store connect`）だけ —
// ここでもファイル契約のみで結合する（store-command.mjs への import 依存は増やさない）。
const STORE_CREDENTIALS_FILENAME = 'store-credentials.json';
const STORE_SITE_FALLBACK = 'https://akari-oss.app/store/';
// 「AI パートナー接続」のプロジェクト単位 SSOT は connections.json の akari-cloud
// provider の doctor.status（partner pane が「akari-cloud・接続済み」と表示する対象と同一）。
const CLOUD_PROVIDER_ID = 'akari-cloud';
const BEGIN_ONBOARDING_COMMAND = 'akari.partner.beginOnboarding';
const SEND_TO_PARTNER_COMMAND = 'akari.partner.send';

// --- D&D 復活（v3 home dropzone からの再利用。bacd7f5 時点の akari-home-widget.tsx） ---
// workflow.json の roles に assets kind が無いときの既定パス（v3 と同じ既定値）。
const DEFAULT_ASSETS_ROLE_PATH = 'assets';
// ドロップ／ダイアログで取り込める素材の拡張子。動画と写真のみ（音声・その他は対象外・v3 と同じ）。
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.gif', '.tiff', '.bmp'];
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
const CREATOR_ROOT_PROJECT_DISPLAY_LIMIT = 10;
// 無 root 時のプロジェクト一覧フォールバック（task 2026-08-04-home-no-root-flow）。
// v4 時代の独立案内行「作業場はまだありません…」は状態バッジ（U2/U5）と二重表示に
// なっていたため撤去した — 案内は状態バッジ 1 箇所に集約し、ここは見出し下の薄い
// 1 行に留める（U1: 「作業場」の語は使わない）。
const CREATOR_ROOT_LIST_PLACEHOLDER = 'プロジェクトはここに並びます';
// 既定チャンネル名（packages/creator-root/src/index.mjs の DEFAULT_CHANNEL_NAME と
// 同じ値。root.json の channels が空/未解決のときのフォールバックにのみ使う —
// 通常は manifest.channels[0]（誕生時に作られた最初のチャンネル）を使う）。
const CREATOR_ROOT_DEFAULT_CHANNEL = 'my-channel';

// --- F2 更新ポップアップ（task 2026-08-03-shell-quickwins-feedback） ---
// アプリ単位マーカーや更新キャッシュと同じ `<AKARI_HOME>/` 直下に置く。
const SHELL_LAST_VERSION_FILENAME = 'shell-last-version.json';

// --- F5 新しい動画を始める（task 2026-08-03-shell-quickwins-feedback） ---
const NEW_PROJECT_NAME_SLUG = 'new-video';

// --- U3 プロジェクト一覧の「単体」行（task 2026-08-03-home-v5-terms） ---
// Theia の最近開いたワークスペース履歴（WorkspaceService#recentWorkspaces）のうち
// 上位何件まで「AKARI プロジェクトのマーカー」判定の対象にするか（無関係な履歴での
// I/O を増やしすぎないための上限）。
const RECENT_WORKSPACES_SCAN_LIMIT = 20;
// 一覧に出す「単体」プロジェクトの最大件数（過去プロジェクトと合わせて肥大化させない）。
const STANDALONE_PROJECT_DISPLAY_LIMIT = 5;

interface CreatorRootProjectEntry {
    name: string;
    channel: string;
    uri: URI;
}

/** U3: 履歴から拾った「単体」（作業場外）プロジェクト 1 件。 */
interface StandaloneProjectEntry {
    name: string;
    uri: URI;
}

/** U3: プロジェクト一覧（唯一のスイッチャー）1 行分。past/current/standalone を統合した表示用の形。 */
interface ProjectListRow {
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
}

@injectable()
export class AkariHomeWidget extends ReactWidget {
    static readonly ID = 'akari-home-widget';

    @inject(FileService)
    protected readonly fileService: FileService;

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

    @inject(AkariNewProjectService)
    protected readonly newProjectService: AkariNewProjectService;

    @inject(TerminalService)
    protected readonly terminalService: TerminalService;

    protected watching = false;

    // --- F11 ウェルカム画面（状態 0・task 2026-08-05-welcome-screen） ---
    // `workspaceService.roots` が空（プロジェクト未選択で起動）のときだけ true。
    // true の間は render() が renderWelcomeSurface() に分岐し、通常ホームの要素
    // （状態バッジ・説明・接続カード等）は一切描画しない（task.md §2）。
    protected welcomeMode = false;

    // --- AKARI Store 接続（オーナー要望 2026-08-03「アプリ側でも欲しい」） ---
    protected storeEmail: string | null = null;
    protected storeConnecting = false;
    protected storeSiteUrl = STORE_SITE_FALLBACK;

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

    // --- U2 状態バッジ（旧 F6 現在地 1 行を置換。task 2026-08-03-home-v5-terms） ---
    protected currentLocation: CurrentLocation | undefined;
    // U3 のプロジェクト一覧で「開いています」を判定するための現在ワークスペース root。
    protected currentProjectUri: URI | undefined;
    // U5「チャンネルに入れる」実行中フラグ。
    protected joiningChannel = false;

    // --- ホーム v3 由来: 接続案内カード / 進め方フォーム ---
    protected connectionsUri: URI | undefined;
    protected intakeUri: URI | undefined;
    protected connected = false;
    protected intakeStatus: 'absent' | 'draft' | 'submitted' = 'absent';
    protected intakeSnapshot: IntakeSnapshot | undefined;
    protected connecting = false;

    // 進め方フォームを dashboard 内の展開セクションとして開いているか。
    // v4 ではホーム上のカードから開く経路が無くなったため、
    // `akari.home.openIntakeForm` コマンド（akari-home-command-contribution.ts）
    // 経由でのみ開く。画面の切り替えではなく「開いている / 畳んでいる」だけの
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

    // --- 更新チェック（U2 v0・ホームバナー — D5 裁定 2026-07-26） ---
    // `updateRawCache` は dismiss 書き込み時に feed 等の既存フィールドを
    // 保つために保持する（`updateStatus` は表示用に評価済みの結果だけを持つ）。
    protected updateCacheUri: URI | undefined;
    protected updateRawCache: UpdateCache | null = null;
    protected updateStatus: UpdateStatus = { available: false };

    @postConstruct()
    protected init(): void {
        this.id = AkariHomeWidget.ID;
        this.title.label = 'ホーム';
        this.title.caption = 'AKARI プロジェクトホーム';
        this.title.iconClass = 'codicon codicon-home';
        this.title.closable = false;
        this.update();
    }

    async start(): Promise<void> {
        // F11: ウェルカム判定は roots の有無だけを見る軽い判定なので最初に済ませる
        // （後続のロードが終わるのを待たせない）。
        await this.refreshWelcomeMode();
        await this.loadHomeFlow();
        await this.loadCreatorRootProjects();
        // U3: 履歴由来の「単体」プロジェクトは creatorRootProjects（重複除外に使う）の後に読む。
        await this.loadStandaloneProjects();
        // U2: 状態バッジの解決（creatorRootUri）の後に読む — 現在地がチャンネルの
        // 内側かどうかの判定に使うため。
        await this.refreshCurrentLocation();
        // 更新チェック（契約の起動非ブロック原則）: キャッシュの読み比較は待つが
        // （ローカル I/O のみ・十分高速）、バックグラウンド fetch はここで await しない
        // （loadUpdateStatus 内で fire-and-forget にしてある）。
        await this.loadUpdateStatus();
        // F2: 「更新されました」ポップアップ（U2 のリモートフィード比較とは独立・
        // ローカル前回起動記録のみで判定。起動を待たせないほど重くはないため await する）。
        await this.checkVersionNotice();
        if (this.watching) {
            return;
        }
        this.watching = true;
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            if (
                (this.connectionsUri && event.contains(this.connectionsUri)) ||
                (this.intakeUri && event.contains(this.intakeUri))
            ) {
                void this.refreshHomeFlow();
            }
        }));
    }

    /**
     * ホームが再表示されるたびに接続状態・プロジェクト一覧を読み直す。
     * アプリ単位マーカーやプロジェクト一覧は watch していない（v0）ため、
     * 他のタブから戻ってきたときに取り残されないようにするのはこの経路。
     */
    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        void this.refreshWelcomeMode();
        void this.refreshHomeFlow();
        void this.loadCreatorRootProjects()
            .then(() => this.loadStandaloneProjects())
            .then(() => this.refreshCurrentLocation());
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
        this.connected = await this.readConnected();
        this.storeEmail = await this.readStoreConnection();
        const intake = await this.readIntake();
        this.intakeSnapshot = intake;
        this.intakeStatus = intake.status;
        this.update();
    }

    /**
     * AKARI Store の接続状態（`~/.akari/store-credentials.json`・AKARI_HOME で差し替え可）。
     * 読み方は partner-connection.json と同じ EnvVariablesServer + FileService 経路。
     * 無い/壊れていれば未接続扱い（フェイルセーフ側）。watch は張らない —
     * 反映は connectStore のポーリングとホーム再表示時の読み直しで担保する（v0 の流儀）。
     */
    protected async readStoreConnection(): Promise<string | null> {
        try {
            const uri = (await this.resolveAkariHomeUri()).resolve(STORE_CREDENTIALS_FILENAME);
            const parsed = JSON.parse((await this.fileService.readFile(uri)).value.toString());
            if (typeof parsed?.token !== 'string') {
                return null;
            }
            if (typeof parsed?.url === 'string') {
                // 資格情報の url は API 基点（…/api/store）。サイト側の基点に読み替える
                this.storeSiteUrl = parsed.url.replace(/\/api\/store\/?$/, '/store/');
            }
            return typeof parsed?.email === 'string' ? parsed.email : '接続済み';
        } catch {
            return null;
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
     * 足りる契約）。同一セッション内の反映は connectPartner の完了時と
     * ホーム再表示時の読み直しで担保する。
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
            taste: null
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
                taste: typeof target?.taste === 'string' ? target.taste : null
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
            this.update();
            return;
        }
        this.creatorRootAvailable = true;
        this.creatorRootUri = rootUri;
        this.creatorRootProjects = await this.listCreatorRootProjects(rootUri);
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
        for (const raw of recent.slice(0, RECENT_WORKSPACES_SCAN_LIMIT)) {
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
            results.push({ name: uri.path.base || fsPath, uri });
            if (results.length >= STANDALONE_PROJECT_DISPLAY_LIMIT) {
                break;
            }
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
                entries.push({ name: projectDir.name, channel: channelDir.name, uri: projectDir.resource });
            }
        }
        return this.sortCreatorRootProjects(entries).slice(0, CREATOR_ROOT_PROJECT_DISPLAY_LIMIT);
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
     * クリックでそのプロジェクトをワークスペースとして開く。既存の Theia
     * `WorkspaceService#open` をそのまま呼ぶだけで新規実装はしない
     * （§task「既存の Theia workspace open 系サービス/コマンドを使う」）。
     * `preserveWindow` は指定しない = 既定の「別ウィンドウで開く」（Theia 標準の
     * フォルダ切り替え挙動。現在開いているプロジェクトはそのまま残る）。
     */
    protected openCreatorRootProject = (uri: URI): void => {
        this.workspaceService.open(uri);
    };

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
     * （日付プレフィックスは過去プロジェクト一覧の並び順（sortCreatorRootProjects）と
     * 揃える）。同名衝突時は `-2` `-3` ... を試す（`availableTarget` と同じ流儀）。
     */
    protected async reserveNewProjectName(rootUri: URI, channel: string): Promise<string> {
        const videosUri = rootUri.resolve(CREATOR_ROOT_CHANNELS_DIRNAME).resolve(channel).resolve(CREATOR_ROOT_VIDEOS_DIRNAME);
        const datePrefix = new Date().toISOString().slice(0, 10);
        const stem = `${datePrefix}-${NEW_PROJECT_NAME_SLUG}`;
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
     * 生成できたら `openCreatorRootProject` と同じ `WorkspaceService#open` で開く。
     */
    protected startNewProject = async (): Promise<void> => {
        if (this.startingNewProject) {
            return;
        }
        this.startingNewProject = true;
        this.update();
        try {
            const rootUri = this.creatorRootUri ?? await this.ensureCreatorRootForNewProject();
            if (!rootUri) {
                this.startingNewProject = false;
                this.update();
                return;
            }
            const channel = await this.resolveDefaultChannelName(rootUri);
            const name = await this.reserveNewProjectName(rootUri, channel);
            const destination = rootUri.resolve(CREATOR_ROOT_CHANNELS_DIRNAME).resolve(channel).resolve(CREATOR_ROOT_VIDEOS_DIRNAME).resolve(name);
            await this.newProjectService.createProject(destination.toString());
            this.workspaceService.open(destination);
        } catch (error) {
            console.error('[akari-surfaces] failed to start a new project:', error);
            this.messages.error('新しい動画の作成に失敗しました。');
            this.startingNewProject = false;
            this.update();
        }
    };

    /**
     * 無 root 時の「+ 新しい動画を始める」連結（F9 ensureCreatorRoot・
     * task 2026-08-05-welcome-screen §1）。`createChannelDestinationAndJoin`
     * （U5「チャンネルに入れる」の無 root 連結・task 2026-08-04-home-no-root-flow）と
     * 対になる新規プロジェクト版 — 確認は 1 回だけ、「作業場」の語は出さない（U1）。
     * 解決できたら以後の一覧・状態バッジ解決も新しい置き場を見られるようにしておく
     * （`createChannelDestinationAndJoin` と同じ流儀）。
     */
    protected async ensureCreatorRootForNewProject(): Promise<URI | undefined> {
        const confirmed = await new ConfirmDialog({
            title: 'チャンネルの置き場を作成しますか？',
            msg: 'チャンネルの置き場がまだありません。作成して、新しい動画を始めますか？（データの場所: ~/Akari）',
            ok: '作成してはじめる',
            cancel: 'キャンセル'
        }).open();
        if (!confirmed) {
            return undefined;
        }
        try {
            const rootUriString = await this.newProjectService.ensureCreatorRoot();
            const rootUri = new URI(rootUriString);
            this.creatorRootUri = rootUri;
            this.creatorRootAvailable = true;
            return rootUri;
        } catch (error) {
            console.error('[akari-surfaces] failed to ensure a channel destination for a new project:', error);
            this.messages.error(error instanceof Error ? error.message : 'チャンネルの置き場の作成に失敗しました。');
            return undefined;
        }
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
            this.workspaceService.open(new URI(destinationUri));
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
     * キャッシュを読み、現在のシェル版と比較してバナーを出すかどうかを決める。
     * ファイルが無い・壊れている場合は「新版なし」と同じ扱いで沈黙する（契約の沈黙原則）。
     * 読み込み後、バックグラウンド fetch を fire-and-forget で起動する（await しない —
     * ここが「起動をブロックしない」の核）。
     */
    protected async loadUpdateStatus(): Promise<void> {
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
        this.updateStatus = evaluateUpdateStatus(currentVersion, this.updateRawCache, this.resolveShellPlatformKey());
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
            const feedUrlVar = await this.envVariables.getValue('AKARI_UPDATE_FEED_URL');
            const feedUrl = feedUrlVar?.value || DEFAULT_UPDATE_FEED_URL;
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
            const next: UpdateCache = { schema: 1, fetched_at: nowIso, feed, dismissed: this.updateRawCache?.dismissed ?? {} };
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
            this.updateStatus = evaluateUpdateStatus(appInfo?.version ?? '0.0.0', next, this.resolveShellPlatformKey());
            this.update();
        } catch {
            // オフライン・タイムアウト・JSON パース失敗などをすべてここで沈黙する。
        }
    }

    /** 「今回はスキップ」: dismissed に記録し、バナーを消す。 */
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
        this.update();
    };

    /**
     * 「更新する」（F7-v1・task 2026-08-03-home-v5-terms）: 自プラットフォームの配布物
     * URL（無ければ notes_url。`evaluateUpdateStatus`/`resolveUpdateDownloadUrl` が
     * 解決済み）を外部ブラウザで開いてダウンロードを開始する。`{ external: true }` を
     * 明示しないと Electron 版 `WindowService`（`electron-main-window-service-impl.js`）は
     * 新規 Electron ウィンドウで URL を内部的に開くだけになり（`shell.openExternal` が
     * 呼ばれない）、バイナリ配布物のダウンロードが実ブラウザのダウンロードマネージャ
     * を経由しない — task.md の「外部ブラウザで開いて DL 開始」を満たすにはこのフラグが必須。
     */
    protected downloadUpdate = (): void => {
        if (this.updateStatus.downloadUrl) {
            this.windowService.openNewWindow(this.updateStatus.downloadUrl, { external: true });
        }
    };

    // --- ホーム v2: アクション ---

    protected connectPartner = async (): Promise<void> => {
        if (this.connecting) {
            return;
        }
        this.connecting = true;
        this.update();
        try {
            await this.commands.executeCommand(BEGIN_ONBOARDING_COMMAND);
        } finally {
            this.connecting = false;
            // アプリ単位マーカーは watch していない（v0）。接続フローが終わった
            // この時点で読み直すことで、connections.json を持たないプロジェクト
            // でも同一セッション内でゲートが消える。connections.json 側の修復は
            // watch でも拾われるが、二重に読んでも害はない。
            await this.refreshHomeFlow();
        }
    };

    /**
     * ストア接続（オーナー要望 2026-08-03）。アプリ内ターミナルで CLI の
     * デバイスコードフロー（ブラウザ承認）を起動するだけ — 資格情報の書き手は
     * launcher CLI のまま。完了はファイルの出現ポーリングで検知する（最大 5 分）。
     */
    protected connectStore = async (): Promise<void> => {
        if (this.storeConnecting) {
            return;
        }
        this.storeConnecting = true;
        this.update();
        try {
            const terminal = await this.terminalService.newTerminal({ title: 'AKARI Store 接続' });
            await terminal.start();
            this.terminalService.open(terminal);
            terminal.sendText('akari store connect\n');
        } catch (error) {
            console.error('[akari-surfaces] store connect terminal failed', error);
            this.messages.error('ターミナルを開けませんでした。手動で `akari store connect` を実行してください。');
            this.storeConnecting = false;
            this.update();
            return;
        }
        const deadline = Date.now() + 5 * 60 * 1000;
        const poll = async (): Promise<void> => {
            this.storeEmail = await this.readStoreConnection();
            if (this.storeEmail !== null || Date.now() > deadline) {
                this.storeConnecting = false;
                this.update();
                return;
            }
            setTimeout(() => void poll(), 4000);
        };
        setTimeout(() => void poll(), 4000);
    };

    protected openStoreSite = (): void => {
        const base = this.storeSiteUrl.replace(/\/$/, '');
        this.windowService.openNewWindow(this.storeEmail !== null ? `${base}/library` : `${base}/`, { external: true });
    };

    /**
     * 進め方フォームを dashboard 内の展開セクションとして開く（裁定 R5）。
     * v4 ではホーム上にカードが無いため、`AkariHomeCommandContribution`
     * （`akari.home.openIntakeForm` コマンド）からのみ呼ばれる —
     * そのため public にしてある。「進め方を決める」（absent / draft）と
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
     * フォームを畳む唯一の導線（「ダッシュボードに戻る」）。戻り先は dashboard の
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
            submitted_at: new Date().toISOString()
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
    protected async importDroppedSources(sources: URI[]): Promise<void> {
        const roots = await this.workspaceService.roots;
        const root = roots[0]?.resource;
        if (!root) {
            this.messages.warn('先にプロジェクトを開いてください。');
            return;
        }
        await this.importSources(sources, root);
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

    protected async importSources(sources: URI[], root: URI): Promise<void> {
        const supported = sources.filter(uri => IMPORTABLE_EXTENSIONS.includes(this.extensionOf(uri.path.base)));
        if (!supported.length) {
            this.messages.warn('動画または写真のファイルを選んでください。');
            return;
        }
        this.importing = true;
        this.update();
        const assetsRolePath = await this.resolveAssetsRolePath(root);
        const assetsUri = root.resolve(assetsRolePath);
        let imported = 0;
        let failed = 0;
        for (const source of supported) {
            try {
                // FileService.copy は同名ファイルがあると例外になる（自動リネームはしない）。
                // 同じ素材の再ドロップを失敗にしないため、空いている名前を探してからコピーする。
                const target = await this.availableTarget(assetsUri, this.safeFileName(source.path.base));
                await this.fileService.copy(source, target, { fromUserGesture: true });
                imported++;
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
        if (this.welcomeMode) {
            return this.renderWelcomeSurface();
        }
        return (
            <div
                className='akari-home-surface'
                data-akari-home-stage='dashboard'
                data-akari-dropzone='true'
                onDragOver={this.handleDragOver}
                onDragLeave={this.handleDragLeave}
                onDrop={this.handleDrop}
                style={{ height: '100%', overflow: 'auto', padding: '18px 22px', boxSizing: 'border-box', position: 'relative' }}
            >
                {this.renderDashboardHeader()}
                {this.updateStatus.available && this.renderUpdateBanner()}
                {this.importedNotice && this.renderImportedNotice()}
                {this.renderExplanation()}
                {this.renderProjectList()}
                {!this.connected && this.renderConnectCard()}
                {this.renderStoreCard()}
                {this.intakeFormOpen && this.renderIntakeForm()}
                {this.dragActive && this.renderDropOverlay()}
            </div>
        );
    }

    /**
     * F11 ウェルカム面（状態 0・task 2026-08-05-welcome-screen）。見た目の正は
     * `planning/attachments/2026-08-03-owner-feedback-shell-v013/shell-home-mock.html`
     * の「状態 0: ウェルカム」。中央カード 1 枚に「プロジェクトを開く」だけを
     * 集中させる。更新があればカードより先/上に案内する（F11 追補・
     * オーナー追加裁定「起動 → 更新案内 → ウェルカム」。既存の
     * {@link renderUpdateBanner} をそのまま流用し、スキップ/更新後はバナーが
     * 消えてカードだけが残る = ウェルカムへ集中が移る）。左パネル・パートナー
     * ペインの沈黙化（薄化・無効化）は akari-shell-strip 側の担当でスコープ外
     * （task.md §4 指定 — この widget からは触らない）。
     */
    protected renderWelcomeSurface(): React.ReactNode {
        return (
            <div
                className='akari-home-surface akari-home-welcome'
                data-akari-home-stage='welcome'
                style={homeFlowStyles.welcomeSurface}
            >
                <div style={homeFlowStyles.welcomeStack}>
                    {this.updateStatus.available && this.renderUpdateBanner()}
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
     * 出さず新規ボタンのみにする（task.md §1 指定）。
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
                    onClick={() => void this.startNewProject()}
                >
                    {this.startingNewProject ? '作成しています…' : '＋ 新しい動画を始める'}
                </button>
                {rows.length > 0 && (
                    <>
                        <p style={homeFlowStyles.welcomeListHeading}>最近のプロジェクト</p>
                        <div style={homeFlowStyles.welcomeList} data-akari-welcome-list='true'>
                            {rows.map(row => (
                                <button
                                    key={row.key}
                                    type='button'
                                    className='theia-button secondary'
                                    style={homeFlowStyles.welcomeProjectItem}
                                    data-akari-project-item='true'
                                    data-akari-project-standalone={row.standalone ? 'true' : undefined}
                                    onClick={() => this.openCreatorRootProject(row.uri)}
                                >
                                    <span className='codicon codicon-folder' aria-hidden='true' style={homeFlowStyles.chipIcon} />
                                    <span style={homeFlowStyles.projectItemBody}>
                                        <strong style={homeFlowStyles.projectItemName}>{row.name}</strong>
                                    </span>
                                    {!row.standalone && row.channel && <span style={homeFlowStyles.welcomeProjectBadge}>{row.channel}</span>}
                                    {row.standalone && <span style={homeFlowStyles.welcomeProjectBadge}>単体</span>}
                                </button>
                            ))}
                        </div>
                    </>
                )}
                <button
                    type='button'
                    style={homeFlowStyles.welcomeOpenFolder}
                    data-akari-welcome-open-folder='true'
                    onClick={this.openFolderAdvanced}
                >
                    フォルダを開く…（上級者向け）
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
            <div role='status' style={{
                marginBottom: 16, padding: '10px 14px', borderRadius: 8,
                border: '1px solid var(--theia-widget-border)', background: 'var(--theia-editorWidget-background)'
            }}>
                {this.importedNotice}
            </div>
        );
    }

    /**
     * 更新ホームバナー（D5 裁定・F7-v1 更新 — task 2026-08-03-home-v5-terms）。
     * 新版がある時だけ出す。常時領域を専有しない。アクション 2 つ:
     * 更新する（自プラットフォーム配布物 DL を外部ブラウザで開始） /
     * 今回はスキップ（dismissed 記録・不変）。文言・ボタン構成はモック準拠（U7・U8）。
     */
    protected renderUpdateBanner(): React.ReactNode {
        return (
            <div role='status' style={homeFlowStyles.updateBanner}>
                <span className='codicon codicon-arrow-circle-up' aria-hidden='true' style={homeFlowStyles.updateBannerIcon} />
                <span style={homeFlowStyles.updateBannerText}>{formatHomeBannerText(this.updateStatus)}</span>
                <div style={homeFlowStyles.updateBannerActions}>
                    <button
                        type='button'
                        className='theia-button main'
                        style={homeFlowStyles.updateBannerButton}
                        data-akari-update-download='true'
                        onClick={this.downloadUpdate}
                    >
                        更新する
                    </button>
                    <button type='button' className='theia-button secondary' style={homeFlowStyles.updateBannerButton} onClick={() => void this.dismissUpdate()}>
                        今回はスキップ
                    </button>
                </div>
            </div>
        );
    }

    protected renderDashboardHeader(): React.ReactNode {
        return (
            <header style={{ marginBottom: 14 }}>
                <h1 style={{ margin: 0, fontSize: 21 }}>ホーム</h1>
                {this.renderStatusBadge()}
            </header>
        );
    }

    /**
     * U2 状態バッジ（旧 F6 現在地 1 行・パンくずを置換。task 2026-08-03-home-v5-terms）。
     * 「作業場」の語は使わない（U1）。開いているワークスペースが無ければ何も出さない。
     * `data-akari-current-location='true'` は旧 evidence / 検証スクリプトとの
     * 掴みどころ互換のため据え置く（task.md §6 指定）。
     */
    protected renderStatusBadge(): React.ReactNode {
        if (!this.currentLocation) {
            return undefined;
        }
        if (this.currentLocation.kind === 'inside') {
            return (
                <div
                    data-akari-current-location='true'
                    data-akari-status-kind='inside'
                    style={{ ...homeFlowStyles.statusBadge, ...homeFlowStyles.statusBadgeIn }}
                >
                    <span style={homeFlowStyles.statusText}>
                        📺 チャンネル <strong>{this.currentLocation.channel}</strong> の設定・スタイルが効いています
                    </span>
                    <span style={homeFlowStyles.statusSub}>
                        データの場所: {this.currentLocation.rootPath}（変更は設定から）
                    </span>
                </div>
            );
        }
        return (
            <div
                data-akari-current-location='true'
                data-akari-status-kind='outside'
                style={homeFlowStyles.statusBadge}
            >
                <span style={homeFlowStyles.statusText}>⚪ 単体プロジェクト — チャンネルの設定は効いていません</span>
                <button
                    type='button'
                    className='theia-button main'
                    style={homeFlowStyles.joinButton}
                    disabled={this.joiningChannel}
                    data-akari-join-channel='true'
                    onClick={() => void this.joinChannel()}
                >
                    {this.joiningChannel ? '入れています…' : 'チャンネルに入れる'}
                </button>
                <span style={homeFlowStyles.statusSub}>
                    入れると、テロップのスタイルや好みの設定がこのプロジェクトにも効くようになります
                </span>
            </div>
        );
    }

    /**
     * 説明ブロック（裁定 R1 ①・2026-08-02）。ホームが教えるのは 2 動作だけ:
     * 「左に素材を入れる」「右で相棒に話す」。真ん中（結果サーフェス・裁定 R4）
     * についても 1 行だけ触れる。ここから先の工程はエージェント + ファイルに
     * 委ね、ホーム自身はこれ以上の制御 UI を持たない。
     */
    protected renderExplanation(): React.ReactNode {
        return (
            <section style={homeFlowStyles.card}>
                <div style={homeFlowStyles.cardBody}>
                    <strong style={homeFlowStyles.cardTitle}>はじめかたはこれだけです</strong>
                    <p style={homeFlowStyles.cardLead}>
                        左に動画・写真を入れるか、右で相棒に話しかけてください。
                    </p>
                    <p style={homeFlowStyles.cardFine}>真ん中には、進めた結果（プレビューやレポート）が表示されます。</p>
                    <p style={homeFlowStyles.cardFine}>この画面のどこにドラッグ＆ドロップしても素材を取り込めます。</p>
                </div>
            </section>
        );
    }

    /**
     * U3「プロジェクト一覧 = 唯一のスイッチャー」（task 2026-08-03-home-v5-terms・
     * 旧・過去プロジェクト一覧 裁定 R3 を改称・拡張）。creatorRootProjects（過去+
     * 現在）と standaloneProjects（単体・履歴由来）を 1 本の行配列に統合する。
     * 現在開いているプロジェクトは ▶ +「開いています」を付け、クリックを無効化する
     * （task.md 指定）。作業場が解決できないときは、状態バッジ（U2/U5・単体プロジェクト
     * なら「チャンネルに入れる」がそこに出る）と案内が二重にならないよう、ここは
     * 見出し下の薄い 1 行だけに留める（task 2026-08-04-home-no-root-flow）。
     */
    protected renderProjectList(): React.ReactNode {
        if (!this.creatorRootAvailable) {
            return (
                <section style={{ marginBottom: 16 }}>
                    <p style={homeFlowStyles.glabel}>プロジェクト</p>
                    <p style={homeFlowStyles.cardFine}>{CREATOR_ROOT_LIST_PLACEHOLDER}</p>
                </section>
            );
        }
        const rows = this.buildProjectRows();
        return (
            <section style={{ marginBottom: 16 }}>
                <p style={homeFlowStyles.glabel}>プロジェクト</p>
                <div style={homeFlowStyles.projectList}>
                    {this.renderNewProjectItem()}
                    {rows.length === 0 ? (
                        <p style={homeFlowStyles.cardLead}>まだプロジェクトがありません。</p>
                    ) : rows.map(row => (
                        <button
                            key={row.key}
                            type='button'
                            className='theia-button secondary'
                            style={homeFlowStyles.projectItem}
                            disabled={row.current}
                            data-akari-project-item='true'
                            data-akari-project-current={row.current ? 'true' : undefined}
                            data-akari-project-standalone={row.standalone ? 'true' : undefined}
                            onClick={() => !row.current && this.openCreatorRootProject(row.uri)}
                        >
                            {row.current && <span aria-hidden='true' style={homeFlowStyles.projectCurrentArrow}>▶</span>}
                            <span className='codicon codicon-folder' aria-hidden='true' style={homeFlowStyles.chipIcon} />
                            <span style={homeFlowStyles.projectItemBody}>
                                <strong style={homeFlowStyles.projectItemName}>{row.name}</strong>
                                {!row.standalone && row.channel && <small style={homeFlowStyles.projectItemChannel}>{row.channel}</small>}
                            </span>
                            {row.current && <span style={homeFlowStyles.projectBadge}>開いています</span>}
                            {row.standalone && <span style={homeFlowStyles.projectBadge}>単体</span>}
                        </button>
                    ))}
                </div>
            </section>
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
            name: project.name,
            uri: project.uri,
            channel: project.channel,
            current: currentFsPath !== undefined && project.uri.path.fsPath() === currentFsPath,
            standalone: false
        }));

        let matchedCurrent = rows.some(row => row.current);
        for (const project of this.standaloneProjects) {
            const isCurrent = !matchedCurrent && currentFsPath !== undefined && project.uri.path.fsPath() === currentFsPath;
            if (isCurrent) {
                matchedCurrent = true;
            }
            rows.push({ key: project.uri.toString(), name: project.name, uri: project.uri, current: isCurrent, standalone: true });
        }

        if (!matchedCurrent && this.currentLocation?.kind === 'outside') {
            const uri = this.currentLocation.projectUri;
            rows.push({
                key: uri.toString(),
                name: uri.path.base || uri.path.fsPath(),
                uri,
                current: true,
                standalone: true
            });
        }

        return rows;
    }

    /**
     * F5「+ 新しい動画を始める」（プロジェクト一覧の先頭に 1 個。task.md 指定）。
     * `renderProjectList` が `creatorRootAvailable` の時しか呼ばないため、ここは
     * 「作業場が無ければボタンを出さない」を自然に満たす。
     */
    protected renderNewProjectItem(): React.ReactNode {
        return (
            <button
                type='button'
                className='theia-button main'
                style={homeFlowStyles.newProjectItem}
                disabled={this.startingNewProject}
                data-akari-new-project='true'
                onClick={() => void this.startNewProject()}
            >
                <span className={`codicon ${this.startingNewProject ? 'codicon-loading codicon-modifier-spin' : 'codicon-add'}`} aria-hidden='true' style={homeFlowStyles.chipIcon} />
                <span style={homeFlowStyles.projectItemBody}>
                    <strong style={homeFlowStyles.projectItemName}>
                        {this.startingNewProject ? '作成しています…' : '+ 新しい動画を始める'}
                    </strong>
                </span>
            </button>
        );
    }

    /**
     * 接続案内カード（裁定 R6）。未接続のときだけ dashboard に出る**案内**で、
     * ゲートではない — 上にある説明・過去プロジェクトを開く操作は未接続のまま行える。
     */
    protected renderConnectCard(): React.ReactNode {
        return (
            <section style={{ ...homeFlowStyles.card, ...homeFlowStyles.cardAccent }}>
                <div style={homeFlowStyles.cardMark} aria-hidden='true'>
                    <span className='codicon codicon-comment-discussion' style={{ fontSize: 20, color: 'var(--theia-button-foreground)' }} />
                </div>
                <div style={homeFlowStyles.cardBody}>
                    <strong style={homeFlowStyles.cardTitle}>パートナーとつなぐ</strong>
                    <p style={homeFlowStyles.cardLead}>
                        過去プロジェクトを開くなど、ここまでの操作は接続前でも使えます。
                    </p>
                    <p style={homeFlowStyles.cardFine}>初回のみ · 完了すると次からは自動接続</p>
                </div>
                <button
                    type='button'
                    className='theia-button main'
                    style={homeFlowStyles.cardCta}
                    disabled={this.connecting}
                    onClick={() => void this.connectPartner()}
                >
                    {this.connecting ? '接続しています…' : 'パートナーに接続する'}
                </button>
            </section>
        );
    }

    /**
     * AKARI Store カード（ホーム v4 の 3 要素へのオーナー承認済み追加・2026-08-03）。
     * 未接続 = 接続ボタン（アプリ内ターミナルでブラウザ承認フロー）。
     * 接続済み = メール表示 + マイページを外部ブラウザで開く。
     */
    protected renderStoreCard(): React.ReactNode {
        const connected = this.storeEmail !== null;
        return (
            <section style={homeFlowStyles.card}>
                <div style={homeFlowStyles.cardMark} aria-hidden='true'>
                    <span className='codicon codicon-package' style={{ fontSize: 20, color: 'var(--theia-button-foreground)' }} />
                </div>
                <div style={homeFlowStyles.cardBody}>
                    <strong style={homeFlowStyles.cardTitle}>AKARI Store</strong>
                    <p style={homeFlowStyles.cardLead}>
                        {connected
                            ? `接続中: ${this.storeEmail}`
                            : '購入した素材（宣言パック・3D モックなど）を本体で使うには接続します。'}
                    </p>
                    {connected && (
                        <p style={homeFlowStyles.cardFine}>購入素材の導入は「購入した素材をセットアップして」と頼むだけ</p>
                    )}
                </div>
                {connected ? (
                    <button
                        type='button'
                        className='theia-button secondary'
                        style={homeFlowStyles.cardCta}
                        onClick={() => this.openStoreSite()}
                    >
                        ストアを開く
                    </button>
                ) : (
                    <button
                        type='button'
                        className='theia-button main'
                        style={homeFlowStyles.cardCta}
                        disabled={this.storeConnecting}
                        onClick={() => void this.connectStore()}
                    >
                        {this.storeConnecting ? '承認を待っています…' : 'ストアに接続する'}
                    </button>
                )}
            </section>
        );
    }

    /**
     * 進め方フォーム（intake サーフェス）。ステージではなく dashboard 内の展開
     * セクションで、畳む導線は「ダッシュボードに戻る」の 1 種類だけ（裁定 R5）。
     * v4 では `akari.home.openIntakeForm` コマンドからのみ開く（v3 の
     * 「進め方カード」はホームから撤去済み）。
     */
    protected renderIntakeForm(): React.ReactNode {
        return (
            <div style={homeFlowStyles.intakeSection}>
                <button type='button' style={homeFlowStyles.backLink} onClick={this.closeIntakeForm}>
                    <span className='codicon codicon-arrow-left' aria-hidden='true' /> ダッシュボードに戻る
                </button>
                {this.intakeStatus === 'submitted' && (
                    <p style={homeFlowStyles.reviewNotice}>
                        以前送信した内容を表示しています。内容を直して送信すると上書きされます。
                    </p>
                )}
                <p style={homeFlowStyles.eyebrow}>Home — Intake</p>
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
                                    <span>{INTAKE_AUTONOMY_LABELS[choice]}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <button
                            type='button'
                            className='theia-button main'
                            style={homeFlowStyles.cta}
                            disabled={this.intakeSubmitting}
                            onClick={() => void this.submitIntake()}
                        >
                            {this.intakeSubmitting ? '送信しています…' : 'この内容でパートナーに依頼する'}
                        </button>
                        <p style={{ fontSize: 11, opacity: 0.55, lineHeight: 1.7 }}>
                            保存先: .akari/intake.json（schema 検証つき）<br />チャットにも同じ内容が流れます
                        </p>
                    </div>
                </div>
            </div>
        );
    }
}

// ホーム v4（dashboard）のスタイル。色は Theia テーマ変数のみ参照する
// （T1 が --theia-* を LP トークン=黒×オレンジへ差し替え済みのため、ここは
// 無変更で追随する。akari-partner-widget.tsx の chatStyles と同じ流儀）。
// v3 から持ち込む語彙は「1px widget-border + editorWidget-background +
// focusBorder アクセント」のカード再構成のみ（v4 で新規の語彙は増やさない）。
const homeFlowStyles: Record<string, React.CSSProperties> = {
    eyebrow: { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.18em', color: 'var(--theia-focusBorder)', textTransform: 'uppercase', marginBottom: 10 },
    h2: { fontSize: 22, fontWeight: 800, lineHeight: 1.4, margin: 0 },
    sub: { color: 'var(--theia-descriptionForeground)', fontSize: 13.5, marginTop: 8, maxWidth: '38em' },

    cta: {
        display: 'inline-block', padding: '12px 30px', borderRadius: 10, fontWeight: 700, fontSize: 14.5,
        minHeight: 'auto', height: 'auto'
    },

    // 案内カード（説明 / 過去プロジェクトのフォールバック / 接続）。ロックではないので画面を占有せず 1 枚に収める。
    card: {
        display: 'flex', alignItems: 'flex-start', gap: 13, marginBottom: 12, padding: '13px 15px',
        borderRadius: 12, border: '1px solid var(--theia-widget-border)',
        background: 'var(--theia-editorWidget-background)'
    },
    cardAccent: { borderColor: 'var(--theia-focusBorder)' },
    cardMark: {
        width: 38, height: 38, flex: '0 0 auto', borderRadius: 11,
        background: 'var(--theia-button-background)', display: 'flex', alignItems: 'center', justifyContent: 'center'
    },
    cardBody: { flex: '1 1 auto', minWidth: 0 },
    cardTitle: { display: 'block', fontSize: 15, fontWeight: 700 },
    cardLead: { color: 'var(--theia-descriptionForeground)', fontSize: 12.5, lineHeight: 1.75, margin: '6px 0 0', maxWidth: '44em' },
    cardFine: { marginTop: 8, marginBottom: 0, fontSize: 11, opacity: 0.6, fontFamily: 'monospace' },
    cardCta: {
        flex: '0 0 auto', padding: '9px 18px', borderRadius: 9, fontWeight: 700, fontSize: 13,
        minHeight: 'auto', height: 'auto'
    },

    // プロジェクト一覧 = 唯一のスイッチャー（U3。旧・過去プロジェクト一覧 裁定 R3）。
    projectList: { display: 'flex', flexDirection: 'column', gap: 6 },
    projectItem: {
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px', borderRadius: 9,
        fontSize: 12.5, minHeight: 'auto', height: 'auto', width: '100%',
        border: '1px solid var(--theia-widget-border)', background: 'var(--theia-editorWidget-background)',
        color: 'var(--theia-editorWidget-foreground)', cursor: 'pointer', textAlign: 'left'
    },
    projectItemBody: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
    projectItemName: { fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    projectItemChannel: { opacity: 0.6, fontSize: 11 },
    chipIcon: { fontSize: 14, color: 'var(--theia-focusBorder)' },
    // U3: 現在開いている行の ▶ マークと「開いています」/「単体」バッジ。
    projectCurrentArrow: { color: 'var(--theia-focusBorder)', fontSize: 11, flex: '0 0 auto' },
    projectBadge: {
        marginLeft: 'auto', flex: '0 0 auto', fontSize: 10.5, padding: '2px 9px', borderRadius: 999,
        border: '1px solid var(--theia-widget-border)', color: 'var(--theia-descriptionForeground)',
        background: 'var(--theia-editorWidget-background)'
    },

    // F5「+ 新しい動画を始める」（プロジェクト一覧の先頭）。
    newProjectItem: {
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px', borderRadius: 9,
        fontSize: 12.5, minHeight: 'auto', height: 'auto', width: '100%',
        justifyContent: 'flex-start', textAlign: 'left'
    },

    // U2 状態バッジ（旧 F6 現在地 1 行を置換）。
    statusBadge: {
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        marginTop: 8, marginBottom: 4, padding: '9px 13px', borderRadius: 10,
        border: '1px solid var(--theia-widget-border)', background: 'var(--theia-editorWidget-background)',
        fontSize: 13
    },
    statusBadgeIn: { borderColor: 'var(--theia-focusBorder)' },
    statusText: { flex: '1 1 auto' },
    statusSub: {
        flexBasis: '100%', color: 'var(--theia-descriptionForeground)', fontSize: 11.5, paddingLeft: 2
    },
    joinButton: {
        flex: '0 0 auto', padding: '5px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
        minHeight: 'auto', height: 'auto'
    },

    // dashboard 内に展開する進め方フォーム（ステージではない）。
    intakeSection: {
        marginBottom: 22, padding: '16px 18px', borderRadius: 12,
        border: '1px solid var(--theia-focusBorder)', background: 'var(--theia-editorWidget-background)'
    },
    formWrap: { marginTop: 22, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 },
    glabel: { fontFamily: 'monospace', fontSize: 10.5, letterSpacing: '0.16em', color: 'var(--theia-focusBorder)', textTransform: 'uppercase', marginBottom: 10 },
    checks: { display: 'flex', flexDirection: 'column', gap: 8 },
    pills: { display: 'flex', flexWrap: 'wrap', gap: 8 },

    // 展開フォームを畳む唯一の導線「← ダッシュボードに戻る」。
    backLink: {
        display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16, padding: 0,
        background: 'transparent', border: 'none', color: 'var(--theia-descriptionForeground)',
        fontSize: 12.5, cursor: 'pointer', minHeight: 'auto', height: 'auto'
    },
    reviewNotice: {
        marginBottom: 16, padding: '9px 13px', borderRadius: 9, fontSize: 12.5,
        border: '1px solid var(--theia-widget-border)', background: 'var(--theia-editorWidget-background)',
        color: 'var(--theia-descriptionForeground)'
    },

    // 更新ホームバナー（U2 v0・D5 裁定）。新版がある時だけ出る・常時領域を専有しない。
    updateBanner: {
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, padding: '11px 16px',
        borderRadius: 10, border: '1px solid var(--theia-focusBorder)',
        background: 'var(--theia-editorWidget-background)'
    },
    updateBannerIcon: { fontSize: 16, color: 'var(--theia-focusBorder)', flex: '0 0 auto' },
    updateBannerText: { fontSize: 13, flex: '1 1 auto' },
    updateBannerActions: { display: 'flex', gap: 8, flex: '0 0 auto' },
    updateBannerButton: {
        fontSize: 12, padding: '6px 12px', borderRadius: 8, minHeight: 'auto', height: 'auto'
    },

    // D&D 復活: dragover 中だけ面全体に重なるオーバーレイ（静的レイアウトには何も足さない）。
    dropOverlay: {
        position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
        background: 'var(--theia-list-dropBackground, rgba(127,127,127,0.12))',
        border: '2px dashed var(--theia-focusBorder)', borderRadius: 8,
        color: 'var(--theia-editorWidget-foreground)'
    },

    // F11 ウェルカム面（状態 0・task 2026-08-05-welcome-screen）。見た目の正は
    // shell-home-mock.html の `.w-card` 系（幅 min(480px,92%) の中央カード）。
    welcomeSurface: {
        height: '100%', overflow: 'auto', padding: '18px 22px', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
    },
    welcomeStack: { width: 'min(480px, 92%)', display: 'flex', flexDirection: 'column', gap: 14 },
    welcomeCard: {
        width: '100%', boxSizing: 'border-box', padding: '28px 28px 22px', borderRadius: 14,
        border: '1px solid var(--theia-widget-border)', background: 'var(--theia-editorWidget-background)',
        display: 'flex', flexDirection: 'column', alignItems: 'stretch'
    },
    welcomeLogo: { fontSize: 22, fontWeight: 800, textAlign: 'center', marginBottom: 4 },
    welcomeSub: { color: 'var(--theia-descriptionForeground)', fontSize: 13, textAlign: 'center', marginBottom: 20 },
    welcomeNewButton: {
        width: '100%', padding: '13px', borderRadius: 9, fontSize: 15, fontWeight: 800,
        minHeight: 'auto', height: 'auto', marginBottom: 16
    },
    welcomeListHeading: {
        fontFamily: 'monospace', fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'var(--theia-descriptionForeground)', margin: '0 0 8px'
    },
    welcomeList: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 4 },
    welcomeProjectItem: {
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px', borderRadius: 8,
        fontSize: 13, minHeight: 'auto', height: 'auto', width: '100%',
        border: '1px solid var(--theia-widget-border)', background: 'var(--theia-editorWidget-background)',
        color: 'var(--theia-editorWidget-foreground)', cursor: 'pointer', textAlign: 'left'
    },
    welcomeProjectBadge: {
        marginLeft: 'auto', flex: '0 0 auto', fontSize: 10.5, padding: '2px 9px', borderRadius: 999,
        border: '1px solid var(--theia-widget-border)', color: 'var(--theia-descriptionForeground)',
        background: 'var(--theia-editorWidget-background)'
    },
    welcomeOpenFolder: {
        display: 'block', margin: '14px auto 0', background: 'transparent', border: 'none',
        color: 'var(--theia-descriptionForeground)', fontSize: 12, cursor: 'pointer',
        textDecoration: 'underline', padding: 0, minHeight: 'auto', height: 'auto'
    }
};

function homeFlowCheckStyle(checked: boolean): React.CSSProperties {
    return {
        display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 13px', borderRadius: 11,
        background: checked ? 'var(--theia-list-activeSelectionBackground)' : 'var(--theia-editorWidget-background)',
        border: `1px solid ${checked ? 'var(--theia-focusBorder)' : 'var(--theia-widget-border)'}`, cursor: 'pointer'
    };
}

function homeFlowPillStyle(selected: boolean): React.CSSProperties {
    return {
        position: 'relative', display: 'inline-block', padding: '7px 15px', borderRadius: 999, fontSize: 12.5,
        border: `1px solid ${selected ? 'var(--theia-focusBorder)' : 'var(--theia-widget-border)'}`,
        background: selected ? 'var(--theia-list-activeSelectionBackground)' : 'var(--theia-editorWidget-background)',
        cursor: 'pointer'
    };
}
