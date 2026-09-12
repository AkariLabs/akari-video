import { Emitter, Event } from '@theia/core/lib/common';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AkariAnnotationsService, Annotation, SaveCanvasRequest, SaveCanvasResult } from '../common/akari-annotations-protocol';
import { AnnotationStroke } from '../common/annotation-store';
import { ProjectLocation } from './project-location';

export type ReviewSessionLifecycle = 'recorded' | 'transcribed' | 'compiled';

/** akari-preview の ReviewSessionSummary のミラー（npm 依存を作らないため型だけ写す）。 */
export interface ReviewSessionSummaryLike {
    id: string;
    startedAt: string;
    endedAt?: string | null;
    durationSec?: number;
    orphaned?: boolean;
    status?: ReviewSessionLifecycle | null;
    compiledAnnotations?: string[] | null;
}

export type ReviewSessionBadgeKey = ReviewSessionLifecycle | 'orphaned';

export interface ReviewSessionBadge {
    key: ReviewSessionBadgeKey;
    label: string;
    /** recorded のときだけ非 undefined（パネルの 1 行ヒント） */
    hint?: string;
}

export function reviewSessionBadge(session: ReviewSessionSummaryLike): ReviewSessionBadge {
    if (session.orphaned === true) {
        return { key: 'orphaned', label: '未完了' };
    }
    if (session.status === 'transcribed') {
        return { key: 'transcribed', label: '文字起こし済み' };
    }
    if (session.status === 'compiled') {
        return { key: 'compiled', label: 'コンパイル済み' };
    }
    return {
        key: 'recorded',
        label: '録音済み',
        hint: 'まだチケットになっていません — コンパイルでチケット化'
    };
}

export function pendingCompileSessions(
    sessions: readonly ReviewSessionSummaryLike[]
): ReviewSessionSummaryLike[] {
    return sessions
        .filter(session => reviewSessionBadge(session).key !== 'compiled')
        .sort((left, right) => {
            const leftMatch = /^s-(\d+)$/.exec(left.id);
            const rightMatch = /^s-(\d+)$/.exec(right.id);
            const order = Number(leftMatch?.[1] ?? 0) - Number(rightMatch?.[1] ?? 0);
            return order || left.id.localeCompare(right.id);
        });
}

export function sessionIdForAnnotation(
    annotation: { id: string; input?: string; session?: { id?: string } | null },
    sessions: readonly ReviewSessionSummaryLike[]
): string | undefined {
    if (annotation.input !== 'session') {
        return undefined;
    }
    const compiledSession = sessions.find(
        session => session.compiledAnnotations?.includes(annotation.id)
    );
    if (compiledSession) {
        return compiledSession.id;
    }
    const fallback = annotation.session?.id;
    return fallback && /^s-\d+$/.test(fallback) ? fallback : undefined;
}

export type AnnotationStatusFilter = 'all' | Annotation['status'];

/** レポート面で選択中のブロック（doc: target 注釈作成の文脈）。契約 2026-07-26 §1/§4-1。 */
export interface DocBlockSelection {
    /** プロジェクト相対パス（レポート HTML 等）。 */
    path: string;
    blockId: string;
}

/**
 * タイムラインウィジェットと注釈パネルが共有するレビュー状態。
 * 読み込み（review.json の監視・パース）はタイムライン側が担い、ここへ流し込む。
 * 注釈の書き込み操作（追加・確認済み化）は本モデルに集約し、両ウィジェットから同じ経路で呼ぶ。
 */
@injectable()
export class ReviewModel {

    @inject(AkariAnnotationsService)
    protected readonly annotationsService!: AkariAnnotationsService;

    protected readonly onChangedEmitter = new Emitter<void>();
    /** 注釈・絞り込み・選択時刻のいずれかが変わった */
    readonly onChanged: Event<void> = this.onChangedEmitter.event;

    protected readonly onRevealEmitter = new Emitter<string>();
    /** タイムラインのピン等から特定の注釈へ視線を移したい */
    readonly onReveal: Event<string> = this.onRevealEmitter.event;

