export type Point = [number, number];
export type PathSegment = {
    t: 'L';
    p: Point;
} | {
    t: 'C';
    c1: Point;
    c2: Point;
    p: Point;
};
export interface Subpath {
    start: Point;
    segs: PathSegment[];
    closed: boolean;
}
/** Rejects unsupported or relative SVG commands instead of silently changing a copied path. */
export declare function parseShapePath(d: string): Subpath[];
export declare function shapePathBounds(subs: Subpath[]): {
    x: number;
    y: number;
    width: number;
    height: number;
};
export declare function serializeShapePath(subs: Subpath[]): string;
export declare function fitShapePath(d: string, width: number, height: number): Subpath[];
export declare function scaleShapePath(subs: Subpath[], x: number, y: number): Subpath[];
export declare function roundShapePath(subs: Subpath[], radius: number): Subpath[];
export declare function hasShapeCorners(d: string): boolean;
