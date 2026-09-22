import crypto from 'node:crypto';
import { parseCaptionList } from '../local-apply.mjs';
import { deriveContext } from './derive-context.mjs';
import { deriveVisionContext, readVisionFile } from './vision-context.mjs';

export const sha256 = text => crypto.createHash('sha256').update(text ?? '', 'utf8').digest('hex');

export function projectLocationOf(docs) {
    const value = docs?.location;
    return value && typeof value.rootFsPath === 'string' && value.rootFsPath
        && typeof value.editPath === 'string' && value.editPath
        && typeof value.captionsPath === 'string' && value.captionsPath
        ? { rootFsPath: value.rootFsPath, editPath: value.editPath, captionsPath: value.captionsPath }
        : null;
}

/** 枠やログへ渡す snapshot から、手元だけで使うプロジェクト位置を除く。 */
export function withoutProjectLocation(state) {
    const snapshot = structuredClone(state);
    delete snapshot.location;
    if (snapshot.docs) delete snapshot.docs.location;
    return snapshot;
}

function withoutMessageLocation(message) {
    const copy = structuredClone(message);
    if (copy?.type === 'docs') delete copy.location;
    return copy;
}

export function emptyProject() {
    const edit = { version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [], tracks: [] };
    const source = JSON.stringify(edit, null, 2) + '\n';
    const captionsSource = JSON.stringify({ version: 1, captions: [] }, null, 2) + '\n';
    return { source, edit, captionsSource, context: deriveContext(edit, { transcript: [] }) };
}

export function buildProjectFromDocs(docs, { vision = [] } = {}) {
    if (!docs || docs.type !== 'docs' || typeof docs.projectSessionId !== 'string') throw new Error('Invalid companion docs');
    const location = projectLocationOf(docs);
    if (docs.edit?.tooLarge || docs.captions?.tooLarge) {
        return { tooLarge: { edit: Boolean(docs.edit?.tooLarge), captions: Boolean(docs.captions?.tooLarge) },
            projectSessionId: docs.projectSessionId, location };
    }
    if (typeof docs.edit?.text !== 'string' || typeof docs.captions?.text !== 'string') throw new Error('Invalid companion docs text');
    const source = docs.edit.text;
    const captionsSource = docs.captions.text;
    const edit = JSON.parse(source);
    const transcript = parseCaptionList(captionsSource).map((caption, index) => ({
        id: String(caption.id ?? `caption-${index + 1}`),
        text: String(caption.text ?? ''),
        start: Number(caption.start ?? 0),
        end: Number(caption.end ?? caption.start ?? 0),
    }));
    return {
        projectSessionId: docs.projectSessionId,
        source,
        editText: source,
        edit,
        captionsSource,
        captionsText: captionsSource,
        editHash: sha256(source),
        captionsHash: sha256(captionsSource),
        suppliedEditHash: docs.edit.sha256,
        suppliedCaptionsHash: docs.captions.sha256,
        context: deriveContext(edit, { transcript, vision, location }),
        location,
        tooLarge: null,
    };
}

export class ProjectContextTracker {
    constructor({ onUpdate = () => {}, readVision = readVisionFile } = {}) {
        this.onUpdate = onUpdate;
        this.readVision = readVision;
        this.lightSeq = -1;
        this.docsSeq = -1;
        this.visionCache = { key: null, rows: [] };
        this.state = { ...emptyProject(), projectSessionId: null, editHash: null, captionsHash: null,
            selection: null, playheadT: 0, location: null, tooLarge: null, ready: false };
        this.waiters = new Set();
    }

    update(message) {
        if (message?.type === 'light') {
            if (!Number.isFinite(message.seq) || message.seq <= this.lightSeq) return false;
            this.lightSeq = message.seq;
            const ids = Array.isArray(message.selection) ? message.selection
                .filter(row => typeof row?.kind === 'string' && typeof row?.id === 'string'
                    && ['item', 'cut', 'caption'].includes(row.kind))
                .map(row => `${row.kind}:${row.id}`) : [];
            this.state = { ...this.state, projectSessionId: message.projectSessionId ?? this.state.projectSessionId,
                selection: ids.length > 1 ? ids : ids[0] ?? null,
                playheadT: Number.isFinite(message.playhead?.seconds) ? message.playhead.seconds : this.state.playheadT,
                light: structuredClone(message) };
        } else if (message?.type === 'docs') {
            if (!Number.isFinite(message.seq) || message.seq <= this.docsSeq) return false;
            this.docsSeq = message.seq;
            this.state = { ...this.state, ...this.buildProject(message), ready: !message.edit?.tooLarge && !message.captions?.tooLarge,
                docs: structuredClone(message) };
        } else return false;
        this.onUpdate(this.snapshot(), withoutMessageLocation(message));
        for (const waiter of this.waiters) waiter();
        return true;
    }

    acceptApplied({ editText, captionsText, editSha256, captionsSha256 }) {
        const source = editText ?? this.state.source;
        const captionsSource = captionsText ?? this.state.captionsSource;
        const next = this.buildProject({ type: 'docs', seq: this.docsSeq,
            projectSessionId: this.state.projectSessionId,
            location: this.state.location,
            edit: { text: source, sha256: editSha256 ?? sha256(source) },
            captions: { text: captionsSource, sha256: captionsSha256 ?? sha256(captionsSource) } });
        this.state = { ...this.state, ...next, ready: true };
        this.onUpdate(this.snapshot(), { type: 'local-apply' });
    }

    async waitForDocsChange({ editHash, captionsHash }, timeoutMs = 1200) {
        const changed = () => this.state.editHash !== editHash || this.state.captionsHash !== captionsHash;
        if (changed()) return this.snapshot();
        return new Promise(resolve => {
            let timer;
            const check = () => {
                if (!changed()) return;
                clearTimeout(timer); this.waiters.delete(check); resolve(this.snapshot());
            };
            this.waiters.add(check);
            timer = setTimeout(() => { this.waiters.delete(check); resolve(this.snapshot()); }, timeoutMs);
        });
    }

    buildProject(docs) {
        if (docs.edit?.tooLarge || docs.captions?.tooLarge) return buildProjectFromDocs(docs);
        const location = projectLocationOf(docs);
        const editHash = typeof docs.edit?.text === 'string' ? sha256(docs.edit.text) : null;
        const key = `${editHash ?? ''}\n${JSON.stringify(location)}`;
        if (key !== this.visionCache.key) {
            this.visionCache = { key, rows: location ? deriveVisionContext(docs.edit?.text, location, this.readVision) : [] };
        }
        return buildProjectFromDocs(docs, { vision: this.visionCache.rows });
    }

    snapshot() { return withoutProjectLocation(this.state); }
}
