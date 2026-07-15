import { injectable } from '@theia/core/shared/inversify';
import { FrontendApplication } from '@theia/core/lib/browser';

/**
 * AKARI Video shell — S18(a) 起動フェイルセーフ。
 *
 * PoC 実機確認（契約 §5-bis S18）で判明した不具合: 壊れた保存レイアウト
 * ファイルを読み込むと、Theia core の `restoreLayout()`（内部で try/catch は
 * 既にある — `frontend-application.js` の `restoreLayout()` を実測で確認済み）
 * にもかかわらず白画面のままスタックする事例があった。try/catch はエラーを
 * `false`（＝デフォルトレイアウトへフォールバック）に変換するだけで、
 * 「エラーを投げずに Promise が解決しないまま止まる」ケース（壊れた
 * ストレージ I/O のハング等）はカバーしない。本クラスはそこにタイムアウトを
 * 足す。
 *
 * `FrontendApplication.restoreLayout()` を `protected` オーバーライドし、
 * `Promise.race` でタイムアウトと競わせる。タイムアウトした場合は `false` を
 * 返す — `initializeLayout()`（呼び出し元、core 側は無改造）はこれを見て
 * 必ず `createDefaultLayout()`（空レイアウト）にフォールバックし、
 * `ready` 状態まで到達する。
 *
 * DI 上の注意: コンストラクタを再宣言していないため、InversifyJS は
 * プロトタイプチェーンを遡って基底クラス `FrontendApplication` の
 * コンストラクタメタデータをそのまま使う（Theia/Inversify で広く使われる
 * 「フックだけ差し替える」オーバーライドパターン）。
 */
const LAYOUT_RESTORE_TIMEOUT_MS = 8000;

@injectable()
export class AkariFrontendApplication extends FrontendApplication {

    protected async restoreLayout(): Promise<boolean> {
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<'akari-layout-restore-timeout'>(resolve => {
            timeoutHandle = setTimeout(() => resolve('akari-layout-restore-timeout'), LAYOUT_RESTORE_TIMEOUT_MS);
        });

        try {
            const result = await Promise.race([super.restoreLayout(), timeout]);
            if (result === 'akari-layout-restore-timeout') {
                console.error(
                    `[akari-shell-strip] layout restore timed out after ${LAYOUT_RESTORE_TIMEOUT_MS}ms — ` +
                    'falling back to default (empty) layout to guarantee ready state.'
                );
                return false;
            }
            return result;
        } catch (e) {
            // 保険（core 側の restoreLayout は既に内部で try/catch → false を返す設計だが、
            // 将来の Theia バージョン変更や想定外の同期例外に備えて二重に守る）。
            console.error('[akari-shell-strip] layout restore threw unexpectedly — falling back to default (empty) layout.', e);
            return false;
        } finally {
            if (timeoutHandle !== undefined) {
                clearTimeout(timeoutHandle);
            }
        }
    }
}