    protected readonly onSeekRequestedEmitter = new Emitter<number>();
    /** パネル側から時刻へジャンプしたい（プレビューのシークはタイムライン側が担当） */
    readonly onSeekRequested: Event<number> = this.onSeekRequestedEmitter.event;

    protected _location: ProjectLocation | undefined;
    protected _annotations: Annotation[] = [];
    protected _statusFilter: AnnotationStatusFilter = 'all';
    protected _selectedSourceT = 0;
    protected _docSelection: DocBlockSelection | undefined;

    get location(): ProjectLocation | undefined {
        return this._location;
    }

    set location(value: ProjectLocation | undefined) {
        this._location = value;
        this.onChangedEmitter.fire();
    }

    get annotations(): readonly Annotation[] {
        return this._annotations;
    }

    set annotations(value: readonly Annotation[]) {
        this._annotations = [...value];
        this.onChangedEmitter.fire();
    }

    get statusFilter(): AnnotationStatusFilter {
        return this._statusFilter;
    }

    set statusFilter(value: AnnotationStatusFilter) {
        this._statusFilter = value;
        this.onChangedEmitter.fire();
    }

    get selectedSourceT(): number {
        return this._selectedSourceT;
    }

    set selectedSourceT(value: number) {
        this._selectedSourceT = value;
        this.onChangedEmitter.fire();
    }

    get docSelection(): DocBlockSelection | undefined {
        return this._docSelection;
    }

    /** レポート側のブロッククリック（akari-annotations-contribution の command 経由）で更新する。 */
    set docSelection(value: DocBlockSelection | undefined) {
        this._docSelection = value;
        this.onChangedEmitter.fire();
    }

    /** 絞り込み適用済み・時刻順の注釈。sourceT: null（doc: / image: target）は末尾へ寄せる。 */
    filtered(): Annotation[] {
        return this._annotations
            .filter(annotation => this._statusFilter === 'all' || annotation.status === this._statusFilter)
            .sort((left, right) => (left.sourceT ?? Infinity) - (right.sourceT ?? Infinity));
    }

    reveal(annotationId: string): void {
        this.onRevealEmitter.fire(annotationId);
    }

    requestSeek(time: number): void {
        this.onSeekRequestedEmitter.fire(time);
    }

    async addAnnotation(
        text: string,
        sourceT: number,
        src: string | null = null
    ): Promise<{ annotation: Annotation; committed: boolean }> {
        const location = this._location;
        if (!location) {
            throw new Error('プロジェクトを特定できません。');
        }
        const result = await this.annotationsService.createAnnotation({
            reviewUri: location.reviewUri.toString(),
            projectRootUri: location.root.toString(),
            src,
            sourceT,
            timelineT: null,
            target: null,
            text
        });
        if (!this._annotations.some(existing => existing.id === result.annotation.id)) {
            this._annotations = [...this._annotations, result.annotation];
            this.onChangedEmitter.fire();
        }
        return result;
    }

    /** source 素材上の区間注釈。音声を含む素材種別を増やさず src + sourceRange へ着地させる。 */
    async addSourceRangeAnnotation(
        text: string,
        src: string,
        sourceRange: [number, number]
    ): Promise<{ annotation: Annotation; committed: boolean }> {
        const location = this._location;
        if (!location) {
            throw new Error('プロジェクトを特定できません。');
        }
        const result = await this.annotationsService.createAnnotation({
            reviewUri: location.reviewUri.toString(),
            projectRootUri: location.root.toString(),
            src,
            sourceT: sourceRange[0],
            sourceRange,
            timelineT: null,
            target: null,
            targetKind: 'range',
            text
        });
        if (!this._annotations.some(existing => existing.id === result.annotation.id)) {
            this._annotations = [...this._annotations, result.annotation];
            this.onChangedEmitter.fire();
        }
        return result;
    }

