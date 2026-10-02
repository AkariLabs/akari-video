/**
 * Integer-microsecond timestamps can move a true midpoint by one microsecond
 * when the target and adjacent PTS values are rounded independently. Treat
 * that one-microsecond distance difference as a tie, choosing the earlier PTS.
 */
export function prefersEarlierFrame(
  earlierTimestampUs: number,
  laterTimestampUs: number,
  targetUs: number,
): boolean {
  return targetUs - earlierTimestampUs <= laterTimestampUs - targetUs + 1;
}

/** Coverage for a frame whose neighboring PTS spacing equals its duration. */
export function nearestFrameCovers(
  frame: { timestamp: number; duration: number },
  targetUs: number,
): boolean {
  if (targetUs >= frame.timestamp) {
    return prefersEarlierFrame(frame.timestamp, frame.timestamp + frame.duration, targetUs);
  }
  return !prefersEarlierFrame(frame.timestamp - frame.duration, frame.timestamp, targetUs);
}
