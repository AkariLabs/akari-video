import {
    captionPathsFromEdit, collectDesignColors, ColorPanelOpenRequest, extractPalette, findEditItem, Paint, parseColorHistory,
    parsePaint, photoSourcesFromEdit, pushColorHistory, readItemPath, sameColorPanelTarget
} from './color-model';
import { ColorPanelPhotoRow, ColorPanelView } from './color-panel';

/**
 * 色パネルの「開いている間の状態」と、パネルに並べる色の集め方（履歴・ブランドキット・このデザインの色・写真の色）。
 * インスペクター本体（akari-inspector-widget）からは open / close / mount の 3 つだけを呼ぶ。
 */

/** ブランドキットの読み書き（akari-project が登録するコマンド。拡張をまたぐので文字列で持つ）。 */
export const BRAND_KIT_GET_COMMAND_ID = 'akari.library.brandKit.get';
export const BRAND_KIT_ADD_COLOR_COMMAND_ID = 'akari.library.brandKit.addColor';
export const BRAND_KIT_REMOVE_COLOR_COMMAND_ID = 'akari.library.brandKit.removeColor';

export const COLOR_HISTORY_STORAGE_KEY = 'akari.colorPanel.history.v0';

export interface ColorPanelHostDeps {
    executeCommand<T>(id: string, ...args: unknown[]): Promise<T | undefined>;
    /** プロジェクト直下からの相対パスの文字列（無ければ undefined）。 */
    readProjectText(relativePath: string): Promise<string | undefined>;
    readProjectBytes(relativePath: string): Promise<Uint8Array | undefined>;
    /** 動画の 1 コマ目（data URI）。 */
    videoFrame(relativePath: string): Promise<string | undefined>;
    notice(message: string): void;
    storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

/** 今の選択から見た、パネルの対象（見出し・今の値・書き込み）。 */
export interface ColorPanelResolved {
    title: string;
    current: Paint | undefined;
    write(paint: Paint): Promise<{ ok: boolean; message?: string }>;
}

interface ColorPanelSession {
    request: ColorPanelOpenRequest;
    selectionKey: string;
    view: ColorPanelView;
    resolved?: ColorPanelResolved;
}

export class ColorPanelHost {
    protected session: ColorPanelSession | undefined;
    protected history: Paint[];
    protected brand: string[] = [];
    protected design: Paint[] = [];
    protected photos: ColorPanelPhotoRow[] = [];
    protected editDoc: unknown;
    protected readonly photoCache = new Map<string, Promise<ColorPanelPhotoRow | undefined>>();
    protected loadSeq = 0;

    constructor(protected readonly deps: ColorPanelHostDeps) {
        this.history = this.readHistory();
    }

    get isOpen(): boolean {
        return !!this.session;
    }

    get request(): ColorPanelOpenRequest | undefined {
        return this.session?.request;
    }

    get view(): ColorPanelView | undefined {
        return this.session?.view;
    }

    /** 開く。toggle 指定で同じ対象が開いていたら閉じて false を返す。 */
    open(request: ColorPanelOpenRequest, selectionKey: string): boolean {
        const same = this.session && sameColorPanelTarget(this.session.request.target, request.target)
            && this.session.selectionKey === selectionKey;
        if (same && request.toggle) {
            this.close();
            return false;
        }
        if (same) {
            this.session!.request = request;
            return true;
        }
        this.close();
        this.session = { request, selectionKey, view: new ColorPanelView() };
        void this.refreshSources();
        return true;
    }

    close(): void {
        this.session?.view.dispose();
        this.session = undefined;
    }

    /** 選択が変わったら閉じる。開いたままでよければ true。 */
    keepFor(selectionKey: string | undefined): boolean {
        if (!this.session) return false;
        if (selectionKey !== this.session.selectionKey) {
            this.close();
            return false;
        }
        return true;
    }

    /** item を対象にしたときの今の値（edit.json から読む）。 */
    itemValue(itemId: string, path: string): Paint | undefined {
        return parsePaint(readItemPath(findEditItem(this.editDoc, itemId), path));
    }

    /** パネルを parent へ置き、今の値で描き直す。 */
    mount(parent: HTMLElement, resolved: ColorPanelResolved, onClose: () => void): void {
        const session = this.session;
        if (!session) return;
        session.resolved = resolved;
        this.updateView(onClose);
        parent.appendChild(session.view.element);
    }

    protected lastOnClose: () => void = () => undefined;

    protected updateView(onClose?: () => void): void {
        const session = this.session;
        const resolved = session?.resolved;
        if (!session || !resolved) return;
        if (onClose) this.lastOnClose = onClose;
        const close = this.lastOnClose;
        const request = session.request;
        session.view.update({
            title: request.title ?? resolved.title,
            current: request.target.kind === 'item' ? this.itemValue(request.target.itemId, request.target.path) : resolved.current,
            allowGradient: request.allowGradient === true,
            allowTransparent: request.allowTransparent === true,
            history: this.history,
            designColors: this.design,
            brandColors: this.brand,
            photos: this.photos,
            onApply: (paint, options) => {
                if (options.final) void this.commit(session, paint);
            },
            onClose: close,
            onBrandAdd: color => void this.updateBrand(BRAND_KIT_ADD_COLOR_COMMAND_ID, color, 'ブランドキットに入れました（どのプロジェクトでも使えます）'),
            onBrandRemove: color => void this.updateBrand(BRAND_KIT_REMOVE_COLOR_COMMAND_ID, color),
            notice: message => this.deps.notice(message)
        });
    }

