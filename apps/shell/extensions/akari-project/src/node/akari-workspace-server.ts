import { injectable } from '@theia/core/shared/inversify';
import * as fs from '@theia/core/shared/fs-extra';
import { randomBytes } from 'crypto';
import { dirname } from 'path';
import { Deferred } from '@theia/core/lib/common/promise-util';
import URI from '@theia/core/lib/common/uri';
import { DefaultWorkspaceServer } from '@theia/workspace/lib/node/default-workspace-server';

/**
 * 「最近開いたワークスペース」台帳（`<THEIA_CONFIG_DIR>/recentworkspace.json`）を
 * 失わないための `DefaultWorkspaceServer` 差し替え。
 *
 * 出自 = 2026-09-03 オーナー実機報告「アプリ側は開いていると認識しているプロジェクトなのに、
 * プレビューが安全対策で動画配信を拒否する。起動直後や別プロジェクトからの切り替え直後なら
 * 読み込める」。
 *
 * 真因 = Theia 既定の `setMostRecentlyUsedWorkspace()` は台帳を read → modify → write するが
 * 排他を持たず、書き込みも `fs.writeJson`（O_TRUNC してから write）で非原子。1 バックエンド
 * プロセスに複数ウィンドウがぶら下がる shell では、開く / 閉じる / 終了時の書き込みが同じ tick に
 * 重なり、
 *   (1) 双方が同じ古いリストを読むので後勝ちで片方の root が台帳から消える、
 *   (2) 読み手が truncate 直後の空ファイルを読むと履歴が丸ごと消える、
 *   (3) 短い方の書き込みが長いファイルの先頭に乗り、末尾に前の内容のゴミが残る
 *       （`jsonc-parser` は先頭の値だけ黙って返すので、以降の履歴が落ちたまま次の書き込みで確定する）
 * が起きる。実測 = 同時 2 書き込み 40 回で 40 回 root 消失・12 回ファイルが JSON として破損
 * （`test/workspace-ledger-concurrency.test.mjs`）。実機の `~/.theia/recentworkspace.json` も
 * 170 バイト中 93 バイト目以降が前の内容の残骸という (3) の形で観測された。
 *
 * 影響 = 台帳は `AkariPreviewServiceImpl.resolveAllowedWorkspaceRoots()` が
 * 「開いているワークスペース一覧」として使う唯一の出所なので、消えた root のウィンドウは
 * 自分のプロジェクト内の素材でも `The requested workspace root is not an open workspace` で
 * 拒否される。ウィンドウが自分の root を書き直す瞬間（起動直後・切り替え直後）だけ通る、
 * という報告どおりの挙動になる。ホーム画面の「最近のプロジェクト」も同じ台帳を見ている。
 *
 * 対処 = 台帳の read-modify-write を 1 本のキューへ直列化し、書き込みを
 * 一時ファイル + `rename` の原子的置換にする。読み手が見るのは常に「前の完全な内容」か
 * 「次の完全な内容」のどちらかだけになる。
 */
@injectable()
export class AkariWorkspaceServer extends DefaultWorkspaceServer {
    /** 台帳を触る操作を直列化するキュー。 */
    protected ledgerQueue: Promise<unknown> = Promise.resolve();

    override async setMostRecentlyUsedWorkspace(rawUri: string): Promise<void> {
        // the empty string is used as a signal from the frontend not to load a workspace.
        const uri = rawUri && new URI(rawUri).toString();
        this.root = new Deferred<string | undefined>();
        this.root.resolve(uri);
        await this.enqueueLedgerUpdate(async () => {
            // 空文字（ワークスペースを閉じた合図）は台帳に残さない。読み出し側の
            // `getRecentWorkspaces()` がどのみち落とすので、書いても increment するのはゴミだけ。
            const recentRoots = [...new Set([uri, ...await this.getRecentWorkspaces()])].filter(root => !!root);
            await this.writeToUserHome({ recentRoots });
        });
    }

    override async removeRecentWorkspace(rawUri: string): Promise<void> {
        const uri = rawUri && new URI(rawUri).toString();
        await this.enqueueLedgerUpdate(async () => {
            const recentRoots = await this.getRecentWorkspaces();
            const index = recentRoots.indexOf(uri);
            if (index !== -1) {
                recentRoots.splice(index, 1);
                await this.writeToUserHome({ recentRoots });
            }
        });
    }

    /**
     * 台帳の読み書きを 1 本に並べる。既定実装は `writeToUserHome()` を await すらしない
     * fire-and-forget なので、呼び出し側が待っても直列化できない（待てるようにするのも
     * この差し替えの一部）。1 件の失敗で以降の更新が止まらないよう、鎖自体は握り潰す。
     */
    protected enqueueLedgerUpdate<T>(update: () => Promise<T>): Promise<T> {
        const next = this.ledgerQueue.then(update, update);
        this.ledgerQueue = next.catch(() => undefined);
        return next;
    }

    /**
     * 一時ファイルへ書いてから `rename` で置き換える（同じディレクトリ = 同じファイルシステムなので
     * 置換は原子的）。既定の `fs.writeJson` は O_TRUNC → write なので、その隙間に読まれると
     * 空・欠けた台帳がそのまま「履歴」として採用されてしまう。
     */
    protected override async writeToFile(fsPath: string, data: object): Promise<void> {
        await fs.mkdirs(dirname(fsPath));
        const temporary = `${fsPath}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
        try {
            await fs.writeJson(temporary, data);
            await fs.rename(temporary, fsPath);
        } catch (error) {
            await fs.remove(temporary).catch(() => undefined);
            throw error;
        }
    }
}
