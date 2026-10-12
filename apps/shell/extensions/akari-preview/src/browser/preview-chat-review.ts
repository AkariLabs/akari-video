import { normalizeReviewPoint, reviewBoxFromPoints, reviewCaptionLabelsAt, reviewElementsAt } from '../common/chat-review-attachments';
import type { ChatAttachment } from '../common/chat-review-attachments';

export function reviewThumbnailEviction(attachments: readonly ChatAttachment[], limit = 50): number {
    const size = (item: ChatAttachment): number => new TextEncoder().encode(JSON.stringify(item)).byteLength;
    const oversized = attachments.findIndex(item => item.kind === 'review' && !!item.review.thumbnail && size(item) > 64 * 1024);
    if (oversized >= 0) return oversized;
    const withImage = attachments.map((item, index) => item.kind === 'review' && item.review.thumbnail ? index : -1).filter(index => index >= 0);
    return withImage.length > limit ? withImage[0] : -1;
}

export function previewChatReviewScript(): string {
    return `(() => {
        const initial = window.__akariPreview;
        const post = message => window.akari?.reviewChatPost?.(message);
        const normalizePoint = (${normalizeReviewPoint.toString()});
        const boxFromPoints = (${reviewBoxFromPoints.toString()});
        const captionLabelsAt = (${reviewCaptionLabelsAt.toString()});
        const elementsAt = (${reviewElementsAt.toString()});
        const thumbnailEviction = (${reviewThumbnailEviction.toString()});
        const stage = document.getElementById('preview-stage');
        const transport = document.querySelector('.transport');
        const seek = document.getElementById('seek');
        if (!stage || !transport || !seek) return;
        const source = initial.reviewSource || (initial.kind === 'output' ? 'edit.json' : '動画');
        const sourceLabel = initial.reviewSourceLabel || (initial.kind === 'output' ? '編集中のプレビュー' : '書き出し動画');
        const currentTime = () => Number(seek.value) || 0;
        const clock = time => {
            const seconds = Math.max(0, Math.floor(time));
            return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
        };
        let tool = null;
        let draft = null;
        let marks = [];
        let partnerName = 'AKARI';
        let trayOpen = false;
        let drawing = null;
        let claimedPointerId = null;
        let suppressReviewClick = false;
        let rangeStart = null;
        let trimTail = Promise.resolve();
        const waitForState = predicate => new Promise(resolve => {
            const timer = setTimeout(() => { stateWaiters.delete(done); resolve(false); }, 5000);
            const done = () => { if (predicate()) { clearTimeout(timer); stateWaiters.delete(done); resolve(true); } };
            stateWaiters.add(done);
        });
        const stateWaiters = new Set();
        const trim = limit => {
            trimTail = trimTail.catch(() => undefined).then(async () => {
                for (let attempt = 0; attempt < 100; attempt++) {
                    const index = thumbnailEviction(marks, limit);
                    if (index < 0) break;
                    const old = marks[index];
                    const count = marks.length;
                    const removed = waitForState(() => marks.length < count);
                    post({ type: 'akari-preview-chat-review-remove', index });
                    if (!await removed) break;
                    const added = waitForState(() => marks.length >= count);
                    post({ type: 'akari-preview-chat-review-add', review: { ...old.review, thumbnail: undefined } });
                    if (!await added) break;
                }
            });
            return trimTail;
        };
        const root = document.createElement('div');
        root.id = 'review-chat-layer';
        root.innerHTML = '<svg data-review-ink viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg><div data-review-marks></div><div data-review-hint hidden></div><div data-review-note hidden><div class="review-what">ここにあるもの <div data-review-elements></div></div><textarea data-review-memo placeholder="変更したい内容を入力" rows="3"></textarea><div class="review-note-actions"><button type="button" data-review-later>あとで</button><button type="button" data-review-add>追加</button></div></div>';
        stage.append(root);
        const ink = root.querySelector('[data-review-ink]');
        const marksNode = root.querySelector('[data-review-marks]');
        const hint = root.querySelector('[data-review-hint]');
        const note = root.querySelector('[data-review-note]');
        const elementsNode = root.querySelector('[data-review-elements]');
        const memo = root.querySelector('[data-review-memo]');
        const right = document.querySelector('.transport-right');
        const buttons = document.createElement('div');
        buttons.className = 'review-tools';
        buttons.innerHTML = '<button type="button" data-review-tool="pen" title="ペン">ペン</button><button type="button" data-review-tool="pin" title="ピン">ピン</button><button type="button" data-review-tool="range" title="範囲">範囲</button><span class="review-divider"></span><button type="button" data-review-attach-count="0" hidden>添付 0</button>';
        right.prepend(buttons);
        const attachButton = buttons.querySelector('[data-review-attach-count]');
        const tray = document.createElement('div');
        tray.id = 'review-chat-tray';
        tray.hidden = true;
        tray.innerHTML = '<div class="review-tray-heading">添付待ち <span data-review-tray-count></span></div><div data-review-rows></div><div class="review-tray-actions"><button type="button" data-review-tray-later>あとで</button><button type="button" data-review-send>AKARI に添付</button></div>';
        transport.append(tray);
        const sendButton = tray.querySelector('[data-review-send]');
        const seekMarks = document.createElement('div');
        seekMarks.id = 'review-seek-marks';
        document.querySelector('.transport-seek')?.append(seekMarks);
        const rangeControls = document.createElement('div');
        rangeControls.id = 'review-range-controls';
        rangeControls.innerHTML = '<button type="button" data-review-range-start>開始</button><button type="button" data-review-range-end>終了</button>';
        transport.append(rangeControls);
        const render = () => {
            sendButton.textContent = partnerName + ' に添付';
            attachButton.hidden = marks.length === 0;
            attachButton.dataset.reviewAttachCount = String(marks.length);
            attachButton.textContent = '添付 ' + marks.length;
            for (const button of buttons.querySelectorAll('[data-review-tool]')) {
                button.classList.toggle('on', button.dataset.reviewTool === tool);
                button.setAttribute('aria-pressed', String(button.dataset.reviewTool === tool));
            }
            root.classList.toggle('is-active', Boolean(tool));
            rangeControls.hidden = tool !== 'range';
            hint.hidden = !tool;
            hint.textContent = tool === 'pen' ? '動画の上をクリックして丸をつける'
                : tool === 'pin' ? '動画の上をクリックしてピンを置く'
                : tool === 'range' ? (rangeStart === null ? '開始位置を選ぶ' : '終了位置を選ぶ') : '';
            note.hidden = !draft;
            elementsNode.replaceChildren();
            if (draft) {
                for (const label of draft.elements || []) {
                    const item = document.createElement('span');
                    item.dataset.reviewElement = '';
                    item.textContent = label;
                    elementsNode.append(item);
                }
                if (!draft.elements?.length) elementsNode.textContent = 'この時刻のコマ';
            }
            marksNode.replaceChildren();
            seekMarks.replaceChildren();
            const duration = Number(seek.max) || document.getElementById('preview-video')?.duration || 1;
            for (const [index, item] of marks.entries()) {
                const mark = item.review;
                if (mark.source !== source) continue;
                const dot = document.createElement('span');
                dot.className = 'review-seek-dot';
                dot.style.left = (100 * mark.time / duration) + '%';
                seekMarks.append(dot);
                if (!mark.shape) continue;
                const badge = document.createElement('span');
                badge.className = 'review-mark ' + mark.tool;
                badge.dataset.reviewTime = String(mark.time);
                badge.style.left = (mark.shape.x * 100) + '%';
                badge.style.top = (mark.shape.y * 100) + '%';
                badge.style.opacity = Math.abs(mark.time - currentTime()) > 1.5 ? '.25' : '1';
                if (mark.tool === 'pen') {
                    badge.style.width = (Math.max(mark.shape.w || 0, .025) * 100) + '%';
                    badge.style.height = (Math.max(mark.shape.h || 0, .025) * 100) + '%';
                }
                badge.textContent = String(index + 1);
                marksNode.append(badge);
            }
            tray.hidden = !trayOpen || marks.length === 0;
            tray.querySelector('[data-review-tray-count]').textContent = String(marks.length);
            const rows = tray.querySelector('[data-review-rows]');
            rows.replaceChildren();
            marks.forEach((item, index) => {
                const row = document.createElement('div');
                row.dataset.reviewRow = String(index);
                row.className = 'review-tray-row';
                if (item.review.thumbnail) {
                    const thumb = document.createElement('img');
                    thumb.src = item.review.thumbnail;
                    thumb.alt = '';
                    row.append(thumb);
                }
                const content = document.createElement('span');
                content.textContent = item.review.sourceLabel + ' ・ ' + clock(item.review.time)
                    + (item.review.timeEnd === undefined ? '' : '〜' + clock(item.review.timeEnd))
                    + ' ・ ' + ({ pen: 'ペン', pin: 'ピン', range: '範囲' })[item.review.tool]
                    + ' — ' + item.review.text;
                row.append(content);
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.dataset.reviewRemove = String(index);
                remove.setAttribute('aria-label', '外す');
                remove.textContent = '×';
                row.append(remove);
                rows.append(row);
            });
        };
        const thumbnail = () => {
            try {
                const frame = document.getElementById('frame-engine-canvas') || document.getElementById('preview-video');
                const width = frame.videoWidth || frame.width;
                const height = frame.videoHeight || frame.height;
                if (!(width > 0 && height > 0)) return undefined;
                const canvas = document.createElement('canvas');
                canvas.width = 160;
                canvas.height = Math.max(1, Math.round(160 * height / width));
                canvas.getContext('2d').drawImage(frame, 0, 0, canvas.width, canvas.height);
                return canvas.toDataURL('image/jpeg', .7);
            } catch { return undefined; }
        };
        const captionLines = () => {
            const rows = [];
            for (const plate of document.querySelectorAll('#caption-plate .caption-row-plate')) {
                const lines = plate.querySelectorAll('.akari-caption__line');
                for (const line of lines.length ? lines : plate.querySelectorAll('.akari-caption__block')) {
                    if (getComputedStyle(line).visibility === 'hidden' || getComputedStyle(line).display === 'none') continue;
                    const clean = line.cloneNode(true);
                    clean.querySelectorAll('style,script').forEach(node => node.remove());
                    const label = clean.textContent?.replace(/\\s+/g, ' ').trim();
                    if (!label) continue;
                    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
                    const rectangles = [];
                    let node;
                    while ((node = walker.nextNode())) {
                        if (!node.textContent?.trim() || node.parentElement?.closest('style,script')) continue;
                        const range = document.createRange();
                        range.selectNodeContents(node);
                        rectangles.push(...range.getClientRects());
                    }
                    if (!rectangles.length) rectangles.push(...line.getClientRects());
                    for (const rect of rectangles) {
                        if (rect.width > 0 && rect.height > 0) rows.push({ text: label,
                            rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } });
                    }
                }
            }
            return rows;
        };
        const beginNote = (kind, time, shape, clientX, clientY) => {
            const point = shape ? { x: shape.x + (shape.w || 0) / 2, y: shape.y + (shape.h || 0) / 2 } : { x: .5, y: .5 };
            const stageRect = stage.getBoundingClientRect();
            const hit = kind === 'pen' && shape
                ? { kind: 'rect', left: stageRect.left + shape.x * stageRect.width,
                    top: stageRect.top + shape.y * stageRect.height,
                    right: stageRect.left + (shape.x + (shape.w || 0)) * stageRect.width,
                    bottom: stageRect.top + (shape.y + (shape.h || 0)) * stageRect.height }
                : Number.isFinite(clientX) && Number.isFinite(clientY)
                    ? { kind: 'point', x: clientX, y: clientY } : null;
            const domLabels = initial.kind === 'output' && hit ? captionLabelsAt(captionLines(), hit) : [];
            const elements = initial.kind === 'output'
                ? [...new Set([...domLabels, ...elementsAt({ ...initial.summary, captions: window.akari?.previewCaptions || initial.captions }, time, point)])]
                : [];
            draft = { tool: kind, source, sourceLabel, time,
                ...(kind === 'range' ? { timeEnd: currentTime() } : {}),
                ...(shape ? { shape } : {}), elements, text: '', thumbnail: thumbnail() };
            memo.value = '';
            note.style.left = '8px';
            note.style.top = '8px';
            render();
            const fit = (preferred, size, available) => Math.max(8, Math.min(preferred, Math.max(8, available - size - 8)));
            note.style.left = fit(point.x * stageRect.width + 16, note.offsetWidth, stageRect.width) + 'px';
            note.style.top = fit(point.y * stageRect.height - 24, note.offsetHeight, stageRect.height) + 'px';
            memo.focus();
        };
        buttons.addEventListener('click', event => {
            const picked = event.target.closest('[data-review-tool]');
            if (picked) {
                tool = tool === picked.dataset.reviewTool ? null : picked.dataset.reviewTool;
                rangeStart = tool === 'range' ? currentTime() : null;
                draft = null;
                render();
            } else if (event.target.closest('[data-review-attach-count]')) {
                trayOpen = !trayOpen;
                render();
            }
        });
        rangeControls.addEventListener('click', event => {
            if (event.target.closest('[data-review-range-start]')) {
                rangeStart = currentTime(); render();
            } else if (event.target.closest('[data-review-range-end]')) {
                beginNote('range', rangeStart ?? currentTime());
            }
        });
        window.addEventListener('pointerdown', event => {
            if (draft && event.target.closest?.('[data-review-note]')
                && !event.target.closest?.('textarea,button,input,select,a[href]')) {
                event.preventDefault(); event.stopImmediatePropagation();
                return;
            }
            if (!tool || draft || event.button !== 0 || !stage.contains(event.target)
                || event.target.closest?.('[data-review-note]')) return;
            event.preventDefault(); event.stopImmediatePropagation();
            claimedPointerId = event.pointerId;
            suppressReviewClick = true;
            const rect = stage.getBoundingClientRect();
            const point = normalizePoint(event.clientX, event.clientY, rect);
            if (tool === 'pin') { beginNote('pin', currentTime(), point, event.clientX, event.clientY); return; }
            if (tool === 'range') { beginNote('range', rangeStart ?? currentTime(), undefined, event.clientX, event.clientY); return; }
            drawing = { pointerId: event.pointerId, points: [point], time: currentTime(), rect,
                x: event.clientX, y: event.clientY };
        }, true);
        window.addEventListener('pointermove', event => {
            if (claimedPointerId !== event.pointerId) return;
            event.preventDefault(); event.stopImmediatePropagation();
            if (!drawing) return;
            drawing.points.push(normalizePoint(event.clientX, event.clientY, drawing.rect));
            const points = drawing.points;
            ink.innerHTML = '<polyline points="' + points.map(p => (p.x * 100) + ',' + (p.y * 100)).join(' ') + '"></polyline>';
        }, true);
        window.addEventListener('pointerup', event => {
            if (claimedPointerId !== event.pointerId) return;
            claimedPointerId = null;
            event.preventDefault(); event.stopImmediatePropagation();
            if (!drawing) return;
            const done = drawing; drawing = null;
            ink.replaceChildren();
            const shape = boxFromPoints(done.points);
            if (shape && done.points.length === 1) {
                shape.x = Math.max(0, shape.x - .035); shape.y = Math.max(0, shape.y - .035);
                shape.w = .07; shape.h = .07;
            }
            beginNote('pen', done.time, shape, done.x, done.y);
        }, true);
        window.addEventListener('pointercancel', event => {
            if (claimedPointerId !== event.pointerId) return;
            claimedPointerId = null;
            drawing = null;
            ink.replaceChildren();
            event.preventDefault(); event.stopImmediatePropagation();
        }, true);
        window.addEventListener('click', event => {
            if (!suppressReviewClick || !stage.contains(event.target)) return;
            suppressReviewClick = false;
            event.preventDefault(); event.stopImmediatePropagation();
        }, true);
        const saveDraft = () => {
            if (!draft || !memo.value.trim()) { memo.focus(); return; }
            const review = { ...draft, text: memo.value.trim() };
            const candidate = { kind: 'review', label: review.sourceLabel + ' ' + review.time.toFixed(1) + '秒', review };
            if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > 64 * 1024) review.thumbnail = undefined;
            if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > 64 * 1024) {
                memo.setCustomValidity('メモが長すぎます。短くしてください');
                memo.reportValidity();
                return;
            }
            memo.setCustomValidity('');
            void trim(review.thumbnail ? 49 : 50).then(() => post({ type: 'akari-preview-chat-review-add', review }));
            draft = null; rangeStart = null; tool = null; render();
        };
        root.querySelector('[data-review-add]').addEventListener('click', saveDraft);
        root.querySelector('[data-review-later]').addEventListener('click', () => {
            if (memo.value.trim()) saveDraft();
            else { draft = null; tool = null; render(); }
        });
        tray.addEventListener('click', event => {
            const remove = event.target.closest('[data-review-remove]');
            if (remove) post({ type: 'akari-preview-chat-review-remove', index: Number(remove.dataset.reviewRemove) });
            else if (event.target.closest('[data-review-send]')) post({ type: 'akari-preview-chat-review-attach' });
            else if (event.target.closest('[data-review-tray-later]')) { trayOpen = false; render(); }
        });
        seek.addEventListener('pointerdown', () => { if (tool === 'range') rangeStart = currentTime(); });
        seek.addEventListener('pointerup', () => { if (tool === 'range' && rangeStart !== null && currentTime() !== rangeStart) beginNote('range', rangeStart); });
        seek.addEventListener('input', render);
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && (tool || draft || trayOpen)) {
                draft = null; tool = null; rangeStart = null; trayOpen = false; render();
            }
        });
        window.addEventListener('message', event => {
            if (event.data?.type !== 'akari-preview-chat-review-state') return;
            if (Array.isArray(event.data.attachments)) marks = event.data.attachments;
            partnerName = typeof event.data.partnerName === 'string' && /\\S/.test(event.data.partnerName) && event.data.partnerName !== 'AKARI'
                ? event.data.partnerName : 'AKARI';
            for (const done of [...stateWaiters]) done();
            if (marks.length === 0) trayOpen = false;
            render();
        });
        setInterval(() => {
            const time = currentTime();
            for (const badge of marksNode.querySelectorAll('[data-review-time]')) {
                badge.style.opacity = Math.abs(Number(badge.dataset.reviewTime) - time) > 1.5 ? '.25' : '1';
            }
        }, 250);
        post({ type: 'akari-preview-chat-review-load' });
        setTimeout(() => post({ type: 'akari-preview-chat-review-load' }), 700);
        render();
    })();`;
}
