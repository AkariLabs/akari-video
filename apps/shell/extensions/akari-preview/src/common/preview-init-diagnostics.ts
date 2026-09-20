/**
 * 出力プレビュー初期化の「どの段で止まったか」を記録・整形する純粋ロジック。
 *
 * 背景（不具合メモ 第11・12項）: 同じ編集が Web 入口（packages/preview-server）では表示できるのに
 * アプリ内の出力プレビューだけが灰色になる事象で、**画面もログも無言**だったため証跡が集まらなかった。
 * `~/.theia/logs` に読めるログが無く、`~/.akari/logs` にも該当ログが無いので、利用者に DevTools
 * （同梱 Theia では Alt+F12）を開かせない限り何も分からない状態だった。
 *
 * ここは原因を判定するモジュールではない。**失敗した段の名前と最初の例外を残す**だけで、
 * 「灰色の原因はこれ」という断定はしない（原因は未確定）。
 *
 * このファイルは意図的に import を持たない。各関数は
 * `akari-preview-open-handler.ts` の webview スクリプトへ `Function.prototype.toString()` で
 * 注入されるため、モジュールスコープの識別子を参照すると webview 側で ReferenceError になる。
 * **どの関数も自己完結（引数とローカル変数だけ）で書くこと。**
 */

export type PreviewInitStageId =
    | 'webview-created'
    | 'model-loaded'
    | 'page-html-set'
    | 'scripts-loaded'
    | 'engine-initialized'
    | 'media-supplied'
    | 'first-frame';

export interface PreviewInitStageDeclaration {
    id: PreviewInitStageId;
    /** 画面とログに出す段の名前。 */
    label: string;
    /** その段を観測する側。host = シェル側、webview = プレビューページ側。 */
    side: 'host' | 'webview';
}

/**
 * 段の順序。前の段が ok にならないまま止まった場合、その段が「止まった段」になる。
 * 段名は画面・ログ・報告のすべてで同じ語を使う（利用者が読み上げられるようにする）。
 */
export const PREVIEW_INIT_STAGES: readonly PreviewInitStageDeclaration[] = [
    { id: 'webview-created', label: 'Webview 生成', side: 'host' },
    { id: 'model-loaded', label: '編集モデル読込', side: 'host' },
    { id: 'page-html-set', label: 'ページ HTML 設定', side: 'host' },
    { id: 'scripts-loaded', label: 'スクリプト読込', side: 'webview' },
    { id: 'engine-initialized', label: 'エンジン初期化', side: 'webview' },
    { id: 'media-supplied', label: 'メディア供給', side: 'webview' },
    { id: 'first-frame', label: '初回描画', side: 'webview' }
];

export type PreviewInitStageStatus = 'pending' | 'ok' | 'failed';

export interface PreviewInitStageState {
    id: PreviewInitStageId;
    label: string;
    side: 'host' | 'webview';
    status: PreviewInitStageStatus;
    /** 記録時刻（ms）。壁時計でも performance.now() でもよい — 相対比較にしか使わない。 */
    at?: number;
    detail?: string;
}

export type PreviewDiagnosticEventKind =
    | 'error'
    | 'rejection'
    | 'stage-failure'
    | 'key-conversion'
    | 'note';

export interface PreviewDiagnosticEvent {
    kind: PreviewDiagnosticEventKind;
    message: string;
    stage?: PreviewInitStageId;
    filename?: string;
    lineno?: number;
    at?: number;
    /** 同一内容が繰り返された回数（第12項のキー変換失敗のような連発を 1 行に畳む）。 */
    count?: number;
}

export interface PreviewInitTrace {
    stages: PreviewInitStageState[];
    events: PreviewDiagnosticEvent[];
    /** 最初に観測した例外（error / rejection / stage-failure のうち最初のもの）。 */
    firstError?: PreviewDiagnosticEvent;
}

/** trace が保持する診断イベントの上限。超えた分は捨てて `truncated` を立てる。 */
export const PREVIEW_DIAGNOSTIC_EVENT_LIMIT = 12;

