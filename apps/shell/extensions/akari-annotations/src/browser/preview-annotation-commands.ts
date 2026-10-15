import { t } from '@akari-video/i18n';
import URI from '@theia/core/lib/common/uri';
import { CommandContribution, CommandRegistry, CommandService, MessageService } from '@theia/core/lib/common';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { AkariAnnotationsService, Annotation } from '../common/akari-annotations-protocol';
import { AnnotationStroke, normalizeStrokes, parseReview } from '../common/annotation-store';
import { composeSingleAnnotationHandoff } from '../common/annotation-handoff-flow';
import { composeBatchAnnotationHandoff } from '../common/batch-annotation-handoff';
import { handPromptToPartner, PromptResult } from '../common/partner-handoff';
import { ReviewModel } from './review-model';
import { SentAnnotationStore } from './sent-annotation-store';
import { UiTargetLabelStore } from './ui-target-label-store';
import { ProjectLocation } from './project-location';
import { ProjectReviewLocation } from './project-review-location';

export interface CreateFromPreviewRequest {
    projectRootUri: string;
    src?: string | null;
    sourceT: number;
    sourceRange?: [number, number] | null;
    target?: string | null;
    strokes?: AnnotationStroke[] | null;
    text: string;
}

export interface PreviewPacketRequest {
    projectRootUri: string;
    ids: string[];
    extraLines?: string[];
}

export function composePreviewPacket(
    annotations: readonly Annotation[], extraLines: readonly string[] = [],
    uiTargetLabels: Readonly<Record<string, string>> = {}
): string {
    if (!annotations.length) throw new Error('No matching annotations');
    const prompt = annotations.length === 1
        ? composeSingleAnnotationHandoff(annotations[0], uiTargetLabels)
        : composeBatchAnnotationHandoff(annotations);
    return extraLines.length ? `${prompt}\n\n${extraLines.join('\n')}` : prompt;
}

@injectable()
export class PreviewAnnotationCommands implements CommandContribution {
    @inject(AkariAnnotationsService) protected readonly annotationsService!: AkariAnnotationsService;
    @inject(ReviewModel) protected readonly model!: ReviewModel;
    @inject(SentAnnotationStore) protected readonly sent!: SentAnnotationStore;
    @inject(UiTargetLabelStore) protected readonly labels!: UiTargetLabelStore;
    @inject(ProjectReviewLocation) protected readonly contribution!: ProjectReviewLocation;
    @inject(FileService) protected readonly files!: FileService;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(MessageService) protected readonly messages!: MessageService;
    @inject(ClipboardService) protected readonly clipboard!: ClipboardService;

    /** Prefer the active timeline's review.json, exactly as the right panel does. */
    protected async reviewLocation(projectRootUri: unknown): Promise<ProjectLocation> {
        if (typeof projectRootUri !== 'string' || !projectRootUri.startsWith('file:///')) {
            throw new Error('Invalid projectRootUri');
        }
        const root = new URI(projectRootUri).normalizePath();
        if (!await this.files.exists(root)) throw new Error('Project does not exist');
        const active = this.model.location;
        const location = active?.root.normalizePath().toString() === root.toString()
            ? active : await this.contribution.findReviewLocationForProjectRoot(root);
        if (!location) throw new Error('Project review location does not exist');
        if (!await this.files.exists(location.reviewUri)) throw new Error('review.json does not exist');
        return location;
    }

    protected async selected(request: PreviewPacketRequest): Promise<{
        reviewUri: string; editUri: string | undefined; annotations: Annotation[]
    }> {
        if (!request || !Array.isArray(request.ids) || !request.ids.length
            || !request.ids.every(id => typeof id === 'string' && id.length > 0)
            || (request.extraLines !== undefined && (!Array.isArray(request.extraLines)
                || !request.extraLines.every(line => typeof line === 'string')))) {
            throw new Error('Invalid annotation ids or extraLines');
        }
        const location = await this.reviewLocation(request.projectRootUri);
        const reviewUri = location.reviewUri.toString();
        const review = parseReview((await this.files.readFile(new URI(reviewUri))).value.toString());
        const byId = new Map(review.annotations.map(annotation => [annotation.id, annotation]));
        const annotations = [...new Set(request.ids)].flatMap(id => {
            const annotation = byId.get(id);
            return annotation ? [annotation] : [];
        });
        if (!annotations.length) throw new Error('No matching annotations');
        return { reviewUri, editUri: location.editUri?.toString(), annotations };
    }

