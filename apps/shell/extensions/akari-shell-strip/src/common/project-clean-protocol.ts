/**
 * 「不要なデータを整理」（プロジェクトの片付け）の JSON-RPC 契約。
 *
 * 分類の正典は本拡張ではなく **`packages/akari-launcher` の `akari clean`**
 * （`clean-manifest.mjs` の宣言表）である。ここは CLI を `--json` で呼んで
 * 結果を運ぶだけで、何が使い捨てかを二重に定義しない — 掃除の方針が 2 か所に
 * 割れると、片方だけ直したときに「GUI では消えるが CLI では残る」が生まれる。
 *
 * 書き出しダイアログの「削除する」とは対象が違う。あちらは *中止したその回* の
 * 作業ディレクトリ（プロセスが死んだと分かっているもの）を即時に消す。
 * こちらはプロジェクト全体を宣言表で分類し、直近 1 時間に触られたものは
 * 「実行中の可能性」として保留する（CLI の RECENT_GUARD_MS）。
 */

export const AKARI_PROJECT_CLEAN_SERVICE_PATH = '/services/akari-project-clean';
export const AkariProjectCleanService = Symbol('AkariProjectCleanService');

/** `akari clean --json` の 1 エントリ（CLI の出力そのまま・寛容に読む）。 */
export interface ProjectCleanEntry {
    readonly path: string;
    readonly reason: string;
    readonly files: number;
    readonly bytes: number;
    /** undecided のとき、保留した理由（例 '実行中の可能性'）。 */
    readonly heldReason?: string;
}

export interface ProjectCleanInspection {
    /** 消してよいもの。 */
    readonly disposable: readonly ProjectCleanEntry[];
    /** 分類できず保留したもの（実行中の可能性・宣言表に無い）。消さない。 */
    readonly undecided: readonly ProjectCleanEntry[];
    readonly disposableBytes: number;
    readonly undecidedBytes: number;
}

/**
 * 判別可能ユニオンにはしない。この拡張の tsconfig は `strict: false`
 * （= strictNullChecks なし）で、boolean リテラルの判別子による絞り込みが効かないため
 * `revealArtifact` / `copyArtifact` と同じ「成否 + 任意フィールド」の形に揃える。
 */
export interface ProjectCleanInspectResult {
    readonly ok: boolean;
    /** ok のときの分類結果。 */
    readonly inspection?: ProjectCleanInspection;
    /** ok でないときの理由。 */
    readonly reason?: string;
}

export interface ProjectCleanRunResult {
    readonly cleaned: boolean;
    /** 消せたバイト数（cleaned のとき）。 */
    readonly bytes?: number;
    /** 消せた件数（cleaned のとき）。 */
    readonly count?: number;
    readonly reason?: string;
}

export interface AkariProjectCleanService {
    /** 消さずに分類だけする（`akari clean --json --dry-run`）。 */
    inspect(projectRootUri: string): Promise<ProjectCleanInspectResult>;
    /** 使い捨てと分類されたものだけを消す（`akari clean --json --yes`）。 */
    clean(projectRootUri: string): Promise<ProjectCleanRunResult>;
}
