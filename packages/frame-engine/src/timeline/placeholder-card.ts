import type { StillImageBitmap, StillImageSource } from '../types.js';

export interface PlaceholderCardText {
  defaultName: string;
  replaceHint: string;
}

export interface PlanPlaceholderCard {
  id: string;
  name: string;
  intent?: string;
  at: number;
  duration: number;
  track: number;
}

export function placeholderCardMetrics(width: number, height: number) {
  const short = Math.min(width, height);
  const inset = short * 0.048;
  return {
    inset,
    textWidth: width - inset * 3.5,
    titleSize: short * 0.09,
    titleLineHeight: short * 0.108,
    titleCenterY: height * 0.42,
    intentSize: short * 0.045,
    intentLineHeight: short * 0.0585,
    hintSize: short * 0.034,
    hintLineHeight: short * 0.0442,
    hintBottomY: height - inset * 2,
  };
}

interface GroupNode {
  id?: string;
  name?: string;
  hidden?: boolean;
  at?: number;
  duration?: number;
  source?: { kind?: string; canvas?: { origin?: string; intent?: string } };
  items?: GroupNode[];
}

/** Interpret v2 frame positions without changing the edit document. */
export function collectPlanPlaceholderCards(
  tracks: readonly { id?: string; lane?: string; hidden?: boolean; items?: GroupNode[] }[] | undefined,
  fps: number
): PlanPlaceholderCard[] {
  if (!tracks || !(fps > 0)) return [];
  const cards: PlanPlaceholderCard[] = [];
  tracks.forEach((track, index) => {
    if (track.lane !== 'visual' || track.hidden === true
      || /^playbook-placeholders-audio(?:-\d+)?$/.test(track.id ?? '')) return;
    const visit = (item: GroupNode, parentAt: number): void => {
      if (item.hidden === true) return;
      const at = parentAt + Number(item.at ?? 0);
      const children = Array.isArray(item.items) ? item.items : [];
      const hasContent = (node: GroupNode): boolean => node.hidden === true ? false : node.source?.kind !== 'group'
        || (node.items ?? []).some(hasContent);
      if (item.source?.kind === 'group' && item.source.canvas?.origin === 'plan'
        && !children.some(hasContent) && Number(item.duration) > 0) {
        cards.push({ id: String(item.id ?? ''), name: String(item.name ?? ''),
          ...(item.source.canvas.intent ? { intent: item.source.canvas.intent } : {}),
          at: at / fps, duration: Number(item.duration) / fps, track: index });
      }
      children.forEach(child => visit(child, at));
    };
    (track.items ?? []).forEach(item => visit(item, 0));
  });
  return cards;
}

function lines(context: CanvasRenderingContext2D, value: string, maxWidth: number, maxLines: number): string[] {
  const result: string[] = [];
  let line = '';
  for (const char of value) {
    if (char === '\n' || context.measureText(line + char).width > maxWidth && line) {
      result.push(line);
      line = char === '\n' ? '' : char;
    } else line += char;
  }
  if (line) result.push(line);
  if (result.length > maxLines) {
    const kept = result.slice(0, maxLines);
    while (kept[maxLines - 1] && context.measureText(`${kept[maxLines - 1]}…`).width > maxWidth) {
      kept[maxLines - 1] = kept[maxLines - 1]!.slice(0, -1);
    }
    kept[maxLines - 1] += '…';
    return kept;
  }
  return result;
}

export class PlaceholderCardSource implements StillImageSource {
  private image?: Promise<StillImageBitmap>;
  private readonly card: PlanPlaceholderCard;
  private readonly width: number;
  private readonly height: number;
  private readonly text: PlaceholderCardText;

  constructor(card: PlanPlaceholderCard, width: number, height: number, text: PlaceholderCardText) {
    this.card = card;
    this.width = width;
    this.height = height;
    this.text = text;
  }

  load(): Promise<StillImageBitmap> {
    if (!this.image) this.image = this.draw();
    return this.image;
  }

  destroy(): void {
    this.image?.then(image => image.bitmap.close(), () => {});
    this.image = undefined;
  }

  private async draw(): Promise<StillImageBitmap> {
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('placeholder card context unavailable');
    const metrics = placeholderCardMetrics(this.width, this.height);
    const short = Math.min(this.width, this.height);
    context.fillStyle = '#23262d';
    context.fillRect(0, 0, this.width, this.height);
    context.strokeStyle = 'rgba(255,255,255,0.055)';
    context.lineWidth = Math.max(1, short * 0.0015);
    const step = Math.max(24, short * 0.042);
    for (let x = -this.height; x < this.width; x += step) {
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x + this.height, this.height); context.stroke();
    }
    const { inset } = metrics;
    context.strokeStyle = 'rgba(255,255,255,0.18)';
    context.lineWidth = Math.max(2, short * 0.002);
    context.strokeRect(inset, inset, this.width - 2 * inset, this.height - 2 * inset);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `600 ${metrics.titleSize}px sans-serif`;
    const title = lines(context, this.card.name || this.text.defaultName, metrics.textWidth, 3);
    const titleTop = metrics.titleCenterY - (title.length - 1) * metrics.titleLineHeight / 2;
    context.fillStyle = '#f1f2f4';
    title.forEach((line, index) =>
      context.fillText(line, this.width / 2, titleTop + index * metrics.titleLineHeight));
    if (this.card.intent && this.card.intent !== this.card.name) {
      context.font = `400 ${metrics.intentSize}px sans-serif`;
      context.fillStyle = '#c1c5cd';
      const intentTop = titleTop + (title.length - 1) * metrics.titleLineHeight
        + metrics.titleLineHeight * 0.7 + metrics.intentLineHeight * 0.5;
      lines(context, this.card.intent, metrics.textWidth, 3).forEach((line, index) =>
        context.fillText(line, this.width / 2, intentTop + index * metrics.intentLineHeight));
    }
    context.font = `400 ${metrics.hintSize}px sans-serif`;
    context.fillStyle = '#a7adb7';
    const hint = lines(context, this.text.replaceHint, metrics.textWidth, 2);
    const hintTop = metrics.hintBottomY - (hint.length - 1) * metrics.hintLineHeight;
    hint.forEach((line, index) =>
      context.fillText(line, this.width / 2, hintTop + index * metrics.hintLineHeight));
    return { bitmap: await createImageBitmap(canvas), width: this.width, height: this.height };
  }
}

const cardSources = new Map<string, PlaceholderCardSource>();

export function placeholderCardSource(card: PlanPlaceholderCard, width: number, height: number,
  text: PlaceholderCardText): PlaceholderCardSource {
  const key = JSON.stringify([card.id, card.name, card.intent, width, height, text]);
  let source = cardSources.get(key);
  if (source) {
    cardSources.delete(key);
    cardSources.set(key, source);
  } else {
    source = new PlaceholderCardSource(card, width, height, text);
    cardSources.set(key, source);
    if (cardSources.size > 8) {
      const oldest = cardSources.keys().next().value;
      if (oldest !== undefined) {
        cardSources.get(oldest)?.destroy();
        cardSources.delete(oldest);
      }
    }
  }
  return source;
}
