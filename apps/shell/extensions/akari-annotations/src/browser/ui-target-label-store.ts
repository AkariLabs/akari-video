import URI from '@theia/core/lib/common/uri';
import { Emitter, Event } from '@theia/core/lib/common';
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { CLIP_ANNOTATION_LABELS_EVENT } from '../common/timeline-context-menu-items';

/** The same edit-URI keyed labels are used by the panel and preview handoff commands. */
@injectable()
export class UiTargetLabelStore {
    protected readonly byEditUri = new Map<string, Readonly<Record<string, string>>>();
    protected readonly changed = new Emitter<string>();
    readonly onDidChange: Event<string> = this.changed.event;

    @postConstruct()
    protected listen(): void {
        window.addEventListener(CLIP_ANNOTATION_LABELS_EVENT, event => {
            const detail = (event as CustomEvent<{ editUri?: string; labels?: Record<string, string> }>).detail;
            if (typeof detail?.editUri !== 'string' || !detail.editUri
                || !detail.labels || typeof detail.labels !== 'object' || Array.isArray(detail.labels)) return;
            this.set(detail.editUri, detail.labels);
        });
    }

    set(editUri: string, labels: Readonly<Record<string, string>>): void {
        const key = new URI(editUri).normalizePath().toString();
        this.byEditUri.set(key, { ...labels });
        this.changed.fire(key);
    }

    get(editUri: string | undefined): Readonly<Record<string, string>> {
        return editUri ? this.byEditUri.get(new URI(editUri).normalizePath().toString()) ?? {} : {};
    }
}
