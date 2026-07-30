import * as React from '@theia/core/shared/react';
import { Message } from '@theia/core/shared/@lumino/messaging';
import URI from '@theia/core/lib/common/uri';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { OpenerService, WidgetManager, open } from '@theia/core/lib/browser';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { ApplicationServer } from '@theia/core/lib/common/application-protocol';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileDialogService } from '@theia/filesystem/lib/browser';
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

// ホーム v3（裁定 R3+R4+R5・2026-07-30）: 画面は dashboard 1 枚だけ。
// v2 の 4 状態（01 gate → 02 starters → 03 intake → 04 workspace）という
// state machine は廃止した — 工程はエージェント + ファイル（intake.json /
// edit.json）が持ち、シェルは「今の状態を映すサーフェス」に徹する。
// 接続案内・進め方案内はロックではなくカードとして dashboard に重なる。
type QuickActionId = 'assets' | 'template' | 'reference' | 'consult';

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

interface WorkflowStage {
    id: string;
    label: string;
    status: string;
    nextAction: string;
}

interface WorkflowRole {
    path: string;
    label: string;
    kind: string;
}

interface EntryCard {
    id: string;
    label: string;
    hint: string;
    icon: string;
    open: () => Promise<void>;
}

/**
 * intake.json（方向性の SSOT）を読んだ結果。進め方カードのサマリ表示と
 * フォームのプリフィルの両方がこの 1 経路を通る（パースを二重に持たない）。
 */
interface IntakeSnapshot {
    status: 'absent' | 'draft' | 'submitted';
    tasks: IntakeTaskId[];
    duration: IntakeDurationChoice;
    autonomy: IntakeAutonomy;
    taste: string | null;
}

/** ドロップ／ダイアログで取り込める素材の拡張子。動画と写真のみ（音声・その他は対象外）。 */
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.gif', '.tiff', '.bmp'];
const IMPORTABLE_EXTENSIONS = [...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS];

// workflow.json の roles に該当 kind が無いときの既定パス。
const DEFAULT_ASSETS_ROLE_PATH = 'assets';
const DEFAULT_PLANNING_ROLE_PATH = 'planning';
const DEFAULT_EXPORTS_ROLE_PATH = 'exports';

const OPEN_TIMELINE_COMMAND = 'akari.annotations.open';

@injectable()
export class AkariHomeWidget extends ReactWidget {
    static readonly ID = 'akari-home-widget';

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(FileDialogService)
    protected readonly fileDialogs: FileDialogService;

    @inject(CommandService)
    protected readonly commands: CommandService;

    @inject(MessageService)
    protected readonly messages: MessageService;

    @inject(OpenerService)
    protected readonly openerService: OpenerService;

    @inject(WidgetManager)
    protected readonly widgets: WidgetManager;

    @inject(WindowService)
    protected readonly windowService: WindowService;

    @inject(ApplicationServer)
    protected readonly applicationServer: ApplicationServer;

    @inject(EnvVariablesServer)
    protected readonly envVariables: EnvVariablesServer;

    protected stages: WorkflowStage[] = [];
    protected guide = 'プロジェクトを開くと、ここに進み具合と次の一手が表示されます。';
    protected workflowUri: URI | undefined;
    protected watching = false;

    protected projectRoot: URI | undefined;
    protected assetsRolePath = DEFAULT_ASSETS_ROLE_PATH;
    protected planningRolePath = DEFAULT_PLANNING_ROLE_PATH;
    protected exportsRolePath = DEFAULT_EXPORTS_ROLE_PATH;

    protected hasAssets = false;
    protected entryCards: EntryCard[] = [];
    protected importing = false;
    protected importedNotice: string | undefined;
    protected dragActive = false;

    // --- ホーム v3: 接続案内カード / 進め方カード + 展開フォーム ---
    protected connectionsUri: URI | undefined;
    protected intakeUri: URI | undefined;
    protected connected = false;
    protected intakeStatus: 'absent' | 'draft' | 'submitted' = 'absent';
    protected intakeSnapshot: IntakeSnapshot | undefined;
    protected connecting = false;

    protected referenceProjectPath: string | undefined;

