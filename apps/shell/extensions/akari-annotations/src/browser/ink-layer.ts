import {
    addObject, deleteObject, decimatePoints, duplicateObject, hitTest, INK_PALETTE, InkAspect, InkDocument,
    InkObject, InkPoint, moveObject, nextId, setColor as recolor, setText as rewriteText
} from '../common/ink-model';
import { inkToSvg } from './ink-render';

export type InkTool = 'select' | 'pen' | 'arrow' | 'text';
export interface InkLayerOptions { host: HTMLElement; aspect: InkAspect; now?: () => number; readOnly?: boolean }
type DocumentListener = (doc: InkDocument) => void;
type SelectionListener = (id: string | null) => void;
interface Gesture { pointerId: number; start: InkPoint; recT: number; points: InkPoint[]; selectedId: string | null; before: InkDocument; moved: boolean }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const clamp = (n: number): number => Math.max(0, Math.min(1, n));

export class InkLayer {
    private readonly host: HTMLElement;
    private readonly surface: HTMLDivElement;
    private readonly aspect: InkAspect;
    private readonly now: () => number;
    private readonly readOnly: boolean;
    private readonly oldTabindex: string | null;
    private readonly oldPosition: string;
    private doc: InkDocument;
    private tool: InkTool = 'select';
    private color: string = INK_PALETTE[0];
    private selectedId: string | null = null;
    private gesture: Gesture | null = null;
    private textInput: HTMLInputElement | null = null;
    private finishTextInput: ((save: boolean) => void) | null = null;
    private past: InkDocument[] = [];
    private future: InkDocument[] = [];
    private readonly changes = new Set<DocumentListener>();
    private readonly selections = new Set<SelectionListener>();

    constructor({ host, aspect, now = () => 0, readOnly = false }: InkLayerOptions) {
        this.host = host; this.aspect = { ...aspect }; this.now = now; this.readOnly = readOnly;
        this.doc = { schema: 'akari.ink.v0', space: 'canvas-rect', aspect: { ...aspect }, objects: [] };
        this.oldTabindex = host.getAttribute('tabindex');
        this.oldPosition = host.style.position;
        if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
        host.setAttribute('tabindex', '0');
        this.surface = document.createElement('div');
        this.surface.style.position = 'absolute'; this.surface.style.inset = '0';
        this.surface.style.touchAction = 'none'; this.surface.style.userSelect = 'none';
        host.appendChild(this.surface);
        this.surface.addEventListener('pointerdown', this.pointerDown);
        this.surface.addEventListener('pointermove', this.pointerMove);
        this.surface.addEventListener('pointerup', this.pointerUp);
        this.surface.addEventListener('pointercancel', this.pointerCancel);
        host.addEventListener('keydown', this.keyDown);
        this.render();
    }

    getDocument(): InkDocument { return clone(this.doc); }
    setDocument(doc: InkDocument): void {
        this.doc = clone(doc); this.past = []; this.future = []; this.select(null); this.render(); this.emitChange();
    }
    getTool(): InkTool { return this.tool; }
    setTool(tool: InkTool): void {
        if (this.readOnly || !(['select', 'pen', 'arrow', 'text'] as string[]).includes(tool)) return;
        this.finishText(); this.tool = tool; this.render();
    }
    getColor(): string { return this.color; }
    setColor(color: string): void {
        if (this.readOnly || !INK_PALETTE.includes(color as typeof INK_PALETTE[number])) return;
        this.color = color;
        if (this.selectedId) this.commit(recolor(this.doc, this.selectedId, color));
    }
    setText(text: string): void {
        if (!this.readOnly && this.selectedId) this.commit(rewriteText(this.doc, this.selectedId, text));
    }
    getSelectedId(): string | null { return this.selectedId; }
    onChange(listener: DocumentListener): () => void { this.changes.add(listener); return () => this.changes.delete(listener); }
    onSelectionChange(listener: SelectionListener): () => void { this.selections.add(listener); return () => this.selections.delete(listener); }
    deleteSelected(): void {
        if (this.readOnly || !this.selectedId) return;
        this.commit(deleteObject(this.doc, this.selectedId)); this.select(null);
    }
    duplicateSelected(): void {
        if (this.readOnly || !this.selectedId) return;
        const id = nextId(this.doc);
        this.commit(duplicateObject(this.doc, this.selectedId)); this.select(id);
    }
    undo(): void {
        if (this.readOnly || !this.past.length) return;
        this.future.push(clone(this.doc)); this.doc = this.past.pop()!;
        if (this.selectedId && !this.doc.objects.some(obj => obj.id === this.selectedId)) this.select(null);
        this.render(); this.emitChange();
    }
    redo(): void {
        if (this.readOnly || !this.future.length) return;
        this.past.push(clone(this.doc)); this.doc = this.future.pop()!;
        this.render(); this.emitChange();
    }
    dispose(): void {
        this.finishText(false);
        this.surface.removeEventListener('pointerdown', this.pointerDown);
        this.surface.removeEventListener('pointermove', this.pointerMove);
        this.surface.removeEventListener('pointerup', this.pointerUp);
        this.surface.removeEventListener('pointercancel', this.pointerCancel);
        this.host.removeEventListener('keydown', this.keyDown);
        this.surface.remove();
        if (this.oldTabindex === null) this.host.removeAttribute('tabindex'); else this.host.setAttribute('tabindex', this.oldTabindex);
        this.host.style.position = this.oldPosition;
        this.changes.clear(); this.selections.clear();
    }

