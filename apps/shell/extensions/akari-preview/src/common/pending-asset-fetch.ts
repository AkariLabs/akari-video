/**
 * 取り寄せ中の素材の控え。
 *
 * カタログ素材をプレビューへ落としたとき、取り寄せ（ダウンロード）を待ってから置くと
 * 数秒ただ固まって見える。そこで配置（edit.json への本参照の書き込み）を先に済ませ、
 * 実体が届くまでの間だけ「粗い絵 + クルクル + ダウンロード中」を出す
 * （2026-09-27 オーナー裁定 — 先に置いて、届いたら塗り替える）。
 *
 * ここはその「間」を出力プレビューとタイムラインで共有するためだけの控え。
 * 正本は edit.json で、この控えが消えても編集内容は変わらない。
 * 拡張をまたいで 1 つの実体を共有する（akari-preview は project / annotations の共通の下）。
 */

export type PendingAssetFetchKind = 'image' | 'video' | 'audio';

export interface PendingAssetFetch {
    /** edit.json に書いた参照（プロジェクト相対）。照合の鍵。 */
    relativePath: string;
    kind: PendingAssetFetchKind;
    /** 粗い絵（カタログのプレビュー URL）。無ければクルクルだけを出す。 */
    thumb?: string;
    title?: string;
    startedAt: number;
}

/** 区切りの揺れ（Windows のドロップ経路）で取り逃がさないよう鍵を正規化する。 */
export function pendingAssetFetchKey(relativePath: string): string {
    return relativePath.replace(/\\/g, '/');
}

export function summarizeFetchFailure(message: string): string {
    const lines = message.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const first = lines[0] ?? '';
    const reason = lines.slice(1).find(line => line.startsWith('- '));
    return (reason ? `${first}: ${reason.slice(2).trim()}` : first).slice(0, 120);
}

export class PendingAssetFetchStore {
    private readonly entries = new Map<string, PendingAssetFetch>();
    private readonly counts = new Map<string, number>();
    private readonly listeners = new Set<(relativePath: string) => void>();
    private readonly failureReasons = new Map<string, { reason: string; notedAt: number }>();

    noteFailureReason(catalogKey: string, reason: string): void {
        const now = Date.now();
        for (const [key, entry] of this.failureReasons) {
            if (now - entry.notedAt > 600_000) this.failureReasons.delete(key);
        }
        this.failureReasons.set(catalogKey, { reason, notedAt: now });
    }

    takeFailureReason(catalogKey: string): string | undefined {
        const entry = this.failureReasons.get(catalogKey);
        this.failureReasons.delete(catalogKey);
        return entry && Date.now() - entry.notedAt <= 600_000 ? entry.reason : undefined;
    }

    begin(entry: Omit<PendingAssetFetch, 'startedAt'> & { startedAt?: number }): void {
        const key = pendingAssetFetchKey(entry.relativePath);
        if (!key) return;
        this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
        this.entries.set(key, { ...entry, relativePath: key, startedAt: entry.startedAt ?? Date.now() });
        this.announce(key);
    }

    end(relativePath: string): void {
        const key = pendingAssetFetchKey(relativePath);
        const count = this.counts.get(key) ?? 0;
        if (count > 1) {
            this.counts.set(key, count - 1);
            return;
        }
        this.counts.delete(key);
        if (!this.entries.delete(key)) return;
        this.announce(key);
    }

    get(relativePath: string | undefined): PendingAssetFetch | undefined {
        return relativePath ? this.entries.get(pendingAssetFetchKey(relativePath)) : undefined;
    }

    has(relativePath: string | undefined): boolean {
        return !!this.get(relativePath);
    }

    get size(): number {
        return this.entries.size;
    }

    /** 控えが変わった合図。聞き手の例外は他の聞き手を止めない。 */
    onChanged(listener: (relativePath: string) => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    }

    private announce(relativePath: string): void {
        for (const listener of [...this.listeners]) {
            try { listener(relativePath); } catch (error) { console.warn('[akari-preview] 取り寄せ中の通知に失敗しました', error); }
        }
    }
}

export const pendingAssetFetches = new PendingAssetFetchStore();