    // 進め方フォームを dashboard 内の展開セクションとして開いているか。
    // 画面の切り替えではなく「開いている / 畳んでいる」だけの純粋な UI 状態で、
    // 工程の状態は一切表さない（工程の SSOT は intake.json のまま）。
    protected intakeFormOpen = false;
    // プリフィル時に intake.json から読んだ target.taste の生値。フォーム自体に
    // taste の編集 UI は無い（reference 選択でのみ入る）ため、見直し中に
    // referenceProjectPath を選び直さなければこの値を再送信時にそのまま使う
    // （そうしないとアプリ再起動後の見直しで taste が消えてしまう）。
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
        await this.loadWorkflow();
        await this.loadHomeFlow();
        // 更新チェック（契約の起動非ブロック原則）: キャッシュの読み比較は待つが
        // （ローカル I/O のみ・十分高速）、バックグラウンド fetch はここで await しない
        // （loadUpdateStatus 内で fire-and-forget にしてある）。
        await this.loadUpdateStatus();
        if (this.watching) {
            return;
        }
        this.watching = true;
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            if (this.workflowUri && event.contains(this.workflowUri)) {
                void this.loadWorkflow();
            } else if (this.overviewWatchTargets().some(uri => event.contains(uri))) {
                void this.refreshOverview();
            } else if (
                (this.connectionsUri && event.contains(this.connectionsUri)) ||
                (this.intakeUri && event.contains(this.intakeUri))
            ) {
                void this.refreshHomeFlow();
            }
        }));
        if (this.workflowUri) {
            try {
                this.toDispose.push(await this.fileService.watch(this.workflowUri.parent));
            } catch {
                try {
                    // `.akari` がまだ無い空プロジェクトではルートを監視し、
                    // workflow.json が後から作られた時にも追従する。
                    this.toDispose.push(await this.fileService.watch(this.workflowUri.parent.parent));
                } catch (error) {
                    console.info('[akari-surfaces] workflow watch unavailable:', error);
                }
            }
        }
        for (const target of this.overviewWatchTargets()) {
            try {
                this.toDispose.push(await this.fileService.watch(target));
            } catch (error) {
                console.info('[akari-surfaces] overview watch unavailable:', error);
            }
        }
    }

    /**
     * ホームが再表示されるたびに接続状態を読み直す。アプリ単位マーカーは
     * watch していない（v0）ため、他のタブから戻ってきたときにゲートが
     * 取り残されないようにするのはこの経路。
     */
    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        void this.refreshHomeFlow();
    }

    protected overviewWatchTargets(): URI[] {
        if (!this.projectRoot) {
            return [];
        }
        const root = this.projectRoot;
        return [
            root.resolve(this.assetsRolePath),
            root.resolve(this.planningRolePath),
            root.resolve(this.exportsRolePath)
        ];
    }

    protected async loadWorkflow(): Promise<void> {
        const roots = await this.workspaceService.roots;
        const root = roots[0]?.resource;
        this.projectRoot = root;
        if (!root) {
            this.stages = [];
            this.guide = 'プロジェクトを開くと、ここに進み具合と次の一手が表示されます。';
            this.hasAssets = false;
            this.entryCards = [];
            this.update();
            return;
        }
        this.workflowUri = root.resolve('.akari/workflow.json');
        let roles: WorkflowRole[] = [];
        try {
            const content = await this.fileService.readFile(this.workflowUri);
            const parsed = JSON.parse(content.value.toString());
            this.stages = this.normalizeStages(parsed);
            roles = this.normalizeRoles(parsed);
            this.guide = this.stages.length === 0
                ? 'workflow.json にステージを追加すると、プロジェクト全体をここホームで見渡せます。'
                : '';
        } catch (error) {
            this.stages = [];
            this.guide = '進行データをまだ読めません。.akari/workflow.json を作成または修復すると自動で更新されます。';
            console.info('[akari-surfaces] workflow empty or invalid:', error);
        }
        // フォルダ名 "assets" 等のハードコードは workflow.json に role が無いときの fallback に留める。
        this.assetsRolePath = this.roleForKind(roles, 'assets') ?? DEFAULT_ASSETS_ROLE_PATH;
        this.planningRolePath = this.roleForKind(roles, 'planning') ?? DEFAULT_PLANNING_ROLE_PATH;
        this.exportsRolePath = this.roleForKind(roles, 'exports') ?? DEFAULT_EXPORTS_ROLE_PATH;
        await this.refreshOverview();
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
     * 経路で進め方カードの表示（案内 ⇄ サマリ）が追随する（裁定 R5）。
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
     * 開いても、一度つないだアプリなら 02 以降から始まる）。
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
     * intake.json を読んで進め方カード / フォームが使う値まで正規化する。
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

    // --- 更新チェック（U2 v0）: 状態読み込み・バックグラウンド fetch・アクション ---

    /**
     * ホームディレクトリ側の AKARI 共有ディレクトリを解決する。`AKARI_HOME` が
     * 設定されていればそれ自体をルートとし（CLI 側 `resolveAkariHome` と同じ規約）、
     * 無ければホームディレクトリ配下の `.akari/` を使う。更新キャッシュとパートナー
     * 接続マーカーはどちらもこの直下に置かれる。
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
     * クイックアクション（裁定 R4）。v2 の「はじめかた 4 択」から**ステージ性を
     * 剥奪**したもので、動作は当時と同一（定型プロンプト送信 / assets はピッカー /
     * reference はフォルダ選択）だが**画面遷移を一切しない**。
     */
    protected async runQuickAction(id: QuickActionId): Promise<void> {
        switch (id) {
            case 'assets':
                void this.pickFiles();
                void this.commands.executeCommand(SEND_TO_PARTNER_COMMAND, '素材から始めます。取り込んだ素材の分析をお願いします。');
                break;
            case 'template':
                void this.commands.executeCommand(SEND_TO_PARTNER_COMMAND, 'テンプレートから始めたいです。候補を見せてください。');
                break;
            case 'reference':
                await this.pickReferenceProject();
                break;
            case 'consult':
                void this.commands.executeCommand(SEND_TO_PARTNER_COMMAND, 'まだ何も決まっていません。相談しながら方向性を決めたいです。');
                break;
            default:
                break;
        }
    }

    /**
     * 「過去のプロジェクトを参考に」v0 = 参照パス渡しのみ（オーナー裁定
     * 2026-07-21 §8-4）。スタイル学習連携は別契約のスコープ外。
     */
    protected async pickReferenceProject(): Promise<void> {
        const selection = await this.fileDialogs.showOpenDialog({
            title: '参考にするプロジェクトのフォルダを選ぶ',
            openLabel: 'これを参考にする',
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false
        });
        const uri = Array.isArray(selection) ? selection[0] : selection;
        if (!uri) {
            return;
        }
        this.referenceProjectPath = uri.path.toString();
        this.update();
        void this.commands.executeCommand(
            SEND_TO_PARTNER_COMMAND,
            `過去のプロジェクト「${this.referenceProjectPath}」と同じ雰囲気・同じ流れで進めたいです（参照パス渡しのみ、v0）。`
        );
    }

    /**
     * 進め方フォームを dashboard 内の展開セクションとして開く（裁定 R5）。
     * 「進め方を決める」（absent / draft）と「進め方を見直す」（submitted）は
     * どちらもこの 1 ハンドラで、intake.json が読めればその内容をプリフィルする
     * — ファイルが SSOT なので、エージェントが書いた draft もそのまま
     * 編集の出発点になる。
     *
     * submitted 済みなのに読めなかったときだけ開かずにエラーを出す
     * （空フォームからの送信で既存の内容を失わせないため）。
     */
    protected openIntakeForm = async (): Promise<void> => {
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
     * フォームを畳む唯一の導線（「ダッシュボードに戻る」）。v2 の 02 へ戻す
     * ラベルは廃止した — 戻り先は dashboard の 1 種類だけで、どこへ着地するかが
     * 状態次第で変わることはもう無い（F3 の構造的解消）。
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
        // 見直しで reference を選び直していなければ、元の intake.json の
        // taste をそのまま維持する（無ければ null のまま）。
        const taste = this.referenceProjectPath
            ? `参考プロジェクト: ${this.referenceProjectPath}`
            : this.intakeReviewTaste;
        const target = {
            ...durationChoiceToTarget(this.intakeDuration),
            taste
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

    protected async refreshOverview(): Promise<void> {
        const root = this.projectRoot;
        if (!root) {
            this.hasAssets = false;
            this.entryCards = [];
            this.update();
            return;
        }
        this.hasAssets = await this.directoryHasVisibleFiles(root.resolve(this.assetsRolePath));

        const cards: EntryCard[] = [];
        const latestReport = await this.findLatestFile(root.resolve(this.planningRolePath), ['.md', '.html']);
        if (latestReport) {
            cards.push({
                id: 'report',
                label: '最新のレポートを開く',
                hint: latestReport.path.base,
                icon: 'codicon-preview',
                open: () => open(this.openerService, latestReport, { mode: 'activate' }).then(() => undefined)
            });
        }
        const latestExport = await this.findLatestFile(root.resolve(this.exportsRolePath), ['.mp4']);
        if (latestExport) {
            cards.push({
                id: 'export',
                label: '最新の書き出しを開く',
                hint: latestExport.path.base,
                icon: 'codicon-file-media',
                open: () => open(this.openerService, latestExport, { mode: 'activate' }).then(() => undefined)
            });
        }
        if (this.hasAssets) {
            cards.push({
                id: 'timeline',
                label: 'タイムラインを開く',
                hint: '注釈・テロップを編集',
                icon: 'codicon-list-tree',
                open: () => this.commands.executeCommand(OPEN_TIMELINE_COMMAND).then(() => undefined)
            });
        }
        this.entryCards = cards;
        this.update();
    }

    protected normalizeStages(workflow: any): WorkflowStage[] {
        const source = workflow?.stages ?? workflow?.steps ?? workflow?.workflow ?? [];
        const entries: Array<[string, any]> = Array.isArray(source)
            ? source.map((value: any, index: number) => [String(value?.id ?? index + 1), value])
            : source && typeof source === 'object'
                ? Object.entries(source)
                : [];
        return entries.map(([id, value]) => {
            const item = value && typeof value === 'object' ? value : { status: value };
            return {
                id,
                label: String(item.label ?? item.name ?? item.title ?? id),
                status: String(item.status ?? item.state ?? '未着手'),
                nextAction: String(item.nextAction ?? item.next_action ?? item.action ?? item.next ?? '次の一手を確認')
            };
        });
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

    protected async directoryHasVisibleFiles(uri: URI): Promise<boolean> {
        try {
            const stat = await this.fileService.resolve(uri);
            return !!stat.children?.some(child => !child.isDirectory && this.isVisibleEntry(child.name));
        } catch {
            return false;
        }
    }

    protected async findLatestFile(uri: URI, extensions: string[]): Promise<URI | undefined> {
        try {
            const stat = await this.fileService.resolve(uri, { resolveMetadata: true });
            const candidates = (stat.children ?? [])
                .filter(child => !child.isDirectory && this.isVisibleEntry(child.name) && extensions.includes(this.extensionOf(child.name)));
            if (!candidates.length) {
                return undefined;
            }
            candidates.sort((left, right) => (right.mtime ?? 0) - (left.mtime ?? 0));
            return candidates[0].resource;
        } catch {
            return undefined;
        }
    }

    protected isVisibleEntry(name: string): boolean {
        return name !== '.gitkeep' && !name.startsWith('.');
    }

    protected extensionOf(name: string): string {
        const match = name.match(/\.[^./\\]+$/);
        return match ? match[0].toLowerCase() : '';
    }

    protected statusColor(status: string): string {
        if (/完了|done|complete/i.test(status)) {
            return 'var(--theia-charts-green)';
        }
        if (/進行|作業|active|doing|progress/i.test(status)) {
            // 青全廃（v2 T1）: charts-blue ではなく AKARI アクセントのオレンジを使う。
            return 'var(--theia-charts-orange)';
        }
        if (/停止|blocked|error|失敗/i.test(status)) {
            return 'var(--theia-charts-red)';
        }
        return 'var(--theia-descriptionForeground)';
    }

    // --- 素材の取り込み（プラスボタン / ドラッグ＆ドロップ、どちらも実コピー） ---

    protected async pickFiles(): Promise<void> {
        if (this.importing) {
            return;
        }
        const root = this.projectRoot;
        if (!root) {
            this.messages.warn('先にプロジェクトを開いてください。');
            return;
        }
        const selection = await this.fileDialogs.showOpenDialog({
            title: '取り込む動画・写真を選ぶ',
            openLabel: '取り込む',
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            filters: { '動画・写真': IMPORTABLE_EXTENSIONS.map(extension => extension.slice(1)) }
        });
        if (!selection) {
            return;
        }
        const uris = Array.isArray(selection) ? selection : [selection];
        await this.importSources(uris, root);
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

    protected handleDrop = (event: React.DragEvent): void => {
        if (!this.hasImportableDrag(event.dataTransfer)) {
            return;
        }
        // ここに来たドロップはこのドロップゾーンが引き取る
        // （akari-project 側のグローバルなドロップ処理は data-akari-dropzone を見て道を譲る）。
        event.preventDefault();
        event.stopPropagation();
        this.dragActive = false;
        const sources = this.resolveDroppedSources(event.dataTransfer);
        if (!sources.length) {
            this.messages.warn('動画または写真のファイルをドロップしてください。');
            this.update();
            return;
        }
        const root = this.projectRoot;
        if (!root) {
            this.messages.warn('先にプロジェクトを開いてください。');
            this.update();
            return;
        }
        void this.importSources(sources, root);
    };

    protected handleDropzoneKeyDown = (event: React.KeyboardEvent): void => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void this.pickFiles();
        }
    };

    protected hasImportableDrag(transfer: DataTransfer | null): boolean {
        return !!transfer && (transfer.types.includes('Files') || transfer.types.includes('text/uri-list'));
    }

    /**
     * ドロップされた実ファイルの絶対パスを解決する。Electron の preload ブリッジ
     * （`electronTheiaCore.getPathForFile`）を優先し、無い環境では `File#path` に
     * フォールバックする（akari-project の動画ドロップ実装と同じ経路）。
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
        const assetsUri = root.resolve(this.assetsRolePath);
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
        await this.refreshOverview();
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

    // --- レンダリング ---

    /**
     * ホーム v3: 分岐なしで常に dashboard 1 枚を描く（裁定 R3）。
     * 上から (a) 接続案内カード（未接続時のみ） (b) 進め方カード（+ 展開フォーム）
     * (c) クイックアクション列 (d) 素材 / エントリカード群。
     * `data-akari-home-stage` は state machine 廃止に伴い `"dashboard"` 固定
     * （属性自体は既存 evidence / 検証スクリプトの掴みどころとして残す）。
     */
    protected override render(): React.ReactNode {
        return (
            <div className='akari-home-surface' data-akari-home-stage='dashboard' style={{ height: '100%', overflow: 'auto', padding: '18px 22px', boxSizing: 'border-box' }}>
                {this.renderDashboardHeader()}
                {this.updateStatus.available && this.renderUpdateBanner()}
                {!this.connected && this.renderConnectCard()}
                {this.renderIntakeCard()}
                {this.intakeFormOpen && this.renderIntakeForm()}
                {this.renderQuickActions()}
                {this.hasAssets ? this.renderProjectOverview() : this.renderDropzone('hero')}
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
            <header style={{ marginBottom: 14, display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <h1 style={{ margin: 0, fontSize: 21 }}>ホーム</h1>
                <p style={{ margin: 0, fontSize: 12.5, opacity: 0.7 }}>いまどこにいて、次に何をするかを一望できます。</p>
            </header>
        );
    }

    /**
     * 接続案内カード（裁定 R6）。未接続のときだけ dashboard 最上部に出る**案内**で、
     * ゲートではない — このカードの下にある素材取り込み・クイックアクション・
     * 進め方フォームはすべて未接続のまま操作できる。
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
                        素材の取り込みなど下の操作は、つなぐ前でも使えます。
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
     * 進め方カード（裁定 R5）。intake.json の状態で 1 枚を出し分ける:
     * 未送信（absent / draft）は「進め方を決める」案内、submitted は現在の設定
     * サマリ + 「進め方を見直す」。どちらもフォームを開く導線であり、ロックではない。
     */
    protected renderIntakeCard(): React.ReactNode {
        const submitted = this.intakeStatus === 'submitted';
        const snapshot = this.intakeSnapshot;
        return (
            <section style={homeFlowStyles.card}>
                <div style={homeFlowStyles.cardMark} aria-hidden='true'>
                    <span className={`codicon ${submitted ? 'codicon-checklist' : 'codicon-compass'}`}
                        style={{ fontSize: 20, color: 'var(--theia-button-foreground)' }} />
                </div>
                <div style={homeFlowStyles.cardBody}>
                    <strong style={homeFlowStyles.cardTitle}>{submitted ? '今回の進め方' : '進め方が未定です'}</strong>
                    {submitted && snapshot ? (
                        <dl style={homeFlowStyles.summaryList}>
                            <div style={homeFlowStyles.summaryItem}>
                                <dt style={homeFlowStyles.summaryKey}>やること</dt>
                                <dd style={homeFlowStyles.summaryValue}>
                                    {snapshot.tasks.length ? snapshot.tasks.map(id => INTAKE_TASK_LABELS[id]).join('、') : '（未選択）'}
                                </dd>
                            </div>
                            <div style={homeFlowStyles.summaryItem}>
                                <dt style={homeFlowStyles.summaryKey}>仕上がりの尺</dt>
                                <dd style={homeFlowStyles.summaryValue}>{INTAKE_DURATION_LABELS[snapshot.duration]}</dd>
                            </div>
                            <div style={homeFlowStyles.summaryItem}>
                                <dt style={homeFlowStyles.summaryKey}>おまかせの度合い</dt>
                                <dd style={homeFlowStyles.summaryValue}>{INTAKE_AUTONOMY_LABELS[snapshot.autonomy]}</dd>
                            </div>
                        </dl>
                    ) : (
                        <p style={homeFlowStyles.cardLead}>
                            やること・尺・おまかせの度合いがパートナーへの指示になります。決めなくても先に進めます。
                        </p>
                    )}
                </div>
                <button
                    type='button'
                    className='theia-button secondary'
                    style={homeFlowStyles.reviewEntry}
                    aria-expanded={this.intakeFormOpen}
                    onClick={() => void this.openIntakeForm()}
                >
                    <span className={`codicon ${submitted ? 'codicon-history' : 'codicon-edit'}`} aria-hidden='true' />
                    {submitted ? ' 進め方を見直す' : ' 進め方を決める'}
                </button>
            </section>
        );
    }

    /**
     * クイックアクション列（裁定 R4）。押しても画面は変わらず、パートナーへ
     * 定型プロンプトが飛ぶ（assets はピッカー / reference はフォルダ選択も同時）。
     * v2 の「どの入り口も最後は進め方フォームに合流します」という合流文言は廃止
     * — 進め方はいつでも決められる 1 サーフェスになったため合流点が無い。
     */
    protected renderQuickActions(): React.ReactNode {
        const actions: Array<{ id: QuickActionId; icon: string; label: string; hint: string }> = [
            {
                id: 'assets', icon: 'codicon-folder-opened', label: '素材から始める',
                hint: '動画・写真を取り込んで、何が撮れているかの分析を依頼する'
            },
            {
                id: 'template', icon: 'codicon-layout', label: 'テンプレートから',
                hint: 'Vlog ダイジェスト / 30 秒 CM など、完成形が決まった型の候補をチャットに出す'
            },
            {
                id: 'reference', icon: 'codicon-history', label: '過去のプロジェクトを参考に',
                hint: '参考にするプロジェクトのフォルダを選んで、同じ雰囲気・同じ流れで進める'
            },
            {
                id: 'consult', icon: 'codicon-comment-discussion', label: '相談しながら決める',
                hint: 'まだ何も決まっていなくて OK。パートナーが質問しながら方向性を固める'
            }
        ];
        return (
            <section style={{ marginBottom: 16 }}>
                <p style={homeFlowStyles.glabel}>クイックアクション — 押してもこの画面のまま</p>
                <div style={homeFlowStyles.chipRow}>
                    {actions.map(action => (
                        <button key={action.id} type='button' style={homeFlowStyles.chip} title={action.hint}
                            onClick={() => void this.runQuickAction(action.id)}>
                            <span className={`codicon ${action.icon}`} style={homeFlowStyles.chipIcon} aria-hidden='true' />
                            {action.label}
                        </button>
                    ))}
                </div>
            </section>
        );
    }

    /**
     * 進め方フォーム（intake サーフェス）。ステージではなく dashboard 内の展開
     * セクションで、畳む導線は「ダッシュボードに戻る」の 1 種類だけ（裁定 R5）。
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

    protected renderProjectOverview(): React.ReactNode {
        return (
            <>
                {this.importedNotice && (
                    <div role='status' style={{
                        marginBottom: 16, padding: '10px 14px', borderRadius: 8,
                        border: '1px solid var(--theia-widget-border)', background: 'var(--theia-editorWidget-background)'
                    }}>
                        {this.importedNotice}
                    </div>
                )}
                {this.stages.length > 0 ? (
                    <div style={{
                        display: 'grid', gridTemplateColumns: `repeat(${Math.min(this.stages.length, 4)}, minmax(190px, 1fr))`,
                        gap: 12, marginBottom: 20
                    }}>
                        {this.stages.map((stage, index) => (
                            <section key={stage.id} style={{
                                border: '1px solid var(--theia-widget-border)', borderRadius: 10,
                                padding: 16, background: 'var(--theia-editorWidget-background)', minHeight: 150
                            }}>
                                <div style={{ opacity: 0.55, fontSize: 12 }}>STAGE {index + 1}</div>
                                <h2 style={{ margin: '8px 0 12px', fontSize: 18 }}>{stage.label}</h2>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 16 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: this.statusColor(stage.status) }} />
                                    <span>{stage.status}</span>
                                </div>
                                <div style={{ borderTop: '1px solid var(--theia-widget-border)', paddingTop: 11 }}>
                                    <div style={{ opacity: 0.55, fontSize: 11, marginBottom: 4 }}>次の一手</div>
                                    <strong>{stage.nextAction}</strong>
                                </div>
                            </section>
                        ))}
                    </div>
                ) : (
                    this.guide && <p style={{ opacity: 0.7, marginBottom: 20 }}>{this.guide}</p>
                )}
                {this.entryCards.length > 0 && (
                    <div style={{
                        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                        gap: 12, marginBottom: 24
                    }}>
                        {this.entryCards.map(card => (
                            <button key={card.id} type='button' className='theia-button secondary'
                                onClick={() => void card.open()}
                                style={{
                                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6,
                                    padding: '14px 16px', borderRadius: 10, textAlign: 'left', height: 'auto'
                                }}>
                                <span className={`codicon ${card.icon}`} aria-hidden='true' style={{ fontSize: 18 }} />
                                <strong>{card.label}</strong>
                                <small style={{ opacity: 0.65, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                                    {card.hint}
                                </small>
                            </button>
                        ))}
                    </div>
                )}
                {this.renderDropzone('inline')}
            </>
        );
    }

    protected renderDropzone(variant: 'hero' | 'inline'): React.ReactNode {
        const isHero = variant === 'hero';
        return (
            <div
                role='button'
                tabIndex={0}
                aria-label='動画や写真を取り込む'
                data-akari-dropzone='true'
                onDragOver={this.handleDragOver}
                onDragLeave={this.handleDragLeave}
                onDrop={this.handleDrop}
                onClick={() => void this.pickFiles()}
                onKeyDown={this.handleDropzoneKeyDown}
                style={{
                    display: 'flex',
                    // v3: hero も「画面いっぱいの入口」ではなく dashboard の一区画になったため、
                    // 縦積み・minHeight 320 をやめて inline と同じ横並びに揃える
                    // （案内カード・クイックアクションと同時に見えることが受け入れ条件）。
                    // hero / inline の差は文言と＋ボタンの大きさだけ。
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    gap: 14,
                    minHeight: isHero ? 84 : 64,
                    padding: isHero ? '16px 18px' : '14px 18px',
                    borderRadius: 14,
                    cursor: 'pointer',
                    border: `2px dashed ${this.dragActive ? 'var(--theia-focusBorder)' : 'var(--theia-widget-border)'}`,
                    background: this.dragActive ? 'var(--theia-list-dropBackground)' : 'var(--theia-editorWidget-background)',
                    textAlign: 'left'
                }}
            >
                <button type='button' className='theia-button' aria-label='ファイルを選ぶ'
                    onClick={event => { event.stopPropagation(); void this.pickFiles(); }}
                    style={{
                        width: isHero ? 46 : 36, height: isHero ? 46 : 36, borderRadius: '50%',
                        fontSize: isHero ? 24 : 18, lineHeight: 1, padding: 0, flex: '0 0 auto'
                    }}>
                    +
                </button>
                <div>
                    {isHero ? (
                        <>
                            <strong style={{ fontSize: 15 }}>ここに動画や写真を入れると始まります</strong>
                            <div style={{ marginTop: 4, opacity: 0.75, fontSize: 12.5 }}>
                                ドラッグ＆ドロップするか、＋ボタンから選んでください。
                            </div>
                        </>
                    ) : (
                        <>
                            <strong>素材を追加</strong>
                            <div style={{ opacity: 0.7, fontSize: 12 }}>ドラッグ＆ドロップ、または＋で選択</div>
                        </>
                    )}
                    {this.importing && <div role='status' style={{ marginTop: 6, fontSize: 12 }}>取り込み中…</div>}
                </div>
            </div>
        );
    }
}

// ホーム v3（dashboard）のスタイル。色は Theia テーマ変数のみ参照する
// （T1 が --theia-* を LP トークン=黒×オレンジへ差し替え済みのため、ここは
// 無変更で追随する。akari-partner-widget.tsx の chatStyles と同じ流儀）。
// v3 で持ち込む新しい語彙は無い — カード / チップはいずれも既存の
// 「1px widget-border + editorWidget-background + focusBorder アクセント」の再構成。
const homeFlowStyles: Record<string, React.CSSProperties> = {
    eyebrow: { fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.18em', color: 'var(--theia-focusBorder)', textTransform: 'uppercase', marginBottom: 10 },
    h2: { fontSize: 22, fontWeight: 800, lineHeight: 1.4, margin: 0 },
    sub: { color: 'var(--theia-descriptionForeground)', fontSize: 13.5, marginTop: 8, maxWidth: '38em' },

    cta: {
        display: 'inline-block', padding: '12px 30px', borderRadius: 10, fontWeight: 700, fontSize: 14.5,
        minHeight: 'auto', height: 'auto'
    },

    // 案内カード（接続 / 進め方）。ロックではないので画面を占有せず 1 枚に収める。
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

    // 進め方カードの現在設定サマリ（submitted 時）。
    summaryList: { margin: '8px 0 0', display: 'flex', flexDirection: 'column', gap: 5 },
    summaryItem: { display: 'flex', gap: 10, alignItems: 'baseline' },
    summaryKey: {
        margin: 0, flex: '0 0 auto', minWidth: '9.5em', whiteSpace: 'nowrap',
        fontFamily: 'monospace', fontSize: 10.5, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: 'var(--theia-focusBorder)'
    },
    summaryValue: { margin: 0, fontSize: 12.5, lineHeight: 1.7 },

    // クイックアクション列（横並びチップ 4 つ）。押しても画面遷移しない。
    chipRow: { display: 'flex', flexWrap: 'wrap', gap: 8 },
    chip: {
        display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 999,
        fontSize: 12.5, fontWeight: 600, minHeight: 'auto', height: 'auto',
        border: '1px solid var(--theia-widget-border)', background: 'var(--theia-editorWidget-background)',
        // 素の <button> は色を継承しないため明示する（未指定だと UA 既定の暗色が黒背景に載る）
        color: 'var(--theia-editorWidget-foreground)', cursor: 'pointer'
    },
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
    // 進め方カードのアクション（「進め方を決める」/「進め方を見直す」）。
    reviewEntry: {
        display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600,
        padding: '8px 14px', borderRadius: 9, minHeight: 'auto', height: 'auto', flex: '0 0 auto',
        whiteSpace: 'nowrap'
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
