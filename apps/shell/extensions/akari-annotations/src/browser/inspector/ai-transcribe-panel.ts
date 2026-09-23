import type { CommandService } from '@theia/core/lib/common';
import type { TranscriptSummary } from '../../common/akari-annotations-protocol';
import type { TimelineSelectionModel } from '../timeline-selection-model';

export interface AiTranscribeTarget {
    relativePath: string;
    name: string;
    duration: number;
    atSeconds: number;
}

type Snapshot = NonNullable<TimelineSelectionModel['snapshot']>;

/** Resolve source IDs against edit.json without asking the timeline widget to change its snapshot. */
export function resolveAiTranscribeTarget(snapshot: Snapshot, edit: unknown): AiTranscribeTarget | undefined {
    if (snapshot.kind === 'multi' || snapshot.kind === 'gap' || snapshot.kind === 'world'
        || snapshot.kind === 'caption' || snapshot.kind === 'overlay') return undefined;
    const doc = edit as { sources?: Array<{ id?: string; path?: string }>;
        audio?: { sfx?: Array<{ id?: string; path?: string }>; narration?: Array<{ id?: string; path?: string }>;
            bgm?: { path?: string } };
        tracks?: Array<{ items?: Array<{ id?: string; source?: { src?: string; kind?: string } }> }> };
    const pathFor = (src?: string): string | undefined => doc?.sources?.find(source => source.id === src)?.path;
    let path: string | undefined;
    let duration: number;
    let atSeconds: number;
    if (snapshot.kind === 'cut') {
        path = snapshot.sourcePath ?? pathFor(snapshot.src);
        duration = snapshot.outputEnd - snapshot.outputStart;
        atSeconds = snapshot.outputStart;
    } else if (snapshot.kind === 'audio') {
        const row = snapshot.audioKind === 'bgm' ? doc?.audio?.bgm
            : (doc?.audio?.[snapshot.audioKind] ?? []).find(item => item.id === snapshot.id);
        path = row?.path;
        const item = doc?.tracks?.flatMap(track => track.items ?? []).find(candidate => candidate.id === snapshot.id);
        path ??= pathFor(item?.source?.src);
        duration = snapshot.duration;
        atSeconds = snapshot.outputStart;
    } else {
        const item = doc?.tracks?.flatMap(track => track.items ?? []).find(candidate => candidate.id === snapshot.id);
        path = pathFor(item?.source?.src ?? snapshot.src)
            ?? (snapshot.kind === 'layer' ? snapshot.src : undefined);
        duration = snapshot.duration;
        atSeconds = snapshot.outputStart;
    }
    if (!path || path.startsWith('/') || /^[a-z][a-z\d+.-]*:/iu.test(path)
        || path.replace(/\\/gu, '/').split('/').some(part => !part || part === '..' || part === '.')
        || !Number.isFinite(duration) || !Number.isFinite(atSeconds)) return undefined;
    return { relativePath: path, name: path.split('/').pop() || path, duration, atSeconds };
}

export function appendAiTranscribePanel(parent: HTMLElement, options: {
    projectRoot: string;
    target?: AiTranscribeTarget;
    summary: TranscriptSummary;
    running: boolean;
    commands: Pick<CommandService, 'executeCommand'>;
    onDialogResult: (result: 'opened' | 'running' | 'cancelled') => void;
}): void {
    const panel = document.createElement('section');
    panel.className = 'akari-inspector-ai-transcribe-panel';
    const target = options.target;
    if (!target) {
        const reason = document.createElement('p');
        reason.className = 'akari-inspector-ai-transcribe-reason';
        reason.textContent = 'このクリップの素材が見つかりません。';
        panel.appendChild(reason);
        parent.appendChild(panel);
        return;
    }
    const detail = document.createElement('p');
    detail.className = 'akari-inspector-ai-transcribe-detail';
    detail.textContent = `${target.name} · ${target.duration.toFixed(1)} 秒`;
    panel.appendChild(detail);
    const button = (label: string, action: () => void): HTMLButtonElement => {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = 'akari-inspector-ai-transcribe-button';
        element.textContent = label;
        element.addEventListener('click', action);
        return element;
    };
    const dialog = async (): Promise<void> => {
        const result = await options.commands.executeCommand<'opened' | 'running' | 'cancelled'>(
            'akari.transcribe.openDialog', { projectRoot: options.projectRoot, relativePath: target.relativePath });
        options.onDialogResult(result);
    };
    if (options.summary.state === 'done') {
        const heading = document.createElement('h4');
        heading.className = 'akari-inspector-ai-transcribe-status';
        heading.textContent = `文字起こし済み · ${options.summary.total} 行`;
        panel.appendChild(heading);
        const list = document.createElement('div');
        list.className = 'akari-inspector-ai-transcribe-list';
        for (const segment of options.summary.segments) {
            const row = document.createElement('div');
            row.className = 'akari-inspector-ai-transcribe-row';
            const time = document.createElement('time');
            time.className = 'akari-inspector-ai-transcribe-time';
            time.textContent = `${segment.start.toFixed(1)}–${segment.end.toFixed(1)}`;
            const text = document.createElement('span');
            text.className = 'akari-inspector-ai-transcribe-text';
            text.textContent = segment.text;
            row.append(time, text);
            list.appendChild(row);
        }
        panel.appendChild(list);
        panel.appendChild(button('台本で開く', () => {
            void options.commands.executeCommand('akari.daihon.open', { atSeconds: target.atSeconds });
        }));
        panel.appendChild(button('やり直す', () => { void dialog(); }));
    } else if (options.running) {
        const status = document.createElement('p');
        status.className = 'akari-inspector-ai-transcribe-status';
        status.textContent = '文字起こし中です';
        panel.appendChild(status);
    } else {
        panel.appendChild(button('文字起こしする', () => { void dialog(); }));
    }
    parent.appendChild(panel);
}
