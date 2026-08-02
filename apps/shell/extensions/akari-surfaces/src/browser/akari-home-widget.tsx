import * as React from '@theia/core/shared/react';
import { Message } from '@theia/core/shared/@lumino/messaging';
import URI from '@theia/core/lib/common/uri';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { WidgetManager } from '@theia/core/lib/browser';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { ApplicationServer } from '@theia/core/lib/common/application-protocol';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
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
import { DEFAULT_UPDATE_FEED_URL, UpdateCache, UpdateStatus, evaluateUpdateStatus, formatHomeBannerText, parseUpdateCache, withDismissedVersion } from '../common/update-feed';

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
const CREATOR_ROOT_MISSING_NOTICE = '作業場はまだありません — 右の相棒に頼むか、ターミナルで `akari` を実行すると作れます。';

interface CreatorRootProjectEntry {
    name: string;
    channel: string;
    uri: URI;
}

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

    @inject(ApplicationServer)
    protected readonly applicationServer: ApplicationServer;

    @inject(EnvVariablesServer)
    protected readonly envVariables: EnvVariablesServer;

    protected watching = false;

    // --- D&D 復活: 素材の取り込み（v3 home dropzone から再利用） ---
    protected importing = false;
    protected importedNotice: string | undefined;
    protected dragActive = false;

    // --- ホーム v4: 過去プロジェクト一覧（裁定 R3） ---
    protected creatorRootAvailable = false;
    protected creatorRootProjects: CreatorRootProjectEntry[] = [];

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
        await this.loadHomeFlow();
        await this.loadCreatorRootProjects();
        // 更新チェック（契約の起動非ブロック原則）: キャッシュの読み比較は待つが
        // （ローカル I/O のみ・十分高速）、バックグラウンド fetch はここで await しない
        // （loadUpdateStatus 内で fire-and-forget にしてある）。
        await this.loadUpdateStatus();
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
     * ホームが再表示されるたびに接続状態・過去プロジェクト一覧を読み直す。
     * アプリ単位マーカーや作業場のプロジェクト一覧は watch していない（v0）ため、
     * 他のタブから戻ってきたときに取り残されないようにするのはこの経路。
     */
    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        void this.refreshHomeFlow();
        void this.loadCreatorRootProjects();
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
        const intake = await this.readIntake();
        this.intakeSnapshot = intake;
        this.intakeStatus = intake.status;
        this.update();
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
            this.update();
            return;
        }
        this.creatorRootAvailable = true;
        this.creatorRootProjects = await this.listCreatorRootProjects(rootUri);
        this.update();
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
        this.updateStatus = evaluateUpdateStatus(currentVersion, this.updateRawCache);
        this.update();
        void this.triggerUpdateBackgroundFetch();
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
            this.updateStatus = evaluateUpdateStatus(appInfo?.version ?? '0.0.0', next);
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

    /** 「リリースページを開く」: notes_url を外部ブラウザで開く（Theia 内部では開かない）。 */
    protected openReleaseNotes = (): void => {
        if (this.updateStatus.notesUrl) {
            this.windowService.openNewWindow(this.updateStatus.notesUrl);
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
     */
    protected override render(): React.ReactNode {
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
                {this.renderPastProjects()}
                {!this.connected && this.renderConnectCard()}
                {this.intakeFormOpen && this.renderIntakeForm()}
                {this.dragActive && this.renderDropOverlay()}
            </div>
        );
    }

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
     * 更新ホームバナー（D5 裁定・task.md 指示）。新版がある時だけ出す。常時領域を専有しない。
     * アクション 2 つ: リリースページを開く（外部ブラウザ） / 今回はスキップ（dismissed 記録）。
     */
    protected renderUpdateBanner(): React.ReactNode {
        return (
            <div role='status' style={homeFlowStyles.updateBanner}>
                <span className='codicon codicon-arrow-circle-up' aria-hidden='true' style={homeFlowStyles.updateBannerIcon} />
                <span style={homeFlowStyles.updateBannerText}>{formatHomeBannerText(this.updateStatus)}</span>
                <div style={homeFlowStyles.updateBannerActions}>
                    <button type='button' className='theia-button secondary' style={homeFlowStyles.updateBannerButton} onClick={this.openReleaseNotes}>
                        リリースページを開く
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
            </header>
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
     * 過去プロジェクト一覧（裁定 R3・2026-08-02）。作業場（creator-root）が
     * 解決できた場合だけ列挙し、クリックでそのプロジェクトをワークスペースとして
     * 開く。無ければ一覧を出さず 1 行の案内にフォールバックする（作成は促すが、
     * 作成 UI 自体はホームに足さない — 作成は相棒 / `akari` CLI に委ねる）。
     */
    protected renderPastProjects(): React.ReactNode {
        if (!this.creatorRootAvailable) {
            return (
                <section style={homeFlowStyles.card}>
                    <div style={homeFlowStyles.cardBody}>
                        <p style={homeFlowStyles.cardLead}>{CREATOR_ROOT_MISSING_NOTICE}</p>
                    </div>
                </section>
            );
        }
        if (this.creatorRootProjects.length === 0) {
            return (
                <section style={homeFlowStyles.card}>
                    <div style={homeFlowStyles.cardBody}>
                        <strong style={homeFlowStyles.cardTitle}>過去プロジェクト</strong>
                        <p style={homeFlowStyles.cardLead}>まだプロジェクトがありません。</p>
                    </div>
                </section>
            );
        }
        return (
            <section style={{ marginBottom: 16 }}>
                <p style={homeFlowStyles.glabel}>過去プロジェクト</p>
                <div style={homeFlowStyles.projectList}>
                    {this.creatorRootProjects.map(project => (
                        <button
                            key={project.uri.toString()}
                            type='button'
                            className='theia-button secondary'
                            style={homeFlowStyles.projectItem}
                            onClick={() => this.openCreatorRootProject(project.uri)}
                        >
                            <span className='codicon codicon-folder' aria-hidden='true' style={homeFlowStyles.chipIcon} />
                            <span style={homeFlowStyles.projectItemBody}>
                                <strong style={homeFlowStyles.projectItemName}>{project.name}</strong>
                                <small style={homeFlowStyles.projectItemChannel}>{project.channel}</small>
                            </span>
                        </button>
                    ))}
                </div>
            </section>
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

    // 過去プロジェクト一覧（裁定 R3）。
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