    private select(id: string | null): void {
        if (this.selectedId === id) return;
        this.selectedId = id; this.render();
        for (const listener of this.selections) listener(id);
    }
    private emitChange(): void { for (const listener of this.changes) listener(this.getDocument()); }
    private commit(next: InkDocument, before = this.doc): void {
        if (equal(before, next)) { this.render(); return; }
        this.past.push(clone(before)); if (this.past.length > 80) this.past.shift();
        this.future = []; this.doc = next; this.render(); this.emitChange();
    }
    private render(): void {
        const objects = [...this.doc.objects];
        if (this.gesture && this.tool === 'pen' && this.gesture.points.length >= 2) {
            const points = decimatePoints(this.gesture.points);
            objects.push({ id: '__draft__', type: 'pen', color: this.color, x: points[0][0], y: points[0][1], points, strokeWidth: 0.008 });
        } else if (this.gesture && this.tool === 'arrow' && this.gesture.points.length > 1) {
            const from = this.gesture.start; const to = this.gesture.points[this.gesture.points.length - 1];
            objects.push({ id: '__draft__', type: 'arrow', color: this.color, x: from[0], y: from[1], from, to, strokeWidth: 0.008 });
        }
        this.surface.innerHTML = inkToSvg({ ...this.doc, objects }, { width: this.aspect.w, height: this.aspect.h, selectedIds: this.selectedId ? [this.selectedId] : [] });
        const svg = this.surface.querySelector('svg');
        if (svg) { svg.style.width = '100%'; svg.style.height = '100%'; svg.style.display = 'block'; }
    }
    private position(event: PointerEvent): InkPoint {
        const rect = this.surface.getBoundingClientRect();
        return [clamp((event.clientX - rect.left) / rect.width), clamp((event.clientY - rect.top) / rect.height)];
    }
    private tolerance(): number {
        const rect = this.surface.getBoundingClientRect();
        return rect.height ? 7 / rect.height : 0.01;
    }
    private readonly pointerDown = (event: PointerEvent): void => {
        if (this.readOnly || this.gesture || event.button !== 0) return;
        this.host.focus();
        const start = this.position(event);
        if (this.tool === 'text') { this.startText(start); event.preventDefault(); return; }
        const selectedId = this.tool === 'select' ? hitTest(this.doc, start, this.tolerance()) : null;
        if (this.tool === 'select') this.select(selectedId);
        this.gesture = { pointerId: event.pointerId, start, recT: this.now(), points: [start], selectedId, before: clone(this.doc), moved: false };
        this.surface.setPointerCapture(event.pointerId);
        event.preventDefault();
    };
    private readonly pointerMove = (event: PointerEvent): void => {
        const gesture = this.gesture;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        const events = this.tool === 'pen' && event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
        for (const sample of events) {
            const p = this.position(sample);
            const last = gesture.points[gesture.points.length - 1];
            if (p[0] !== last[0] || p[1] !== last[1]) gesture.points.push(p);
        }
        const current = this.position(event);
        if (current[0] !== gesture.start[0] || current[1] !== gesture.start[1]) gesture.moved = true;
        if (this.tool === 'select' && gesture.selectedId) {
            this.doc = moveObject(gesture.before, gesture.selectedId, current[0] - gesture.start[0], current[1] - gesture.start[1]);
        }
        this.render(); event.preventDefault();
    };
    private readonly pointerUp = (event: PointerEvent): void => {
        const gesture = this.gesture;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        const end = this.position(event);
        const last = gesture.points[gesture.points.length - 1];
        if (end[0] !== last[0] || end[1] !== last[1]) gesture.points.push(end);
        if (this.tool === 'select' && gesture.selectedId) {
            this.doc = moveObject(gesture.before, gesture.selectedId, end[0] - gesture.start[0], end[1] - gesture.start[1]);
            gesture.moved ||= end[0] !== gesture.start[0] || end[1] !== gesture.start[1];
        }
        this.gesture = null;
        if (this.surface.hasPointerCapture(event.pointerId)) this.surface.releasePointerCapture(event.pointerId);
        if (this.tool === 'select') {
            if (gesture.selectedId && gesture.moved) this.commit(this.doc, gesture.before);
            else this.render();
        } else if (this.tool === 'pen' && gesture.points.length >= 2) {
            const points = decimatePoints(gesture.points);
            const obj: InkObject = { id: nextId(this.doc), type: 'pen', color: this.color, x: points[0][0], y: points[0][1], points, strokeWidth: 0.008, recT: [gesture.recT, this.now()] };
            this.commit(addObject(this.doc, obj));
        } else if (this.tool === 'arrow' && gesture.moved) {
            const obj: InkObject = { id: nextId(this.doc), type: 'arrow', color: this.color, x: gesture.start[0], y: gesture.start[1], from: gesture.start, to: end, strokeWidth: 0.008, recT: [gesture.recT, this.now()] };
            this.commit(addObject(this.doc, obj));
        } else this.render();
        event.preventDefault();
    };
    private readonly pointerCancel = (event: PointerEvent): void => {
        if (!this.gesture || this.gesture.pointerId !== event.pointerId) return;
        if (this.tool === 'select') this.doc = this.gesture.before;
        this.gesture = null; this.render();
    };
    private startText(at: InkPoint): void {
        this.finishText();
        const input = document.createElement('input');
        input.type = 'text'; input.setAttribute('aria-label', '文字');
        input.style.position = 'absolute'; input.style.left = `${at[0] * 100}%`; input.style.top = `${at[1] * 100}%`;
        input.style.color = this.color; input.style.background = 'var(--akari-editor-background)';
        input.style.borderColor = 'var(--akari-accent)'; input.style.fontSize = `${0.045 * this.surface.clientHeight}px`;
        this.host.appendChild(input); this.textInput = input;
        const started = this.now();
        const finish = (save: boolean): void => {
            if (this.textInput !== input) return;
            this.textInput = null; this.finishTextInput = null; input.remove();
            if (save && input.value.trim()) {
                const obj: InkObject = { id: nextId(this.doc), type: 'text', color: this.color, x: at[0], y: at[1], at, text: input.value, textHeight: 0.045, recT: [started, this.now()] };
                this.commit(addObject(this.doc, obj));
            }
            this.host.focus();
        };
        this.finishTextInput = finish;
        input.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); finish(true); }
            if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); finish(false); }
        });
        input.addEventListener('blur', () => finish(true));
        input.focus();
    }
    private finishText(save = true): void {
        this.finishTextInput?.(save);
    }
    private readonly keyDown = (event: KeyboardEvent): void => {
        if (this.readOnly || this.host !== document.activeElement || this.textInput) return;
        const key = event.key.toLowerCase();
        const mod = event.metaKey || event.ctrlKey;
        let handled = true;
        if (mod && key === 'z') { if (event.shiftKey) this.redo(); else this.undo(); }
        else if (mod && key === 'y') this.redo();
        else if (!mod && !event.altKey && key === 'v') this.setTool('select');
        else if (!mod && !event.altKey && key === 'p') this.setTool('pen');
        else if (!mod && !event.altKey && key === 'a') this.setTool('arrow');
        else if (!mod && !event.altKey && key === 't') this.setTool('text');
        else if (key === 'delete' || key === 'backspace') this.deleteSelected();
        else if (key === 'escape') { if (this.tool !== 'select') this.setTool('select'); else this.select(null); }
        else handled = false;
        if (handled) { event.preventDefault(); event.stopPropagation(); }
    };
}
