import { t as translate } from '@akari-video/i18n';
import { normalizeReviewPoint, reviewBoxFromPoints, reviewCaptionLabelsAt, reviewElementsAt, reviewAttachmentUiText,
    reviewEscapeStep, reviewMemoEnterAction } from '../common/chat-review-attachments';
import type { ChatAttachment } from '../common/chat-review-attachments';

export function reviewThumbnailEviction(attachments: readonly ChatAttachment[], limit = 50): number {
    const size = (item: ChatAttachment): number => new TextEncoder().encode(JSON.stringify(item)).byteLength;
    const oversized = attachments.findIndex(item => item.kind === 'review' && !!item.review.thumbnail && size(item) > 64 * 1024);
    if (oversized >= 0) return oversized;
    const withImage = attachments.map((item, index) => item.kind === 'review' && item.review.thumbnail ? index : -1).filter(index => index >= 0);
    return withImage.length > limit ? withImage[0] : -1;
}

export function previewChatReviewScript(): string {
    const uiText = {
        editingPreview: translate('preview.chatReview.ui.editingPreviewLabel'),
        exportedVideo: translate('preview.chatReview.ui.exportedVideoLabel'),
        clipboard: translate('preview.chatReview.ui.clipboardLabel'),
        pen: translate('preview.chatReview.ui.penLabel'),
        pin: translate('preview.chatReview.ui.pinLabel'),
        range: translate('preview.chatReview.ui.rangeLabel'),
        start: translate('preview.chatReview.ui.startLabel'),
        end: translate('preview.chatReview.ui.endLabel'),
        attachZero: translate('preview.chatReview.ui.attachZeroLabel'),
        memoPlaceholder: translate('preview.chatReview.ui.memoPlaceholderLabel'),
        delete: translate('preview.chatReview.ui.deleteLabel'),
        done: translate('preview.chatReview.ui.doneLabel'),
        copyToClipboard: translate('preview.chatReview.ui.copyToClipboardAction'),
        attachToPartner: translate('preview.chatReview.ui.attachToPartnerLabel'),
        attachCountOne: translate('preview.chatReview.ui.attachCountLabel_one'),
        attachCountOther: translate('preview.chatReview.ui.attachCountLabel_other'),
        penHint: translate('preview.chatReview.ui.penHintText'),
        pinHint: translate('preview.chatReview.ui.pinHintText'),
        rangeStartHint: translate('preview.chatReview.ui.rangeStartHintAction'),
        rangeEndHint: translate('preview.chatReview.ui.rangeEndHintAction'),
        separator: translate('preview.chatReview.ui.separatorLabel'),
        noMemo: translate('preview.chatReview.ui.noMemoLabel'),
        remove: translate('preview.chatReview.ui.removeLabel'),
        memoTooLong: translate('preview.chatReview.ui.memoTooLongMessage'),
        reviewLabel: translate('preview.chatReview.ui.reviewLabel')
    };
    return `(() => {
        const ui = ${JSON.stringify(uiText).replace(/</g, '\\u003c')};
        const attachmentUi = ${JSON.stringify(reviewAttachmentUiText()).replace(/</g, '\\u003c')};
        const formatUi = (text, params) => text.replace(/\\{(\\w+)\\}/g, (_, key) => String(params[key] ?? ''));
        const initial = window.__akariPreview;
        const post = message => window.akari?.reviewChatPost?.(message);
        const normalizePoint = (${normalizeReviewPoint.toString()});
        const boxFromPoints = (${reviewBoxFromPoints.toString()});
        const captionLabelsAt = (${reviewCaptionLabelsAt.toString()});
        const elementsAt = (${reviewElementsAt.toString()});
        const escapeStep = (${reviewEscapeStep.toString()});
        const enterAction = (${reviewMemoEnterAction.toString()});
        const thumbnailEviction = (${reviewThumbnailEviction.toString()});
        const stage = document.getElementById('preview-stage');
        const transport = document.querySelector('.transport');
        const seek = document.getElementById('seek');
        if (!stage || !transport || !seek) return;
        const source = initial.reviewSource || (initial.kind === 'output' ? 'edit.json' : ${JSON.stringify(translate('preview.chatReview.source.defaultVideoLabel', {}, 'ja'))});
        const sourceLabel = initial.reviewSourceLabel || (initial.kind === 'output' ? ui.editingPreview : ui.exportedVideo);
        const currentTime = () => Number(seek.value) || 0;
        const frameAt = () => window.akari?.previewAnnotationFrame?.() ||
            { timelineT: currentTime(), sourceT: currentTime(), cutIndex: null, src: initial.reviewSource };
        const clock = time => {
            const seconds = Math.max(0, Math.floor(time));
            return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
        };
        let tool = null;
        let activeNote = null;
        let marks = [];
        const pendingAdds = new Map();
        const pendingUpdates = new Map();
        const pendingRemoves = new Set();
        let partnerName = ui.clipboard;
        let trayOpen = false;
        let drawing = null;
        let claimedPointerId = null;
        let suppressReviewClick = false;
        let suppressReviewClickTimer = null;
        const claimReviewClick = () => {
            if (suppressReviewClickTimer !== null) clearTimeout(suppressReviewClickTimer);
            suppressReviewClickTimer = null;
            suppressReviewClick = true;
        };
        const releaseReviewClick = () => {
            if (suppressReviewClickTimer !== null) clearTimeout(suppressReviewClickTimer);
            suppressReviewClickTimer = setTimeout(() => {
                suppressReviewClick = false;
                suppressReviewClickTimer = null;
            }, 0);
        };
        let rangeStart = null;
        let rangeStartFrame = null;
        let trimTail = Promise.resolve();
        const waitForState = predicate => new Promise(resolve => {
            const timer = setTimeout(() => { stateWaiters.delete(done); resolve(false); }, 5000);
            const done = () => { if (predicate()) { clearTimeout(timer); stateWaiters.delete(done); resolve(true); } };
            stateWaiters.add(done);
        });
        const stateWaiters = new Set();
        const markIndex = id => marks.findIndex(item => item.kind === 'review' && item.review.id === id);
        const requestUpdate = (index, review) => {
            const id = review.id;
            if (!id || index < 0 || pendingRemoves.has(id)) return;
            marks[index] = { ...marks[index], review };
            pendingUpdates.set(id, { review, lastIndex: index });
            post({ type: 'akari-preview-chat-review-update', index, id, review });
            render();
        };
        const trim = limit => {
            trimTail = trimTail.catch(() => undefined).then(async () => {
                for (let attempt = 0; attempt < 100; attempt++) {
                    const index = thumbnailEviction(marks, limit);
                    if (index < 0) break;
                    const review = { ...marks[index].review, thumbnail: undefined };
                    const updated = waitForState(() => !pendingUpdates.has(review.id));
                    requestUpdate(index, review);
                    if (!await updated) break;
                }
            });
            return trimTail;
        };
        const root = document.createElement('div');
        root.id = 'review-chat-layer';
        root.innerHTML = '<svg data-review-ink viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg><div data-review-marks></div>';
        stage.append(root);
        const contentRect = () => (document.getElementById('pen-layer') || stage).getBoundingClientRect();
        const syncContentRect = () => {
            const outer = stage.getBoundingClientRect();
            const content = contentRect();
            root.style.inset = 'auto';
            root.style.left = (content.left - outer.left) + 'px';
            root.style.top = (content.top - outer.top) + 'px';
            root.style.width = content.width + 'px';
            root.style.height = content.height + 'px';
        };
        const ink = root.querySelector('[data-review-ink]');
        const marksNode = root.querySelector('[data-review-marks]');
        const toolbar = document.createElement('div');
        toolbar.className = 'review-toolbar';
        toolbar.innerHTML = '<span data-review-hint hidden></span><div class="review-tools"><button type="button" class="icon-button" data-review-tool="pen" title="__AKARI_UI_pen__" aria-label="__AKARI_UI_pen__" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-1 5 5-1L19.5 8.5a2.12 2.12 0 0 0-3-3zM14.8 7.2l2 2M4 16l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg></button><button type="button" class="icon-button" data-review-tool="pin" title="__AKARI_UI_pin__" aria-label="__AKARI_UI_pin__" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-7.1 7-13a7 7 0 1 0-14 0c0 5.9 7 13 7 13Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="9" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg></button><button type="button" class="icon-button" data-review-tool="range" title="__AKARI_UI_range__" aria-label="__AKARI_UI_range__" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6v12m16-12v12M5 12h14m-11-3-3 3 3 3m8-6 3 3-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><span id="review-range-controls" hidden><button type="button" data-review-range-start>__AKARI_UI_start__</button><button type="button" data-review-range-end>__AKARI_UI_end__</button></span><span class="review-divider" aria-hidden="true"></span><button type="button" class="icon-button" data-review-attach-count="0" title="__AKARI_UI_attachZero__" aria-label="__AKARI_UI_attachZero__" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 12.5 6.5-6.5a3.5 3.5 0 0 1 5 5l-9 9a5 5 0 0 1-7-7l9.5-9.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span data-review-attach-number>0</span></button></div>'.replace(/__AKARI_UI_(\\w+)__/g, (_, key) => ui[key] ?? '');
        const controls = transport.querySelector('.transport-controls');
        const tail = transport.querySelector('.transport-tail');
        if (tail) tail.append(toolbar);
        else controls.after(toolbar);
        const hint = toolbar.querySelector('[data-review-hint]');
        const buttons = toolbar.querySelector('.review-tools');
        const rangeControls = toolbar.querySelector('#review-range-controls');
        const attachButton = buttons.querySelector('[data-review-attach-count]');
        const dock = document.createElement('div');
        dock.id = 'review-dock';
        dock.hidden = true;
        dock.innerHTML = '<div data-review-note hidden><div class="review-note-line"><div class="review-note-meta"><span data-review-note-badge></span><span data-review-note-tool></span><span data-review-note-time></span></div><textarea data-review-memo placeholder="__AKARI_UI_memoPlaceholder__" rows="2"></textarea><div class="review-note-actions"><button type="button" class="icon-button" data-review-delete title="__AKARI_UI_delete__" aria-label="__AKARI_UI_delete__"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v6m4-6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button type="button" class="icon-button" data-review-done title="__AKARI_UI_done__" aria-label="__AKARI_UI_done__"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 5 5L20 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></div><div data-review-elements hidden></div></div><div id="review-chat-tray" hidden><div data-review-rows></div><div class="review-tray-actions"><button type="button" data-review-send>__AKARI_UI_copyToClipboard__</button></div></div>'.replace(/__AKARI_UI_(\\w+)__/g, (_, key) => ui[key] ?? '');
        controls.after(dock);
        const note = dock.querySelector('[data-review-note]');
        const elementsNode = note.querySelector('[data-review-elements]');
        const noteBadge = note.querySelector('[data-review-note-badge]');
        const noteTool = note.querySelector('[data-review-note-tool]');
        const noteTime = note.querySelector('[data-review-note-time]');
        const memo = note.querySelector('[data-review-memo]');
        const tray = dock.querySelector('#review-chat-tray');
        const sendButton = tray.querySelector('[data-review-send]');
        const seekMarks = document.createElement('div');
        seekMarks.id = 'review-seek-marks';
        document.querySelector('.transport-seek')?.append(seekMarks);
        const setBadgeActive = (badge, time) => {
            const active = Math.abs(Number(badge.dataset.reviewTime) - time) <= 1.5;
            badge.style.opacity = active ? '1' : '.25';
            badge.querySelector('[data-review-badge]')?.toggleAttribute('data-review-active', active);
            if (badge.hasAttribute('data-review-badge')) badge.toggleAttribute('data-review-active', active);
        };
        const render = () => {
            syncContentRect();
            sendButton.textContent = partnerName === ui.clipboard ? ui.copyToClipboard : formatUi(ui.attachToPartner, { name: partnerName });
            attachButton.hidden = marks.length === 0;
            attachButton.dataset.reviewAttachCount = String(marks.length);
            attachButton.querySelector('[data-review-attach-number]').textContent = String(marks.length);
            attachButton.title = formatUi(marks.length === 1 ? ui.attachCountOne : ui.attachCountOther, { count: marks.length });
            attachButton.setAttribute('aria-label', attachButton.title);
            for (const button of buttons.querySelectorAll('[data-review-tool]')) {
                button.classList.toggle('on', button.dataset.reviewTool === tool);
                button.setAttribute('aria-pressed', String(button.dataset.reviewTool === tool));
            }
            root.classList.toggle('is-active', Boolean(tool));
            rangeControls.hidden = tool !== 'range';
            hint.hidden = !tool;
            hint.textContent = tool === 'pen' ? ui.penHint
                : tool === 'pin' ? ui.pinHint
                : tool === 'range' ? (rangeStart === null ? ui.rangeStartHint : ui.rangeEndHint) : '';
            if (activeNote) tray.hidden = true;
            else note.hidden = true;
            note.hidden = !activeNote;
            tray.hidden = !trayOpen || marks.length === 0 || Boolean(activeNote);
            dock.hidden = note.hidden && tray.hidden;
            elementsNode.replaceChildren();
            if (activeNote) {
                const index = markIndex(activeNote.id);
                const review = marks[index]?.review;
                note.dataset.reviewNoteIndex = String(index);
                noteBadge.textContent = String(index + 1);
                noteTool.dataset.reviewNoteTool = review.tool;
                noteTool.innerHTML = buttons.querySelector('[data-review-tool="' + review.tool + '"] svg').outerHTML;
                noteTime.textContent = clock(review.time) + (review.timeEnd === undefined ? '' : '〜' + clock(review.timeEnd));
                elementsNode.hidden = !review.elements?.length;
                for (const label of review.elements || []) {
                    const item = document.createElement('span');
                    item.dataset.reviewElement = '';
                    item.textContent = label;
                    elementsNode.append(item);
                }
            } else delete note.dataset.reviewNoteIndex;
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
                const strokePoints = mark.tool === 'pen' && Array.isArray(mark.points)
                    ? mark.points.filter(point => Array.isArray(point) && point.length === 2
                        && point.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) : [];
                if (strokePoints.length >= 2) {
                    const stroke = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    stroke.classList.add('review-mark-stroke');
                    stroke.setAttribute('viewBox', '0 0 100 100');
                    stroke.setAttribute('preserveAspectRatio', 'none');
                    stroke.dataset.reviewTime = String(mark.time);
                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                    line.setAttribute('points', strokePoints.map(point =>
                        (point[0] * 100) + ',' + (point[1] * 100)).join(' '));
                    stroke.append(line);
                    setBadgeActive(stroke, currentTime());
                    marksNode.append(stroke);
                    const badge = document.createElement('span');
                    badge.className = 'review-mark pen-point';
                    badge.dataset.reviewIndex = String(index);
                    badge.dataset.reviewTime = String(mark.time);
                    badge.dataset.reviewBadge = String(index);
                    badge.textContent = String(index + 1);
                    badge.style.left = (strokePoints[0][0] * 100) + '%';
                    badge.style.top = (strokePoints[0][1] * 100) + '%';
                    setBadgeActive(badge, currentTime());
                    marksNode.append(badge);
                    continue;
                }
                if (!mark.shape) continue;
                const badge = document.createElement('span');
                badge.className = 'review-mark ' + mark.tool;
                badge.dataset.reviewIndex = String(index);
                badge.dataset.reviewTime = String(mark.time);
                badge.style.left = (mark.shape.x * 100) + '%';
                badge.style.top = (mark.shape.y * 100) + '%';
                if (mark.tool === 'pen') {
                    badge.style.width = (Math.max(mark.shape.w || 0, .025) * 100) + '%';
                    badge.style.height = (Math.max(mark.shape.h || 0, .025) * 100) + '%';
                    const chip = document.createElement('span');
                    chip.dataset.reviewBadge = String(index);
                    chip.textContent = String(index + 1);
                    badge.append(chip);
                } else {
                    badge.dataset.reviewBadge = String(index);
                    badge.textContent = String(index + 1);
                }
                setBadgeActive(badge, currentTime());
                marksNode.append(badge);
            }
            const rows = tray.querySelector('[data-review-rows]');
            rows.replaceChildren();
            marks.forEach((item, index) => {
                const row = document.createElement('div');
                row.dataset.reviewRow = String(index);
                row.className = 'review-tray-row';
                const badge = document.createElement('span');
                badge.className = 'review-row-badge';
                badge.textContent = String(index + 1);
                row.append(badge);
                if (item.review.thumbnail) {
                    const thumb = document.createElement('img');
                    thumb.src = item.review.thumbnail;
                    thumb.alt = '';
                    row.append(thumb);
                }
                const content = document.createElement('span');
                content.className = 'review-row-text';
                content.textContent = item.review.sourceLabel + ui.separator + clock(item.review.time)
                    + (item.review.timeEnd === undefined ? '' : '〜' + clock(item.review.timeEnd))
                    + ui.separator + ({ pen: ui.pen, pin: ui.pin, range: ui.range })[item.review.tool]
                    + ' — ';
                const memoText = document.createElement('span');
                memoText.textContent = item.review.text || ui.noMemo;
                if (!item.review.text) memoText.className = 'review-empty-memo';
                content.append(memoText);
                row.append(content);
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.dataset.reviewRemove = String(index);
                remove.setAttribute('aria-label', ui.remove);
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
        const saveNote = close => {
            if (!activeNote) return true;
            const index = markIndex(activeNote.id);
            if (index < 0) { activeNote = null; render(); return true; }
            if (marks[index].review.annotationId) {
                memo.value = marks[index].review.text;
                if (close) { activeNote = null; render(); }
                return true;
            }
            const review = { ...marks[index].review, text: memo.value.trim() };
            const candidate = { ...marks[index], review };
            const size = item => new TextEncoder().encode(JSON.stringify(item)).byteLength;
            if (size(candidate) > 64 * 1024) review.thumbnail = undefined;
            if (size(candidate) > 64 * 1024) {
                memo.setCustomValidity(ui.memoTooLong);
                memo.reportValidity();
                return false;
            }
            memo.setCustomValidity('');
            if (review.text !== activeNote.savedText || review.thumbnail !== marks[index].review.thumbnail || (close && activeNote.fresh)) {
                requestUpdate(index, review);
                activeNote.savedText = review.text;
            }
            if (close) { activeNote = null; render(); }
            return true;
        };
        const removeMark = index => {
            const item = marks[index];
            if (!item || item.kind !== 'review') return;
            const id = item.review.id;
            if (activeNote?.id === id) activeNote = null;
            pendingAdds.delete(id);
            pendingUpdates.delete(id);
            pendingRemoves.add(id);
            marks.splice(index, 1);
            post({ type: 'akari-preview-chat-review-remove', index, id });
            if (marks.length === 0) trayOpen = false;
            render();
        };
        const openNote = (index, fresh = false) => {
            const item = marks[index];
            if (!item || item.kind !== 'review') return;
            if (activeNote && activeNote.id !== item.review.id && !saveNote(true)) return;
            trayOpen = false;
            tray.hidden = true;
            const end = item.review.timeEnd ?? item.review.time;
            if (!fresh && (currentTime() < item.review.time - 1.5 || currentTime() > end + 1.5)) {
                seek.value = String(item.review.time);
                seek.dispatchEvent(new Event('input', { bubbles: true }));
            }
            activeNote = { id: item.review.id, savedText: item.review.text, fresh };
            memo.value = item.review.text;
            memo.readOnly = Boolean(item.review.annotationId);
            render();
            memo.focus();
            memo.setSelectionRange(memo.value.length, memo.value.length);
        };
        const beginNote = (kind, time, shape, clientX, clientY, points, frame) => {
            if (activeNote && !saveNote(true)) return;
            const at = frame || frameAt();
            const endFrame = kind === 'range' ? frameAt() : null;
            if (endFrame && endFrame.sourceT === at.sourceT) return;
            const point = shape ? { x: shape.x + (shape.w || 0) / 2, y: shape.y + (shape.h || 0) / 2 } : { x: .5, y: .5 };
            const stageRect = contentRect();
            const hit = kind === 'pen' && shape
                ? { kind: 'rect', left: stageRect.left + shape.x * stageRect.width,
                    top: stageRect.top + shape.y * stageRect.height,
                    right: stageRect.left + (shape.x + (shape.w || 0)) * stageRect.width,
                    bottom: stageRect.top + (shape.y + (shape.h || 0)) * stageRect.height }
                : Number.isFinite(clientX) && Number.isFinite(clientY)
                    ? { kind: 'point', x: clientX, y: clientY } : null;
            const domLabels = initial.kind === 'output' && hit ? captionLabelsAt(captionLines(), hit, attachmentUi) : [];
            const elements = initial.kind === 'output'
                ? [...new Set([...domLabels, ...elementsAt({ ...initial.summary, captions: window.akari?.previewCaptions || initial.captions }, time, point, attachmentUi)])]
                : [];
            const review = { id: crypto.randomUUID(), tool: kind, source, sourceLabel, time,
                sourceT: at.sourceT, cutIndex: at.cutIndex, ...(at.src ? { src: at.src } : {}),
                ...(points?.length ? { points } : {}),
                ...(kind === 'range' ? { timeEnd: currentTime() } : {}),
                ...(endFrame ? { sourceRange: [Math.min(at.sourceT, endFrame.sourceT),
                    Math.max(at.sourceT, endFrame.sourceT)] } : {}),
                ...(shape ? { shape } : {}), elements, text: '', thumbnail: thumbnail() };
            const item = { kind: 'review', label: formatUi(ui.reviewLabel, { sourceLabel: review.sourceLabel, time: review.time.toFixed(1) }), review };
            if (new TextEncoder().encode(JSON.stringify(item)).byteLength > 64 * 1024) review.thumbnail = undefined;
            marks.push(item);
            pendingAdds.set(review.id, item);
            post({ type: 'akari-preview-chat-review-add', review });
            openNote(marks.length - 1, true);
            if (kind === 'range') { rangeStart = null; rangeStartFrame = null; }
            void trim(50);
        };
        buttons.addEventListener('click', event => {
            const picked = event.target.closest('[data-review-tool]');
            if (picked) {
                if (activeNote && !saveNote(true)) return;
                tool = tool === picked.dataset.reviewTool ? null : picked.dataset.reviewTool;
                rangeStart = tool === 'range' ? currentTime() : null;
                rangeStartFrame = tool === 'range' ? frameAt() : null;
                render();
            } else if (event.target.closest('[data-review-attach-count]')) {
                if (activeNote && !saveNote(true)) return;
                note.hidden = true;
                trayOpen = !trayOpen;
                render();
            }
        });
        rangeControls.addEventListener('click', event => {
            if (event.target.closest('[data-review-range-start]')) {
                rangeStart = currentTime(); rangeStartFrame = frameAt(); render();
            } else if (event.target.closest('[data-review-range-end]')) {
                beginNote('range', rangeStart ?? currentTime(), undefined, undefined, undefined, undefined, rangeStartFrame);
            }
        });
        window.addEventListener('pointerdown', event => {
            const badge = event.target.closest?.('[data-review-badge][data-review-active]');
            if (badge && marksNode.contains(badge) && event.button === 0) {
                event.preventDefault(); event.stopImmediatePropagation();
                claimedPointerId = event.pointerId;
                claimReviewClick();
                openNote(Number(badge.dataset.reviewBadge));
                return;
            }
            if (!tool || event.button !== 0 || !stage.contains(event.target)) return;
            event.preventDefault(); event.stopImmediatePropagation();
            claimedPointerId = event.pointerId;
            claimReviewClick();
            const rect = contentRect();
            const point = normalizePoint(event.clientX, event.clientY, rect);
            if (tool === 'pin') { beginNote('pin', currentTime(), point, event.clientX, event.clientY); return; }
            if (tool === 'range') { beginNote('range', rangeStart ?? currentTime(), undefined, event.clientX, event.clientY, undefined, rangeStartFrame); return; }
            const frame = frameAt();
            const recording = window.akari?.previewReviewState?.();
            const recordingStroke = recording?.recording === true && recording.playing === false;
            if (recordingStroke) window.akari?.reviewStrokeStart?.({ timelineT: frame.timelineT,
                sourceT: frame.sourceT, cutIndex: frame.cutIndex,
                ...(frame.itemId ? { itemId: frame.itemId } : {}),
                ...(frame.trackId ? { trackId: frame.trackId } : {}) });
            drawing = { pointerId: event.pointerId, points: [point], time: currentTime(), rect,
                x: event.clientX, y: event.clientY, frame, recordingStroke };
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
            releaseReviewClick();
            event.preventDefault(); event.stopImmediatePropagation();
            if (!drawing) return;
            const done = drawing; drawing = null;
            ink.replaceChildren();
            const endpoint = normalizePoint(event.clientX, event.clientY, done.rect);
            if (endpoint.x !== done.points[done.points.length - 1].x
                || endpoint.y !== done.points[done.points.length - 1].y) done.points.push(endpoint);
            const points = done.points.map(point => [point.x, point.y]);
            if (done.recordingStroke) {
                if (points.length >= 2) window.akari?.reviewStrokeEnd?.(points);
                return;
            }
            if (points.length === 1) points.push([Math.min(1, points[0][0] + .001), points[0][1]]);
            if (points.length > 100) {
                const sampled = Array.from({ length: 100 }, (_, index) =>
                    points[Math.round(index * (points.length - 1) / 99)]);
                points.splice(0, points.length, ...sampled);
            }
            const shape = boxFromPoints(done.points);
            if (shape && done.points.length === 1) {
                shape.x = Math.max(0, shape.x - .035); shape.y = Math.max(0, shape.y - .035);
                shape.w = .07; shape.h = .07;
            }
            beginNote('pen', done.time, shape, done.x, done.y, points, done.frame);
        }, true);
        window.addEventListener('pointercancel', event => {
            if (claimedPointerId !== event.pointerId) return;
            claimedPointerId = null;
            suppressReviewClick = false;
            if (suppressReviewClickTimer !== null) clearTimeout(suppressReviewClickTimer);
            suppressReviewClickTimer = null;
            drawing = null;
            ink.replaceChildren();
            event.preventDefault(); event.stopImmediatePropagation();
        }, true);
        window.addEventListener('click', event => {
            if (!suppressReviewClick) return;
            suppressReviewClick = false;
            if (suppressReviewClickTimer !== null) clearTimeout(suppressReviewClickTimer);
            suppressReviewClickTimer = null;
            event.preventDefault(); event.stopImmediatePropagation();
        }, true);
        note.querySelector('[data-review-done]').addEventListener('click', () => { saveNote(true); });
        note.querySelector('[data-review-delete]').addEventListener('click', () => {
            if (activeNote) removeMark(markIndex(activeNote.id));
        });
        memo.addEventListener('blur', () => { if (activeNote) saveNote(false); });
        tray.addEventListener('click', event => {
            const remove = event.target.closest('[data-review-remove]');
            if (remove) removeMark(Number(remove.dataset.reviewRemove));
            else if (event.target.closest('[data-review-send]')) post({ type: 'akari-preview-chat-review-attach' });
            else {
                const row = event.target.closest('[data-review-row]');
                if (row) openNote(Number(row.dataset.reviewRow));
            }
        });
        seek.addEventListener('pointerdown', () => { if (tool === 'range') { rangeStart = currentTime(); rangeStartFrame = frameAt(); } });
        seek.addEventListener('pointerup', () => { if (tool === 'range' && rangeStart !== null && currentTime() !== rangeStart)
            beginNote('range', rangeStart, undefined, undefined, undefined, undefined, rangeStartFrame); });
        seek.addEventListener('input', render);
        const escapeOne = event => {
            const step = escapeStep({ noteOpen: Boolean(activeNote), trayOpen, tool,
                isComposing: event.isComposing, keyCode: event.keyCode });
            if (step === 'note') {
                if (activeNote.fresh && !memo.value.trim()) removeMark(markIndex(activeNote.id));
                else saveNote(true);
            } else if (step === 'tray') { trayOpen = false; render(); }
            else if (step === 'tool') { tool = null; rangeStart = null; render(); }
            return Boolean(step);
        };
        const memoKeys = new Set();
        window.addEventListener('keydown', event => {
            const inMemo = event.target === memo;
            if (inMemo) memoKeys.add(event.code || event.key);
            if (event.key === 'Escape' && (inMemo || activeNote || trayOpen || tool)) {
                event.stopImmediatePropagation();
                if (!event.isComposing && event.keyCode !== 229) {
                    event.preventDefault();
                    escapeOne(event);
                }
                return;
            }
            if (!inMemo) return;
            const action = enterAction(event);
            if (action === 'save') {
                event.preventDefault();
                saveNote(true);
            }
            event.stopImmediatePropagation();
        }, true);
        for (const type of ['keypress', 'keyup']) {
            window.addEventListener(type, event => {
                const key = event.code || event.key;
                if (event.target !== memo && !memoKeys.has(key)) return;
                event.stopImmediatePropagation();
                if (type === 'keyup') memoKeys.delete(key);
            }, true);
        }
        window.addEventListener('message', event => {
            if (event.data?.type !== 'akari-preview-chat-review-state') return;
            if (Array.isArray(event.data.attachments)) {
                const received = event.data.attachments;
                const present = new Set(received.filter(item => item.kind === 'review').map(item => item.review.id));
                for (const id of pendingAdds.keys()) if (present.has(id)) pendingAdds.delete(id);
                for (const id of pendingRemoves) if (!present.has(id)) pendingRemoves.delete(id);
                marks = received.filter(item => item.kind !== 'review' || !pendingRemoves.has(item.review.id));
                for (const [id, item] of pendingAdds) if (!present.has(id) && !pendingRemoves.has(id)) marks.push(item);
                for (const [id, pending] of pendingUpdates) {
                    const index = markIndex(id);
                    if (index < 0) { pendingUpdates.delete(id); continue; }
                    if (JSON.stringify(marks[index].review) === JSON.stringify(pending.review)
                        || (marks[index].review.annotationId && marks[index].review.text === pending.review.text)) {
                        pendingUpdates.delete(id);
                    } else {
                        marks[index] = { ...marks[index], review: pending.review };
                        if (index !== pending.lastIndex) {
                            pending.lastIndex = index;
                            post({ type: 'akari-preview-chat-review-update', index, id, review: pending.review });
                        }
                    }
                }
                if (activeNote && markIndex(activeNote.id) < 0) activeNote = null;
                if (activeNote) memo.readOnly = Boolean(marks[markIndex(activeNote.id)]?.review.annotationId);
            }
            partnerName = typeof event.data.partnerName === 'string' && /\\S/.test(event.data.partnerName)
                ? event.data.partnerName : ui.clipboard;
            for (const done of [...stateWaiters]) done();
            if (marks.length === 0) trayOpen = false;
            render();
        });
        setInterval(() => {
            const time = currentTime();
            for (const badge of marksNode.querySelectorAll('[data-review-time]')) {
                setBadgeActive(badge, time);
            }
        }, 250);
        post({ type: 'akari-preview-chat-review-load' });
        setTimeout(() => post({ type: 'akari-preview-chat-review-load' }), 700);
        render();
    })();`;
}
