import { Emitter, Event } from '@theia/core/lib/common';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AkariAnnotationsService, Annotation } from '../common/akari-annotations-protocol';
import { ProjectLocation } from './project-location';

export type AnnotationStatusFilter = 'all' | Annotation['status'];

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

    /** 絞り込み適用済み・時刻順の注釈 */
    filtered(): Annotation[] {
        return this._annotations
            .filter(annotation => this._statusFilter === 'all' || annotation.status === this._statusFilter)
            .sort((left, right) => left.sourceT - right.sourceT);
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
