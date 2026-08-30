export interface HtmlPart { id: string; order: number }

export interface PartMaskOverrides {
  style?: Record<string, string>;
  text?: string;
}

export interface PartMaskResult { missing: boolean }

export interface OverlayRecord {
  id: string;
  html: string;
  start: number;
  duration: number;
  track?: number;
  transform?: { x?: number; y?: number; scale?: number; rotate?: number };
  opacity?: number;
  blend?: string;
  vars?: Record<string, string>;
  params?: Record<string, string>;
  part?: string;
  parentId?: string;
  [key: string]: unknown;
}

export function scanHtmlParts(htmlText: string): HtmlPart[];
export function projectBagChildren(bagItem: any, parts: readonly HtmlPart[]): any[];
export function applyPartMask(
  htmlText: string,
  partId: string,
  overrides?: PartMaskOverrides,
): [string, PartMaskResult];
export function expandBagOverlays(
  internal: any,
  readHtml?: (reference: string, item: any) => string,
): OverlayRecord[];
