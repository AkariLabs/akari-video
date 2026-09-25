import type { InspectorWriteRequest, InspectorWriteResult } from '../timeline-selection-model';
import { buildLutOptions } from './lut-options';
import { hitPhotoInstance } from './photo-instance-hit';
import { appendAdoptedRegion, photoPanelPlacement, regionDisplayName, togglePhotoCandidateSelection } from './photo-panel-state';

type Write = (request: InspectorWriteRequest) => Promise<InspectorWriteResult>;
type Candidate = NonNullable<InspectorWriteResult['photoCandidates']>[number];
interface PhotoPanelOptions {
    id: string;
    write: Write;
    mode: 'cutout' | 'regions';
    maskFeather?: number;
    regions?: readonly Record<string, any>[];
    adjust?: Record<string, any>;
}

const theme = {
    background: 'var(--theia-editor-background)',
    foreground: 'var(--theia-editor-foreground)',
    border: 'var(--theia-widget-border, var(--theia-contrastBorder))',
    button: 'var(--theia-button-background)'
};

/** The image editor stays in the inspector's editing flow; only candidate masks enter the project on adoption. */
export function openPhotoEditPanel(options: PhotoPanelOptions): void {
    const previous = document.getElementById('akari-photo-edit-panel');
    if (previous instanceof HTMLDialogElement && previous.open) previous.close();
    else previous?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'akari-photo-edit-panel';
    dialog.style.cssText = `color:${theme.foreground};background:${theme.background};border:1px solid ${theme.border};` +
        'border-radius:8px;padding:14px;max-height:calc(100vh - 96px);overflow:auto;box-shadow:0 8px 28px #0006;' +
        'position:fixed;z-index:12000;margin:0;box-sizing:border-box;max-width:calc(100vw - 24px)';
    const positionByInspector = (): void => {
        const inspector = document.querySelector('.akari-inspector-widget')?.getBoundingClientRect();
        const placement = photoPanelPlacement({ width: window.innerWidth, height: window.innerHeight }, inspector ?? undefined);
        dialog.style.width = `${placement.width}px`;
        dialog.style.left = `${placement.left}px`;
        dialog.style.right = 'auto';
        dialog.style.top = `${placement.top}px`;
    };
    positionByInspector();
    const heading = document.createElement('h2');
    heading.textContent = options.mode === 'cutout' ? '背景透過' : '写真を編集';
    heading.style.cssText = 'font-size:16px;margin:0 0 12px';
    dialog.append(heading);
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px';
    dialog.append(toolbar);
    const status = document.createElement('p');
    status.textContent = '写真の中から選んでください';
    status.style.cssText = 'min-height:1.4em;margin:7px 0';
    dialog.append(status);
    const list = document.createElement('div');
    list.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px';
    dialog.append(list);
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:12px';
    dialog.append(controls);
    let candidates: Candidate[] = [];
    const maskPixels = new Map<string, { width: number; height: number; pixels: Uint8Array; area: number }>();
    let selected = new Set<string>();
    let response: InspectorWriteResult | undefined;
    let invert = false;
    let closed = false;
    let selectingOnPreview = false;
    let queryEpoch = 0;
    let hoveredCandidateId: string | null = null;
    let lastHoverPoint: [number, number] | null = null;
    let showAdoptedRegion: ((region: Record<string, unknown>) => void) | undefined;
    const target: 'cutout' | 'region' = options.mode === 'cutout' ? 'cutout' : 'region';
    const button = (parent: HTMLElement, label: string, action: () => void | Promise<void>): HTMLButtonElement => {
        const element = document.createElement('button');
        element.type = 'button'; element.textContent = label;
        element.style.cssText = `background:${theme.button};color:var(--theia-button-foreground);` +
            'border:0;border-radius:5px;padding:6px 10px;cursor:pointer';
        element.onclick = () => { void action(); };
        parent.append(element);
        return element;
    };
    const write = (path: Extract<InspectorWriteRequest, { kind: 'item-field' }>['path'], value: unknown) =>
        options.write({ kind: 'item-field', id: options.id, path, value: value as never });
    const highlight = (id: string | null): void => {
        if (hoveredCandidateId === id) return;
        hoveredCandidateId = id;
        const candidate = candidates.find(value => value.id === id);
        window.dispatchEvent(new CustomEvent('akari.photo.highlight', { detail: {
            itemId: options.id, ...(candidate ? { png: candidate.png } : {})
        } }));
    };
    const hitCandidate = (point: [number, number]): string | null => hitPhotoInstance(point,
        candidates.flatMap(candidate => {
            const mask = maskPixels.get(candidate.id);
            return mask ? [{ id: candidate.id, ...mask, invert }] : [];
        }));
    const renderCandidates = (): void => {
        list.replaceChildren();
        for (const candidate of candidates) {
            const card = document.createElement('button');
            card.type = 'button';
            card.style.cssText = `border:2px solid ${selected.has(candidate.id) ? 'var(--theia-focusBorder)' : theme.border};` +
                `background:${theme.background};color:${theme.foreground};border-radius:6px;padding:5px;cursor:pointer`;
            const image = document.createElement('img');
            image.alt = candidate.label;
            image.style.cssText = 'display:block;width:100%;height:92px;object-fit:contain;background:repeating-conic-gradient(#7774 0 25%,transparent 0 50%) 0 0/12px 12px';
            const label = document.createElement('span'); label.textContent = candidate.label;
            card.append(image, label);
            card.onclick = () => { selected = togglePhotoCandidateSelection(selected, candidate.id); renderCandidates(); };
            card.onmouseenter = () => highlight(candidate.id);
            card.onmouseleave = () => highlight(null);
            image.onload = () => {
                if (closed) return;
                if (maskPixels.has(candidate.id)) return;
                const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
                const context = canvas.getContext('2d', { willReadFrequently: true });
                if (!context) return;
                context.drawImage(image, 0, 0);
                const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
                const pixels = new Uint8Array(canvas.width * canvas.height);
                let area = 0;
                for (let i = 0; i < pixels.length; i += 1) {
                    pixels[i] = rgba[i * 4]!;
                    if (pixels[i]! >= 128) area += 1;
                }
                maskPixels.set(candidate.id, { width: canvas.width, height: canvas.height, pixels, area });
                if (lastHoverPoint) highlight(hitCandidate(lastHoverPoint));
            };
            image.src = `data:image/png;base64,${candidate.png}`;
            list.append(card);
        }
    };
    const query = async (mode: 'foreground' | 'people' | 'click', point?: [number, number], append = false): Promise<void> => {
        const epoch = append ? queryEpoch : ++queryEpoch;
        status.textContent = mode === 'click' ? '写真を分けています… 初回はモデルを取得します' : '写真の中身を調べています…';
        const result = await write('photo-query', { mode, ...(point ? { x: point[0], y: point[1] } : {}) });
        if (closed || epoch !== queryEpoch) return;
        if (!result.ok || !result.photoCandidates) { status.textContent = result.message ?? 'この Mac では使えません'; return; }
        if (!append || response?.inputSha256 !== result.inputSha256 || response.photoRevision !== result.photoRevision) {
            highlight(null);
            candidates = []; selected = new Set();
        }
        if (append && response?.photoEngine !== result.photoEngine) selected = new Set();
        response = result;
        candidates.push(...result.photoCandidates);
        if (mode !== 'click') {
            const all = result.photoCandidates.find(candidate => candidate.id.endsWith('--all'));
            if (all) selected.add(all.id);
        }
        status.textContent = candidates.length ? '残すものを選んでください' : '見つかりませんでした';
        renderCandidates();
    };
    button(toolbar, '自動', () => { invert = false; void query('foreground'); });
    button(toolbar, '人物だけ', () => { invert = false; void query('people'); });
    button(toolbar, '人物以外', () => { invert = true; void query('people'); });
    if (options.mode === 'regions') button(toolbar, '背景', () => { invert = true; void query('foreground'); });
    button(toolbar, '写っているものを押す', async () => {
        invert = false;
        const result = await write('photo-select-toggle', null);
        selectingOnPreview = result.ok;
        status.textContent = result.ok ? 'プレビューの写真を押してください' : result.message ?? '使えません';
    });
    const onClick = (event: Event): void => {
        const detail = (event as CustomEvent<{ id: string; point: [number, number] }>).detail;
        if (!selectingOnPreview || detail?.id !== options.id || !Array.isArray(detail.point)) return;
        const hit = hitCandidate(detail.point);
        if (hit) {
            selected = togglePhotoCandidateSelection(selected, hit);
            highlight(hit);
            renderCandidates(); return;
        }
        void query('click', detail.point, true);
    };
    window.addEventListener('akari.photo.click', onClick);
    const onHover = (event: Event): void => {
        const detail = (event as CustomEvent<{ id: string; point: [number, number] | null }>).detail;
        if (!selectingOnPreview || detail?.id !== options.id) return;
        lastHoverPoint = Array.isArray(detail.point) ? detail.point : null;
        highlight(lastHoverPoint ? hitCandidate(lastHoverPoint) : null);
    };
    window.addEventListener('akari.photo.hover', onHover);
    const onEnd = (event: Event): void => {
        const detail = (event as CustomEvent<{ id: string }>).detail;
        if (detail?.id === options.id) dialog.close();
    };
    window.addEventListener('akari.photo.select-end', onEnd);
    button(controls, options.mode === 'cutout' ? '選んだものを残す' : '選んだエリアを追加', async () => {
        if (!response?.inputSha256 || !response.photoRevision || !response.photoEngine || selected.size === 0) {
            status.textContent = '候補を選んでください'; return;
        }
        const labels = candidates.filter(candidate => selected.has(candidate.id)).map(candidate => candidate.label);
        const name = invert ? '背景' : labels.length > 1 ? `${labels[0]} ほか` : labels[0] ?? 'エリア';
        const result = await write('photo-adopt', { candidates: [...selected], inputSha256: response.inputSha256,
            photoRevision: response.photoRevision, engine: response.photoEngine, target, invert, name });
        status.textContent = result.ok ? '適用しました' : result.message ?? '適用できませんでした';
        if (result.ok && options.mode === 'cutout') {
            selectingOnPreview = false;
            window.dispatchEvent(new CustomEvent('akari.photo.select-stop', { detail: { itemId: options.id } }));
            highlight(null);
        }
        if (result.ok && options.mode === 'regions' && result.photoRegion) {
            showAdoptedRegion?.(result.photoRegion);
            selectingOnPreview = false;
            window.dispatchEvent(new CustomEvent('akari.photo.select-stop', { detail: { itemId: options.id } }));
            highlight(null);
            candidates = []; selected = new Set(); response = undefined;
            renderCandidates();
        }
    });
    if (options.mode === 'cutout') {
        const smooth = document.createElement('label'); smooth.textContent = 'なめらかさ ';
        const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '100';
        slider.value = String(options.maskFeather ?? 0);
        slider.onchange = () => { void write('maskFeather', Number(slider.value)); };
        smooth.append(slider); controls.append(smooth);
        button(controls, '消しゴムで直す', async () => {
            const result = await write('photo-brush-toggle', { mode: 'erase', size: 0.05, hardness: 0.8 });
            if (result.ok) dialog.close(); else status.textContent = result.message ?? '使えません';
        });
    } else {
        const area = document.createElement('select');
        const add = (label: string, value: string): void => { const option = document.createElement('option'); option.textContent = label; option.value = value; area.append(option); };
        add('画像全体', 'all');
        (options.regions ?? []).forEach((region, index) => add(regionDisplayName(region as { id: string; name?: string }, index), String(index)));
        controls.append(area);
        const editor = document.createElement('div');
        editor.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px';
        dialog.append(editor);
        const updateRegion = async (key: string, value: unknown): Promise<InspectorWriteResult> => {
            const index = Number(area.value);
            const regions = (options.regions ?? []).map(region => ({ ...region }));
            const region = regions[index]; if (!region) return { ok: false, message: 'エリアが見つかりません' };
            if (key === 'enabled') region.enabled = value;
            else if (key === 'blur') region.blur = value;
            else if (key === 'filter') region.filter = value;
            else region.adjust = { ...(region.adjust ?? {}), basic: { ...(region.adjust?.basic ?? {}), [key]: value } };
            const result = await write('regions', regions);
            if (result.ok) options.regions = regions; else status.textContent = result.message ?? '変更できませんでした';
            return result;
        };
        const renderEditor = (): void => {
            editor.replaceChildren();
            const index = Number(area.value), region = (options.regions ?? [])[index];
            if (region) {
                const enabled = document.createElement('label'); enabled.textContent = 'このエリアを使う ';
                const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = region.enabled !== false;
                checkbox.onchange = () => { void updateRegion('enabled', checkbox.checked); };
                enabled.append(checkbox); editor.append(enabled);
                button(editor, 'エリアを消す', async () => {
                    const next = (options.regions ?? []).filter((_, i) => i !== index);
                    const result = await write('regions', next);
                    if (result.ok) { options.regions = next; area.options[index + 1]?.remove(); area.value = 'all'; renderEditor(); }
                });
            }
            for (const [key, label, min, max] of [
                ['exposure', '露出', -3, 3], ['contrast', 'コントラスト', -1, 1],
                ['saturation', '彩度', -1, 1], ['temperature', '色温度', -1, 1], ['blur', 'ぼかし', 0, 50]
            ] as const) {
                const field = document.createElement('label'); field.textContent = label;
                field.style.cssText = 'display:flex;flex-direction:column;gap:4px;min-width:0';
                const row = document.createElement('span'); row.style.cssText = 'display:flex;align-items:center;gap:6px';
                const slider = document.createElement('input'); slider.type = 'range'; slider.min = String(min); slider.max = String(max); slider.step = '0.05';
                slider.style.cssText = 'flex:1;min-width:0;accent-color:var(--theia-button-background)';
                const input = document.createElement('input'); input.type = 'number'; input.min = String(min); input.max = String(max); input.step = '0.05';
                input.value = String(key === 'blur'
                    ? region ? region.blur ?? 0 : options.adjust?.fx?.find((effect: { id: string }) => effect.id === 'blur')?.px ?? 0
                    : region ? region.adjust?.basic?.[key] ?? 0 : options.adjust?.basic?.[key] ?? 0);
                slider.value = input.value;
                input.style.cssText = `width:64px;background:${theme.background};color:${theme.foreground};border:1px solid ${theme.border};border-radius:4px`;
                const commit = async (): Promise<void> => {
                    const value = Number(input.value);
                    if (!Number.isFinite(value) || value < min || value > max) return;
                    const result = await (region ? updateRegion(key, value) : key === 'blur'
                        ? write('adjust.fx', [...(options.adjust?.fx ?? []).filter((effect: { id: string }) => effect.id !== 'blur'),
                            ...(value > 0 ? [{ id: 'blur', px: value }] : [])])
                        : write(`adjust.basic.${key}` as 'adjust.basic.exposure', value));
                    if (!region && result?.ok) {
                        if (key === 'blur') options.adjust = { ...(options.adjust ?? {}), fx: [
                            ...(options.adjust?.fx ?? []).filter((effect: { id: string }) => effect.id !== 'blur'),
                            ...(value > 0 ? [{ id: 'blur', px: value }] : [])
                        ] };
                        else options.adjust = { ...(options.adjust ?? {}), basic: { ...(options.adjust?.basic ?? {}), [key]: value } };
                    }
                };
                slider.oninput = () => { input.value = slider.value; };
                slider.onchange = () => { void commit(); };
                input.oninput = () => { slider.value = input.value; };
                input.onchange = () => { void commit(); };
                row.append(slider, input); field.append(row); editor.append(field);
            }
            const filter = document.createElement('label'); filter.textContent = 'フィルター ';
            const select = document.createElement('select');
            for (const option of buildLutOptions([])) {
                const item = document.createElement('option'); item.textContent = option.label; item.value = option.value ?? '';
                select.append(item);
            }
            select.value = region ? region.filter?.lut ?? '' : options.adjust?.lut?.lut ?? '';
            select.onchange = () => {
                void (region ? updateRegion('filter', select.value ? { lut: select.value, intensity: 1 } : undefined)
                    : write('adjust.lut.lut', select.value || null));
            };
            filter.append(select); editor.append(filter);
        };
        area.onchange = renderEditor;
        showAdoptedRegion = record => {
            const region = record as { id: string; name?: string; [key: string]: unknown };
            const added = appendAdoptedRegion((options.regions ?? []) as typeof region[], region);
            options.regions = added.regions;
            add(regionDisplayName(region, added.selectedIndex), String(added.selectedIndex));
            area.value = String(added.selectedIndex);
            renderEditor();
        };
        renderEditor();
    }
    button(controls, '閉じる', () => dialog.close());
    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') { event.preventDefault(); dialog.close(); }
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', positionByInspector);
    dialog.onclose = () => {
        closed = true;
        selectingOnPreview = false;
        window.dispatchEvent(new CustomEvent('akari.photo.select-stop', { detail: { itemId: options.id } }));
        highlight(null);
        window.removeEventListener('akari.photo.click', onClick);
        window.removeEventListener('akari.photo.hover', onHover);
        window.removeEventListener('akari.photo.select-end', onEnd);
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('resize', positionByInspector);
        dialog.remove();
    };
    document.body.append(dialog); dialog.show();
}
