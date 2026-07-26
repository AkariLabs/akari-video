import { Emitter, Event } from '@theia/core/lib/common';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AkariAnnotationsService, Annotation, SaveCanvasRequest, SaveCanvasResult } from '../common/akari-annotations-protocol';
import { AnnotationStroke } from '../common/annotation-store';
import { ProjectLocation } from './project-location';

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

    async addAnnotation(text: string, sourceT: number): Promise<{ annotation: Annotation; committed: boolean }> {
        const location = this._location;
        if (!location) {
            throw new Error('プロジェクトを特定できません。');
        }
        const result = await this.annotationsService.createAnnotation({
            reviewUri: location.reviewUri.toString(),
            projectRootUri: location.root.toString(),
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
