export function transitionVisualState(type, progress, plateColor) {
  const p = Math.max(0, Math.min(1, progress));
  if (type === 'dissolve') {
    return { videoOpacity: p, clipPath: 'none', plateOpacity: 0, plateVisible: false };
  }
  if (type === 'reveal-down') {
    return {
      videoOpacity: 1, clipPath: `inset(0 0 ${(1 - p) * 100}% 0)`,
      plateOpacity: 0, plateVisible: false,
    };
  }
  if (type === 'reveal-up') {
    return {
      videoOpacity: 1, clipPath: `inset(${(1 - p) * 100}% 0 0 0)`,
      plateOpacity: 0, plateVisible: false,
    };
  }
  return {
    videoOpacity: p >= 0.5 ? 1 : 0,
    clipPath: 'none',
    plateOpacity: p <= 0.5 ? p * 2 : (1 - p) * 2,
    plateVisible: true,
    plateColor: plateColor ?? (type === 'fade-white' ? '#fff' : '#000'),
  };
}