export interface PreviewInitSummary {
    /** 全段が ok。 */
    complete: boolean;
    /** 明示的に失敗が記録された段（あれば最優先で表示する）。 */
    failedStage?: PreviewInitStageState;
    /** 失敗記録は無いが ok にならないまま止まっている最初の段。 */
    stalledStage?: PreviewInitStageState;
    /** ok になった最後の段。 */
    reachedStage?: PreviewInitStageState;
    firstError?: PreviewDiagnosticEvent;
    stages: PreviewInitStageState[];
    events: PreviewDiagnosticEvent[];
}

export interface PreviewDiagnosticsContext {
    /**
     * 入口の区別（第11項の切り分けの核）。
     * `desktop-webview` = AKARI Video アプリ内の Theia Webview、`web` = ブラウザの Web 入口。
     */
    entry: 'desktop-webview' | 'desktop-host' | 'web';
    /** Console に出るものと同じ Webview widget の id（第12項の「所有者未特定の ID」対策）。 */
    webviewId?: string;
    /** その id の用途（出力プレビュー / 素材プレビュー / 素材サムネ など）。 */
    webviewRole?: string;
    editUri?: string;
    /** frame-engine 面か（true）旧経路か（false）。未確定なら undefined。 */
    frameEngine?: boolean;
    /** 資産・素材配信オリジン（http://127.0.0.1:<port>）。Web 入口と同じサーバーかの照合用。 */
    assetOrigin?: string;
    userAgent?: string;
    appVersion?: string;
    /** ISO 8601 の記録時刻。 */
    at?: string;
}

export function createPreviewInitTrace(
    stages: readonly PreviewInitStageDeclaration[]
): PreviewInitTrace {
    return {
        stages: stages.map(stage => ({
            id: stage.id,
            label: stage.label,
            side: stage.side,
            status: 'pending' as PreviewInitStageStatus
        })),
        events: []
    };
}

/**
 * 段の状態を書き換える。`failed` は同時に stage-failure イベントとしても記録し、
 * 最初の例外（firstError）が未設定ならそこへも入れる。
 */
export function markPreviewInitStage(
    trace: PreviewInitTrace,
    id: PreviewInitStageId,
    status: PreviewInitStageStatus,
    options?: { detail?: string; at?: number }
): PreviewInitTrace {
    const detail = options && options.detail !== undefined ? String(options.detail) : undefined;
    const at = options && typeof options.at === 'number' ? options.at : undefined;
    for (const stage of trace.stages) {
        if (stage.id !== id) continue;
        // 一度 failed を記録した段は、後から来る ok 以外で上書きしない（復帰は ok だけ）。
        if (stage.status === 'failed' && status === 'pending') return trace;
        stage.status = status;
        if (at !== undefined) stage.at = at;
        if (detail !== undefined) stage.detail = detail;
        if (status === 'ok' && stage.detail !== undefined && detail === undefined) {
            stage.detail = undefined;
        }
    }
    if (status === 'failed') {
        const event: PreviewDiagnosticEvent = {
            kind: 'stage-failure',
            stage: id,
            message: detail === undefined || detail === '' ? '段の失敗（詳細なし）' : detail
        };
        if (at !== undefined) event.at = at;
        recordPreviewDiagnosticEvent(trace, event);
    }
    return trace;
}

/**
 * 診断イベントを積む。同一の kind + message は 1 件に畳んで count を増やすので、
 * 第12項のキー変換失敗のような連発でも診断が溢れない。
 */
export function recordPreviewDiagnosticEvent(
    trace: PreviewInitTrace,
    event: PreviewDiagnosticEvent
): PreviewInitTrace {
    const limit = 12; // PREVIEW_DIAGNOSTIC_EVENT_LIMIT — toString() 注入のため値を内に置く
    const message = String(event && event.message !== undefined ? event.message : '')
        .slice(0, 400) || '（メッセージなし）';
    const normalized: PreviewDiagnosticEvent = {
        kind: event && event.kind ? event.kind : 'note',
        message
    };
    if (event && event.stage) normalized.stage = event.stage;
    if (event && event.filename) normalized.filename = String(event.filename).slice(0, 300);
    if (event && typeof event.lineno === 'number' && Number.isFinite(event.lineno)) {
        normalized.lineno = event.lineno;
    }
    if (event && typeof event.at === 'number' && Number.isFinite(event.at)) normalized.at = event.at;
    const existing = trace.events.find(
        candidate => candidate.kind === normalized.kind && candidate.message === normalized.message
    );
    if (existing) {
        existing.count = (existing.count === undefined ? 1 : existing.count) + 1;
        return trace;
    }
    if (trace.events.length < limit) {
        normalized.count = 1;
        trace.events.push(normalized);
    }
    if (
        trace.firstError === undefined
        && (normalized.kind === 'error' || normalized.kind === 'rejection' || normalized.kind === 'stage-failure')
    ) {
        trace.firstError = normalized;
    }
    return trace;
}

