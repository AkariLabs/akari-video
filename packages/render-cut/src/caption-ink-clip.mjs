// A plate can span the output while its text occupies only a small centered row.
// Express inset keyframes against the row union, keeping the plate's layout and motion origin.
export function captionInkClipRecipe(recipe) {
  return recipe.replace(/clip-path:\s*inset\(([^()]*)\)/gu, (_match, values) => {
    const parts = values.trim().split(/\s+/u);
    const sides = parts.length === 1 ? [parts[0], parts[0], parts[0], parts[0]]
      : parts.length === 2 ? [parts[0], parts[1], parts[0], parts[1]]
        : parts.length === 3 ? [parts[0], parts[1], parts[2], parts[1]] : parts;
    return `clip-path: inset(${sides.map((value, index) => {
      const side = ['top', 'right', 'bottom', 'left'][index];
      const percent = value === '0' ? 0 : Number.parseFloat(value);
      return `var(--akari-ink-${side}-${percent}, ${value === '0' ? '0%' : value})`;
    }).join(' ')})`;
  });
}

export function setCaptionInkClipVariables(plate) {
  if (!plate) return;
  const previous = plate.style.getPropertyValue('animation');
  const priority = plate.style.getPropertyPriority('animation');
  const geometry = ['transform', 'rotate', 'scale', 'translate'].map(name => ({
    name, value: plate.style.getPropertyValue(name), priority: plate.style.getPropertyPriority(name)
  }));
  plate.style.setProperty('animation', 'none', 'important');
  for (const { name } of geometry) plate.style.setProperty(name, 'none', 'important');
  try {
    const block = plate.querySelector('.akari-caption__block');
    const elements = [ ...(block ? [block] : [...plate.querySelectorAll('.akari-caption__line')]),
      ...plate.querySelectorAll('.akari-caption__run') ];
    if (!elements.length) return;
    const bounds = plate.getBoundingClientRect();
    const rects = elements.map(element => element.getBoundingClientRect());
    const ink = {
      left: Math.min(...rects.map(rect => rect.left)),
      right: Math.max(...rects.map(rect => rect.right)),
      top: Math.min(...rects.map(rect => rect.top)),
      bottom: Math.max(...rects.map(rect => rect.bottom))
    };
    const scaleX = bounds.width / (plate.offsetWidth || bounds.width || 1);
    const scaleY = bounds.height / (plate.offsetHeight || bounds.height || 1);
    const gaps = { top: (ink.top - bounds.top) / scaleY, right: (bounds.right - ink.right) / scaleX,
      bottom: (bounds.bottom - ink.bottom) / scaleY, left: (ink.left - bounds.left) / scaleX };
    const sizes = { top: (ink.bottom - ink.top) / scaleY, bottom: (ink.bottom - ink.top) / scaleY,
      left: (ink.right - ink.left) / scaleX, right: (ink.right - ink.left) / scaleX };
    for (const side of ['top', 'right', 'bottom', 'left']) {
      for (const percent of [0, 10, 20, 30, 45, 60, 100]) {
        plate.style.setProperty(`--akari-ink-${side}-${percent}`,
          `${gaps[side] + sizes[side] * percent / 100}px`);
      }
    }
  } finally {
    if (previous) plate.style.setProperty('animation', previous, priority);
    else plate.style.removeProperty('animation');
    for (const { name, value, priority } of geometry) {
      if (value) plate.style.setProperty(name, value, priority);
      else plate.style.removeProperty(name);
    }
  }
}
