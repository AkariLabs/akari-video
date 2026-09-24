/** Geometry is computed in placed pixels and contains no shared mutable state. */
export interface BubbleParams {
    style: 'ellipse' | 'rounded' | 'rect' | 'jagged' | 'burst' | 'cloud' | 'wobble';
    count: number;
    depth: number;
    jitter: number;
    seed: number;
    tail: 'point' | 'dots' | 'none';
    tailAngle: number;
    tailLength: number;
    tailWidth: number;
    tailCurve: number;
}
export declare function bubblePath(width: number, height: number, params: BubbleParams): string;