export function summarizePreviewInit(trace: PreviewInitTrace): PreviewInitSummary {
    let failedStage: PreviewInitStageState | undefined;
    let stalledStage: PreviewInitStageState | undefined;
    let reachedStage: PreviewInitStageState | undefined;
    let complete = true;
    for (const stage of trace.stages) {
        if (stage.status === 'failed' && failedStage === undefined) failedStage = stage;
        if (stage.status === 'ok') reachedStage = stage;
        if (stage.status !== 'ok') {
            complete = false;
            if (stage.status === 'pending' && stalledStage === undefined) stalledStage = stage;
        }
    }
    const summary: PreviewInitSummary = {
        complete,
        stages: trace.stages,
        events: trace.events
    };
    if (failedStage !== undefined) summary.failedStage = failedStage;
    if (stalledStage !== undefined) summary.stalledStage = stalledStage;
    if (reachedStage !== undefined) summary.reachedStage = reachedStage;
    if (trace.firstError !== undefined) summary.firstError = trace.firstError;
    return summary;
}

/**
 * 画面・ログ・利用者のコピー用に同じ本文を作る。原因を断定する語は入れない
 * （「止まった段」「最初の例外」までを書き、判断は人に残す）。
 */
export function formatPreviewInitReport(
    summary: PreviewInitSummary,
    context: PreviewDiagnosticsContext
): string {
    const stageMark = (status: string) => (status === 'ok' ? '[ok]' : status === 'failed' ? '[NG]' : '[--]');
    const lines: string[] = [];
    lines.push('AKARI Video プレビュー初期化診断');
    lines.push('入口: ' + String(context.entry));
    if (context.at) lines.push('時刻: ' + String(context.at));
    if (context.appVersion) lines.push('アプリ版: ' + String(context.appVersion));
    if (context.webviewId) {
        lines.push(
            'Webview: ' + String(context.webviewId)
            + (context.webviewRole ? '（' + String(context.webviewRole) + '）' : '')
        );
    }
    if (context.editUri) lines.push('対象: ' + String(context.editUri));
    if (context.frameEngine !== undefined) {
        lines.push('描画面: ' + (context.frameEngine ? 'frame-engine' : '旧経路（DOM）'));
    }
    if (context.assetOrigin) lines.push('配信オリジン: ' + String(context.assetOrigin));
    if (context.userAgent) lines.push('UA: ' + String(context.userAgent));
    const blocked = summary.failedStage || summary.stalledStage;
    lines.push(
        summary.complete
            ? '結果: 初期化は全段 ok'
            : '止まった段: ' + (blocked ? blocked.label + '（' + blocked.id + '）' : '不明')
    );
    lines.push('段の状態:');
    for (const stage of summary.stages) {
        lines.push(
            '  ' + stageMark(stage.status) + ' ' + stage.label + ' (' + stage.id + '/' + stage.side + ')'
            + (stage.detail ? ' — ' + String(stage.detail) : '')
        );
    }
    if (summary.firstError) {
        const error = summary.firstError;
        lines.push(
            '最初の例外: [' + error.kind + '] ' + error.message
            + (error.filename ? ' @' + error.filename + (error.lineno ? ':' + error.lineno : '') : '')
        );
    } else {
        lines.push('最初の例外: 記録なし');
    }
    if (summary.events.length > 0) {
        lines.push('診断イベント:');
        for (const event of summary.events) {
            lines.push(
                '  [' + event.kind + ']'
                + (event.count !== undefined && event.count > 1 ? ' x' + event.count : '')
                + ' ' + event.message
                + (event.filename ? ' @' + event.filename + (event.lineno ? ':' + event.lineno : '') : '')
            );
        }
    }
    lines.push('※ これは失敗段の記録であり、原因の断定ではない。');
    return lines.join('\n');
}