    protected async commit(session: ColorPanelSession, paint: Paint): Promise<void> {
        const resolved = session.resolved;
        if (!resolved || this.session !== session) return;
        let result: { ok: boolean; message?: string };
        try {
            result = await resolved.write(paint);
        } catch (error) {
            result = { ok: false, message: String(error) };
        }
        if (!result.ok) {
            if (this.session === session) session.view.resetDraft();
            this.deps.notice(result.message ?? '色を反映できませんでした。');
            return;
        }
        this.history = pushColorHistory(this.history, paint);
        this.writeHistory();
        if (this.session === session) {
            this.updateView();
            void this.refreshSources();
        }
    }

    protected async updateBrand(command: string, color: string, done?: string): Promise<void> {
        try {
            const next = await this.deps.executeCommand<string[]>(command, color);
            if (!Array.isArray(next)) throw new Error('ブランドキットが見つかりません');
            this.brand = next;
            if (done) this.deps.notice(done);
            this.updateView();
        } catch (error) {
            this.deps.notice(`ブランドキットを保存できませんでした: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    protected readHistory(): Paint[] {
        try {
            const raw = this.deps.storage?.getItem(COLOR_HISTORY_STORAGE_KEY);
            return raw ? parseColorHistory(JSON.parse(raw)) : [];
        } catch {
            return [];
        }
    }

    protected writeHistory(): void {
        try {
            this.deps.storage?.setItem(COLOR_HISTORY_STORAGE_KEY, JSON.stringify(this.history));
        } catch { /* 保存できなくても今の履歴は残る。 */ }
    }

    /** ブランドキット・このデザインの色・写真の色を読み直す（開いたとき・書いた後）。 */
    async refreshSources(): Promise<void> {
        const seq = ++this.loadSeq;
        const brand = this.deps.executeCommand<string[]>(BRAND_KIT_GET_COMMAND_ID).catch(() => undefined);
        let edit: unknown;
        const documents: unknown[] = [];
        try {
            const text = await this.deps.readProjectText('edit.json');
            edit = text ? JSON.parse(text) : undefined;
        } catch {
            edit = undefined;
        }
        if (edit) {
            documents.push(edit);
            for (const path of captionPathsFromEdit(edit)) {
                try {
                    const text = await this.deps.readProjectText(path);
                    if (text) documents.push(JSON.parse(text));
                } catch { /* 読めない字幕ファイルは色集めから外す。 */ }
            }
        }
        const brandColors = await brand;
        if (seq !== this.loadSeq) return;
        this.editDoc = edit;
        this.design = collectDesignColors(documents);
        if (Array.isArray(brandColors)) this.brand = brandColors;
        this.updateView();
        const sources = photoSourcesFromEdit(edit);
        const rows = await Promise.all(sources.map(source => this.photoRow(source.path, source.kind)));
        if (seq !== this.loadSeq) return;
        this.photos = rows.filter((row): row is ColorPanelPhotoRow => !!row);
        this.updateView();
    }

    protected photoRow(path: string, kind: 'image' | 'video'): Promise<ColorPanelPhotoRow | undefined> {
        let cached = this.photoCache.get(path);
        if (!cached) {
            cached = this.loadPhotoRow(path, kind).catch(() => undefined);
            this.photoCache.set(path, cached);
        }
        return cached;
    }

    protected async loadPhotoRow(path: string, kind: 'image' | 'video'): Promise<ColorPanelPhotoRow | undefined> {
        const label = path.split('/').pop() ?? path;
        let url: string | undefined;
        let revoke: (() => void) | undefined;
        if (kind === 'image') {
            const bytes = await this.deps.readProjectBytes(path);
            if (!bytes) return undefined;
            const type = /\.png$/iu.test(path) ? 'image/png' : /\.webp$/iu.test(path) ? 'image/webp'
                : /\.gif$/iu.test(path) ? 'image/gif' : /\.avif$/iu.test(path) ? 'image/avif' : 'image/jpeg';
            url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
            revoke = () => URL.revokeObjectURL(url!);
        } else {
            url = await this.deps.videoFrame(path);
        }
        if (!url) return undefined;
        try {
            const image = await loadImage(url);
            const size = 64;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) return undefined;
            // 真ん中の正方形を 64px に縮めて数える（サムネイルも同じ切り方）。
            const side = Math.min(image.naturalWidth, image.naturalHeight);
            context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, size, size);
            const colors = extractPalette(context.getImageData(0, 0, size, size).data, 5);
            return { path, label, thumb: canvas.toDataURL('image/png'), colors };
        } finally {
            revoke?.();
        }
    }
}

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('画像を読めませんでした'));
        image.src = url;
    });
}