    protected async create(request: CreateFromPreviewRequest): Promise<{ id: string }> {
        if (!request || !Number.isFinite(request.sourceT) || request.sourceT < 0
            || typeof request.text !== 'string'
            || (!request.text.trim() && !request.strokes?.length)
            || (request.src != null && typeof request.src !== 'string')
            || (request.target != null && typeof request.target !== 'string')
            || (request.sourceRange != null && (!Array.isArray(request.sourceRange)
                || request.sourceRange.length !== 2 || !request.sourceRange.every(Number.isFinite)
                || request.sourceRange[0] < 0 || request.sourceRange[0] >= request.sourceRange[1]))
            || (request.strokes != null && (!Array.isArray(request.strokes)
                || request.strokes.some(stroke => stroke?.space !== 'content-rect'
                    || !Number.isFinite(stroke.frame?.sourceT) || stroke.frame.sourceT < 0
                    || (stroke.frame.cutIndex !== null && (!Number.isInteger(stroke.frame.cutIndex)
                        || stroke.frame.cutIndex < 0)))
                || normalizeStrokes(request.strokes, 'preview', [])?.length !== request.strokes.length))) {
            throw new Error('Invalid preview annotation');
        }
        const reviewUri = (await this.reviewLocation(request.projectRootUri)).reviewUri.toString();
        const result = await this.annotationsService.createAnnotation({
            reviewUri, projectRootUri: request.projectRootUri,
            src: request.src ?? null,
            sourceT: request.sourceT,
            sourceRange: request.sourceRange ?? null,
            timelineT: null,
            target: request.target ?? null,
            targetKind: request.sourceRange ? 'range' : request.strokes?.length ? 'region' : 'instant',
            strokes: request.strokes ?? null,
            text: request.text
        });
        if (this.model.location?.reviewUri.toString() === reviewUri
            && !this.model.annotations.some(annotation => annotation.id === result.annotation.id)) {
            this.model.annotations = [...this.model.annotations, result.annotation];
        }
        return { id: result.annotation.id };
    }

    protected async hand(request: PreviewPacketRequest): Promise<PromptResult> {
        const { reviewUri, editUri, annotations } = await this.selected(request);
        const prompt = composePreviewPacket(annotations, request.extraLines, this.labels.get(editUri));
        const subject = annotations.length === 1 ? t('annotations.reviewPanelWidget.text.annotation')
            : t('annotations.reviewPanelWidget.text.batchSubject', { count: annotations.length, n: annotations.length });
        const result = await handPromptToPartner(prompt, subject, {
            typePrompt: text => this.commands.executeCommand('akari.partner.typePrompt', text),
            copy: async text => { await this.clipboard.writeText(text); },
            notify: async (message, action) => {
                if (action) return (await this.messages.info(message, action)) === action;
                void this.messages.info(message);
            },
            openPartner: () => this.commands.executeCommand('akari.partner.open')
        });
        if (result === 'typed' || result === 'unsupported') {
            for (const annotation of annotations) await this.sent.mark(reviewUri, annotation.id);
        }
        return result;
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand({ id: 'akari.annotations.createFromPreview' }, { execute: request => this.create(request) });
        registry.registerCommand({ id: 'akari.annotations.composePacket' }, {
            execute: async request => {
                const { annotations, editUri } = await this.selected(request);
                return composePreviewPacket(annotations, request.extraLines, this.labels.get(editUri));
            }
        });
        registry.registerCommand({ id: 'akari.annotations.handToPartner' }, { execute: request => this.hand(request) });
    }
}