/**
 * Webview widget の id から用途を引く（第12項で「所有者未特定の ID」が出たため）。
 * 接頭辞は akari-preview-open-handler.ts / material-preview-slot.ts の id 生成と対応する。
 */
export function describePreviewWebviewRole(widgetId: string): {
    role: 'output' | 'raw' | 'material' | 'unknown';
    label: string;
} {
    const id = typeof widgetId === 'string' ? widgetId : '';
    if (id.indexOf('akari-output-preview-') === 0) return { role: 'output', label: '出力プレビュー' };
    if (id.indexOf('akari-material-preview') === 0) return { role: 'material', label: '素材プレビュー枠' };
    if (id.indexOf('akari-preview-') === 0) return { role: 'raw', label: '素材プレビュー' };
    return { role: 'unknown', label: 'akari-preview 以外（この拡張の所有ではない）' };
}

/**
 * キーイベントを「変換に失敗しても安全に説明できる形」に落とす（第12項）。
 * `Cannot get key code from the keyboard event` の発火条件がログに無かったため、
 * 押されたキー・IME 合成中か・keyCode の有無をここで残す。getter が例外を投げても落ちない。
 */
export function describeKeyEventConversionFailure(
    event: unknown,
    reason?: unknown
): { message: string; key: string; code: string; keyCode: number | null; composing: boolean | null; repeat: boolean | null } {
    const read = (name: string): unknown => {
        try {
            return (event as Record<string, unknown> | null | undefined)?.[name];
        } catch {
            return undefined;
        }
    };
    const asString = (value: unknown): string =>
        typeof value === 'string' && value !== '' ? value : '(なし)';
    const asNumber = (value: unknown): number | null =>
        typeof value === 'number' && Number.isFinite(value) ? value : null;
    const asBoolean = (value: unknown): boolean | null =>
        typeof value === 'boolean' ? value : null;
    const key = asString(read('key'));
    const code = asString(read('code'));
    const keyCode = asNumber(read('keyCode'));
    const composing = asBoolean(read('isComposing'));
    const repeat = asBoolean(read('repeat'));
    let because = '';
    if (reason !== undefined && reason !== null) {
        try {
            because = reason instanceof Error ? reason.message : String(reason);
        } catch {
            because = '(理由の文字列化に失敗)';
        }
    }
    const message = 'キー変換失敗: key=' + key + ' code=' + code
        + ' keyCode=' + (keyCode === null ? '(なし)' : String(keyCode))
        + ' IME合成=' + (composing === null ? '不明' : composing ? 'はい' : 'いいえ')
        + ' 長押し=' + (repeat === null ? '不明' : repeat ? 'はい' : 'いいえ')
        + (because ? ' / ' + because.slice(0, 200) : '');
    return { message, key, code, keyCode, composing, repeat };
}

/**
 * キーイベント処理を「失敗しても例外を伝播させない」形に包む（第12項）。
 * 変換失敗は onFailure へ渡して診断に残すだけで、呼び出し元へは投げ直さない。
 * 監視系のリスナーが本筋のキー操作を壊さないようにするためのもので、
 * @theia/core 側の `Cannot get key code from the keyboard event` 自体を止めるものではない
 * （そちらは app.asar 内のため、ここからは触れない）。
 */
export function guardedKeyHandler<E>(
    handler: (event: E) => void,
    onFailure: (event: E, reason: unknown) => void
): (event: E) => void {
    return (event: E): void => {
        try {
            handler(event);
        } catch (reason) {
            try {
                onFailure(event, reason);
            } catch {
                /* 診断の失敗で本筋を止めない。 */
            }
        }
    };
}

/**
 * Theia の KeyCode 変換が落ちうる「疑わしい」キーイベントの形か。
 * 発火条件がログに無く未確定なので、**候補を広く拾って記録する**ための判定で、
 * これに当たることが変換失敗の証明ではない。
 */
