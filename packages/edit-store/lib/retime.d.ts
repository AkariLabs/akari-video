import { EditV2 } from './edit-v2';
/**
 * v2 の出力フレーム格子を変更し、すべての出力側時刻を境界丸めで再スケールする。
 * 素材側の source.in / source.out（秒）は変更しない。
 *
 * この変換は量子化を伴うため非可逆であり、fpsOld → fpsNew → fpsOld で元には戻らない。
 * 文字列入力も受け付けるが、返り値は常に検証済みの v2 オブジェクトである。
 */
export declare function retime(source: string | unknown, fpsNew: number): EditV2;
