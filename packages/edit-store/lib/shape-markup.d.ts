import { ShapeSourceV2 } from './edit-v2';
/** 図形語彙 v0 を、環境に依存しない 1 行のインライン SVG へ降下する。 */
export declare function shapeMarkup(source: ShapeSourceV2, itemId?: string, outputWidth?: number, transform?: {
    scale?: number;
    scaleX?: number;
    scaleY?: number;
}): string;
