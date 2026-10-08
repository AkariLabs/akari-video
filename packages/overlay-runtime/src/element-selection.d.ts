export declare function elementAddress(root: Element, element: Element): string | null;
export interface SelectionBounds { left: number; top: number; right: number; bottom: number; width: number; height: number }
export declare function drawsSelectionContent(element: Element, style?: CSSStyleDeclaration): boolean;
export declare function selectionContentBounds(element: Element, options?: {
  container?: Element;
  visibleRect?: (rect: DOMRect, element: Element) => SelectionBounds | null;
  rawRect?: (element: Element) => DOMRect;
}): SelectionBounds | null;
export declare function isSelectionContainer(element: Element): boolean;
export declare function selectableContainer(root: Element, element: Element, outputRect: DOMRect | undefined, bounds: SelectionBounds | null, options?: SelectionOptions): boolean;
export interface SelectionOptions { boundsFor?: (element: Element) => SelectionBounds | null }
export declare function selectableElement(root: Element, element: Element, outputRect?: DOMRect, options?: SelectionOptions): boolean;
export declare function nearestSelectableElement(root: Element, hit: Element, outputRect?: DOMRect, options?: SelectionOptions): Element | null;
export declare function firstSelectableElement(root: Element, outputRect?: DOMRect, options?: SelectionOptions): Element | null;
export declare function elementByAddress(root: Element, ref: string): Element | null;
export declare function elementLabel(root: Element, element: Element): string;
