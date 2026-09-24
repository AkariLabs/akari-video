import type { CommandService } from '@theia/core/lib/common';
import type { TranscriptSummary } from '../../common/akari-annotations-protocol';
import type { AkariMaterialSelection } from '../../common/material-selected-event';
import { aiActionCatalog, describeAiTiles } from '../../common/ai-action-catalog';
import { appendAiBack, appendAiTiles, type AiTabView } from './ai-tiles';
import { appendAiTranscribePanel } from './ai-transcribe-panel';

const kindLabels = { audio: '音声の素材', video: '動画の素材', image: '画像の素材', other: '素材' };

export function appendAiMaterialView(parent: HTMLElement, options: {
    selection: AkariMaterialSelection;
    tab: 'generation' | 'info';
    view: AiTabView;
    summary: TranscriptSummary;
    running: boolean;
    commands: Pick<CommandService, 'executeCommand'>;
    onTab: (tab: 'generation' | 'info') => void;
    onView: (view: AiTabView) => void;
    onVideoForm: (parent: HTMLElement) => void;
    createdPath?: string;
    onDialogResult: (result: 'opened' | 'running' | 'cancelled') => void;
}): void {
    const { selection } = options;
    const header = document.createElement('header');
    header.className = 'akari-inspector-ai-material-header';
    const name = document.createElement('strong');
    name.className = 'akari-inspector-ai-material-name';
    name.textContent = selection.name;
    const kind = document.createElement('span');
    kind.className = 'akari-inspector-ai-material-kind';
    kind.textContent = kindLabels[selection.mediaKind];
    header.append(name, kind);
    parent.appendChild(header);

    const strip = document.createElement('div');
    strip.className = 'akari-inspector-tab-strip';
    strip.setAttribute('role', 'tablist');
    strip.setAttribute('aria-label', '素材のインスペクター');
    for (const tab of [{ id: 'generation', label: 'AI' }, { id: 'info', label: '情報' }] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'akari-inspector-tab';
        button.textContent = tab.label;
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(options.tab === tab.id));
        if (options.tab === tab.id) button.className += ' is-active';
        button.setAttribute('data-akari-inspector-ai-tab', tab.id);
        button.addEventListener('click', () => options.onTab(tab.id));
        strip.appendChild(button);
    }
    parent.appendChild(strip);

    if (options.tab === 'info') {
        const info = document.createElement('div');
        info.className = 'akari-inspector-ai-material-info';
        const path = document.createElement('p');
        path.textContent = `パス: ${selection.relativePath}`;
        const type = document.createElement('p');
        type.textContent = `種類: ${kindLabels[selection.mediaKind]}`;
        info.append(path, type);
        parent.appendChild(info);
        return;
    }

    if (options.view === 'transcribe' && (selection.mediaKind === 'audio' || selection.mediaKind === 'video')) {
        appendAiBack(parent, '文字起こし', () => options.onView('tiles'));
        appendAiTranscribePanel(parent, {
            projectRoot: selection.projectRoot,
            target: { relativePath: selection.relativePath, name: selection.name, duration: 0, atSeconds: 0 },
            summary: options.summary, running: options.running, commands: options.commands,
            onDialogResult: options.onDialogResult
        });
        return;
    }
    if (options.view === 'video' && selection.mediaKind === 'image') {
        appendAiBack(parent, '動画にする', () => options.onView('tiles'));
        options.onVideoForm(parent);
        if (options.createdPath) {
            const message = document.createElement('p');
            message.className = 'akari-inspector-ai-material-created';
            message.textContent = `新しい素材 ${options.createdPath.split('/').pop()} を作りました（${options.createdPath}）`;
            parent.appendChild(message);
        }
        return;
    }
    const targetKind = `material-${selection.mediaKind}`;
    const groups = selection.mediaKind === 'other' ? [] : describeAiTiles(
        aiActionCatalog(selection.mediaKind === 'image' ? [{ id: 'video', kind: 'video' }] : []), targetKind as 'material-audio' | 'material-video' | 'material-image'
    );
    if (!groups.length) {
        const empty = document.createElement('p');
        empty.className = 'akari-inspector-ai-material-empty';
        empty.textContent = 'この素材で使える AI はまだありません';
        parent.appendChild(empty);
        return;
    }
    appendAiTiles(parent, groups, id => { if (id === 'transcribe' || id === 'video') options.onView(id); },
        options.summary.state === 'done');
}
