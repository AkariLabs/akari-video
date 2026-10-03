import type { ImageRouteState, StillCandidate, StillCandidateBatch } from '../../common/akari-annotations-protocol';
import { nearestStillAspect, stillCroppedNotice, stillRouteLabel, type StillAspect } from './ai-still-panel';
import { stillMakerBadge } from './maker-badge';

export interface AiStillResultActions {
    home(): void; redo(): void; toVideo(): void; cancel(): void;
    select(candidate: StillCandidate): void;
}

export function appendAiStillResultPanel(parent: HTMLElement, options: {
    prompt: string; aspect: StillAspect; batch?: StillCandidateBatch; running: boolean;
    inFramePath?: string; error?: string; actions: AiStillResultActions;
}): void {
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
        const element = document.createElement(tag);
        element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    };
    const root = make('div', 'akari-inspector-ai-still-result');
    root.setAttribute('data-akari-inspector-ai-still-result', 'true');
    const batch = options.batch;
    const results = batch?.results?.length || options.running ? batch?.results ?? [] : batch?.candidates ?? [];
    const successes = results.filter(row => row.ok && row.relativePath);
    const failures = results.filter(row => !row.ok);
    const header = make('div', 'akari-inspector-ai-result-header');
    const back = make('button', 'akari-inspector-ai-back', '← ホーム');
    back.type = 'button'; back.addEventListener('click', options.actions.home);
    header.append(back, make('strong', 'akari-inspector-ai-result-title', '静止画の結果'),
        make('span', 'akari-inspector-ai-result-count', options.running ? '作成中' : `${successes.length} 案`));
    root.appendChild(header);
    const prompt = make('div', 'akari-inspector-ai-result-prompt');
    prompt.setAttribute('data-akari-inspector-ai-result-prompt', 'true');
    prompt.append(make('span', 'akari-inspector-ai-result-label', '入れた指示文'),
        make('p', '', `${options.prompt} · ${options.aspect}`));
    root.appendChild(prompt);
    const grid = make('div', 'akari-inspector-ai-result-grid');
    if ((options.running ? batch?.routes.length : successes.length) === 1) grid.classList.add('akari-inspector-ai-result-single');
    const candidate = (row: StillCandidate): void => {
        const card = make('button', 'akari-inspector-ai-result-candidate');
        card.type = 'button';
        card.setAttribute('data-akari-inspector-ai-result-candidate', row.relativePath!);
        if (row.relativePath === options.inFramePath) card.setAttribute('data-akari-inspector-ai-result-in-frame', 'true');
        const image = make('img', 'akari-inspector-ai-result-image');
        image.alt = `${stillRouteLabel(row.route)} の案`;
        if (row.thumbnail) image.src = row.thumbnail;
        card.append(image, make('span', 'akari-inspector-ai-result-meta',
            `${stillRouteLabel(row.route)} · ${Math.round(row.elapsedSeconds ?? 0)} 秒 · ${row.width ?? '?'}×${row.height ?? '?'}${row.costUsd ? ` · $${row.costUsd.toFixed(3)}` : ''}`));
        const maker = row.route === 'codex' || row.route === 'fal' ? 'openai'
            : row.route === 'antigravity' ? 'google' : 'xai';
        card.appendChild(stillMakerBadge(maker));
        if (row.croppedFrom && row.width && row.height) {
            const notice = make('span', 'akari-inspector-ai-still-cropped',
                stillCroppedNotice(nearestStillAspect(row.width, row.height), row.croppedFrom));
            notice.setAttribute('data-akari-inspector-ai-cropped', 'true');
            card.appendChild(notice);
        }
        if (row.relativePath === options.inFramePath) card.appendChild(make('span', 'akari-inspector-ai-result-in-frame', '枠に入っています'));
        card.addEventListener('click', () => options.actions.select(row));
        grid.appendChild(card);
    };
    if (options.running) {
        for (const route of batch?.routes ?? []) {
            const row = results.find(result => result.route === route);
            if (row?.ok && row.relativePath) candidate(row);
            else if (!row) {
                const pending = make('div', 'akari-inspector-ai-result-pending', `◌ ${stillRouteLabel(route as ImageRouteState['id'])}`);
                pending.setAttribute('data-akari-inspector-ai-result-pending', route);
                grid.appendChild(pending);
            }
        }
    } else for (const row of successes) candidate(row);
    root.appendChild(grid);
    if (options.running) {
        root.appendChild(make('p', 'akari-inspector-ai-result-note', 'できた順に、ここへ絵が入ります。'));
        const cancel = make('button', 'akari-inspector-ai-still-secondary', 'キャンセル');
        cancel.type = 'button'; cancel.setAttribute('data-akari-inspector-ai-cancel', 'true');
        cancel.addEventListener('click', options.actions.cancel);
        root.appendChild(cancel);
    } else {
        for (const row of failures) {
            const failed = make('p', 'akari-inspector-ai-result-failed', `${stillRouteLabel(row.route)} · 失敗 · ${row.reason ?? '生成できませんでした。'}`);
            failed.setAttribute('data-akari-inspector-ai-result-failed', row.route);
            root.appendChild(failed);
        }
        root.appendChild(make('p', 'akari-inspector-ai-result-note', successes.length === 1
            ? '枠に入れました。' : successes.length > 1
                ? '押した案が枠に入ります。ほかの案は素材に残っています。' : 'まだ何も作っていません。'));
    }
    if (options.error) root.appendChild(make('p', 'akari-inspector-ai-still-error', options.error));
    const footer = make('div', 'akari-inspector-ai-result-footer');
    const redo = make('button', 'akari-inspector-ai-still-secondary', '指示を変えてやり直す');
    redo.type = 'button'; redo.disabled = options.running;
    redo.setAttribute('data-akari-inspector-ai-result-redo', 'true');
    redo.addEventListener('click', options.actions.redo);
    const video = make('button', 'akari-inspector-ai-still-primary', 'この絵を動画にする →');
    video.type = 'button'; video.disabled = !options.inFramePath || options.running;
    video.setAttribute('data-akari-inspector-ai-result-to-video', 'true');
    video.addEventListener('click', options.actions.toVideo);
    footer.append(redo, video);
    root.appendChild(footer);
    parent.appendChild(root);
}