    /**
     * doc: target 注釈の作成（契約 2026-07-26 §1/§2）。sourceT / timelineT / sourceRange は
     * null で送る — 動画面の addAnnotation とは別経路にして、既存の sourceT 必須挙動を変えない。
     */
    async addDocAnnotation(text: string, selection: DocBlockSelection): Promise<{ annotation: Annotation; committed: boolean }> {
        const location = this._location;
        if (!location) {
            throw new Error('プロジェクトを特定できません。');
        }
        const result = await this.annotationsService.createAnnotation({
            reviewUri: location.reviewUri.toString(),
            projectRootUri: location.root.toString(),
            sourceT: null,
            timelineT: null,
            target: `doc:${selection.path}#${selection.blockId}`,
            text
        });
        if (!this._annotations.some(existing => existing.id === result.annotation.id)) {
            this._annotations = [...this._annotations, result.annotation];
            this.onChangedEmitter.fire();
        }
        return result;
    }

    /**
     * image: target 注釈の作成（contract-2026-07-26-doc-image-annotations §1/§3/§4-2）。
     * sourceT / timelineT / sourceRange は null（doc: と同じ経路）。text は空文字を許容する
     * — strokes だけの注釈（typed テキストは任意）を許すため、addDocAnnotation とは別に切る
     * （createAnnotation サービス側は strokes 非空なら空 text を受理する）。
     */
    async addImageAnnotation(
        text: string, imagePath: string, strokes: AnnotationStroke[]
    ): Promise<{ annotation: Annotation; committed: boolean }> {
        const location = this._location;
        if (!location) {
            throw new Error('プロジェクトを特定できません。');
        }
        const result = await this.annotationsService.createAnnotation({
            reviewUri: location.reviewUri.toString(),
            projectRootUri: location.root.toString(),
            sourceT: null,
            timelineT: null,
            target: `image:${imagePath}`,
            strokes: strokes.length > 0 ? strokes : null,
            text
        });
        if (!this._annotations.some(existing => existing.id === result.annotation.id)) {
            this._annotations = [...this._annotations, result.annotation];
            this.onChangedEmitter.fire();
        }
        return result;
    }

    /**
     * ui: target 注釈の作成（docs/contract-2026-08-11-review-session-ui-events.md §6 / M3）。
     * doc: / image: とは異なり、UI 要素には固有の動画秒が無いわけではない（レビュー中に
     * 選択した瞬間の再生位置に意味がある）ため、sourceT は addAnnotation と同じく現在の
     * 選択秒をそのまま渡す — sourceT: null 許容規約（isDocOrImageTarget）を広げる必要がない。
     */
    async addUiAnnotation(text: string, sourceT: number, uiTarget: string): Promise<{ annotation: Annotation; committed: boolean }> {
        const location = this._location;
        if (!location) {
            throw new Error('プロジェクトを特定できません。');
        }
        const result = await this.annotationsService.createAnnotation({
            reviewUri: location.reviewUri.toString(),
            projectRootUri: location.root.toString(),
            sourceT,
            timelineT: null,
            target: `ui:${uiTarget}`,
            text
        });
        if (!this._annotations.some(existing => existing.id === result.annotation.id)) {
            this._annotations = [...this._annotations, result.annotation];
            this.onChangedEmitter.fire();
        }
        return result;
    }

    /**
     * キャンバス面の記録原本の保存（contract-2026-07-26-canvas-surface §1/§2）。review.json への
     * 着地は行わない — skills/compile-review-session が review/canvas/c-NNNN/ を検出して行う
     * （§4。review セッション s-NNNN と同じ Raw → コンパイルの 2 段構え）。
     */
    async saveCanvas(request: Omit<SaveCanvasRequest, 'projectRootUri'>): Promise<SaveCanvasResult> {
        const location = this._location;
        if (!location) {
            throw new Error('プロジェクトを特定できません。');
        }
        return this.annotationsService.saveCanvas({ ...request, projectRootUri: location.root.toString() });
    }

    async resolveAnnotation(annotationId: string): Promise<Annotation> {
        const location = this._location;
        if (!location) {
            throw new Error('プロジェクトを特定できません。');
        }
        const result = await this.annotationsService.resolveAnnotation({
            reviewUri: location.reviewUri.toString(),
            annotationId
        });
        this._annotations = this._annotations.map(
            annotation => annotation.id === annotationId ? result.annotation : annotation
        );
        this.onChangedEmitter.fire();
        return result.annotation;
    }
}