export function isSuspiciousKeyEventShape(event: unknown): boolean {
    const read = (name: string): unknown => {
        try {
            return (event as Record<string, unknown> | null | undefined)?.[name];
        } catch {
            return undefined;
        }
    };
    const key = read('key');
    const code = read('code');
    const keyCode = read('keyCode');
    if (key === 'Unidentified' || key === 'Process') return true;
    if (typeof key !== 'string' || key === '') return true;
    if (read('isComposing') === true) return true;
    // 229 = IME 合成中に Chromium が返す keyCode。0 は「対応する仮想キーなし」。
    if (keyCode === 229 || keyCode === 0) return true;
    if ((typeof code !== 'string' || code === '') && typeof keyCode !== 'number') return true;
    return false;
}

/**
 * 第13項: WebAV 1.2.8（`node_modules/@webav/internal-utils/src/log.ts`）は
 * `"PressureObserver" in globalThis` の存在確認だけで `.observe("cpu")` を呼び、Promise 拒否を
 * 捕捉していない。Webview の権限ポリシーでは compute-pressure が許可されていないため
 * `NotAllowedError` が未処理拒否として Console に出続け、**本当のエラーを探しにくくしていた**。
 *
 * node_modules は編集できないので、バンドル読み込み前にこちら側で存在確認を偽にする。
 * 任意の負荷監視なので、監視なしで継続すれば十分（権限を広げてはいけない）。
 *
 * 戻り値: `absent` = そもそも無い / `removed` = グローバルを削除できた（`in` が偽になる）/
 * `stubbed` = 削除できなかったので拒否しない stub に差し替えた / `failed` = どちらもできなかった。
 */
export function neutralizePressureObserver(
    target: Record<string, unknown>
): 'absent' | 'removed' | 'stubbed' | 'failed' {
    if (!target || !('PressureObserver' in target)) return 'absent';
    try {
        delete target.PressureObserver;
        if (!('PressureObserver' in target)) return 'removed';
    } catch {
        // configurable でないプロパティは削除できない。下の stub 差し替えへ進む。
    }
    try {
        const Stub = function PressureObserverStub(this: unknown): void {
            /* 監視しない。WebAV のログ初期化は戻り値を使わない。 */
        } as unknown as { prototype: Record<string, unknown> };
        Stub.prototype = {
            // 拒否しない Promise を返すのが肝。WebAV は catch を付けていない。
            observe(): Promise<void> {
                return Promise.resolve();
            },
            unobserve(): void { /* no-op */ },
            disconnect(): void { /* no-op */ },
            takeRecords(): unknown[] { return []; }
        };
        target.PressureObserver = Stub;
        return 'stubbed';
    } catch {
        return 'failed';
    }
}

/** 診断ログ 1 行（JSON Lines）の形。`~/.akari/logs/akari-preview-diagnostics.log` へ書く。 */
export interface PreviewDiagnosticsLogEntry {
    at: string;
    entry: PreviewDiagnosticsContext['entry'];
    event: 'webview-registered' | 'stage' | 'report' | 'watchdog' | 'key-conversion' | 'note';
    webviewId?: string;
    webviewRole?: string;
    editUri?: string;
    stage?: PreviewInitStageId;
    status?: PreviewInitStageStatus;
    message?: string;
    frameEngine?: boolean;
    assetOrigin?: string;
    userAgent?: string;
    summary?: {
        complete: boolean;
        failedStage?: PreviewInitStageId;
        stalledStage?: PreviewInitStageId;
        reachedStage?: PreviewInitStageId;
        firstError?: PreviewDiagnosticEvent;
        stages: Array<{ id: PreviewInitStageId; status: PreviewInitStageStatus; detail?: string }>;
        events: PreviewDiagnosticEvent[];
    };
}

export function previewDiagnosticsLogLine(entry: PreviewDiagnosticsLogEntry): string {
    return JSON.stringify(entry);
}

export function summaryForLog(summary: PreviewInitSummary): PreviewDiagnosticsLogEntry['summary'] {
    const compact: PreviewDiagnosticsLogEntry['summary'] = {
        complete: summary.complete,
        stages: summary.stages.map(stage => ({
            id: stage.id,
            status: stage.status,
            ...(stage.detail === undefined ? {} : { detail: stage.detail })
        })),
        events: summary.events
    };
    if (summary.failedStage) compact.failedStage = summary.failedStage.id;
    if (summary.stalledStage) compact.stalledStage = summary.stalledStage.id;
    if (summary.reachedStage) compact.reachedStage = summary.reachedStage.id;
    if (summary.firstError) compact.firstError = summary.firstError;
    return compact;
}
