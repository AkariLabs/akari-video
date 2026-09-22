(() => {
  const el = document.activeElement;
  const d = e => e ? (e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '')) : null;
  const cs = getComputedStyle(el);
  const anc = [];
  for (let p = el.parentElement; p && anc.length < 8; p = p.parentElement) {
    const c = getComputedStyle(p);
    if (c.overflow !== 'visible' || c.borderRadius !== '0px') anc.push({ el: d(p), overflow: c.overflow, radius: c.borderRadius });
  }
  const r = el.getBoundingClientRect();
  return { active: d(el), tabIndex: el.tabIndex, role: el.getAttribute('role'), matchesFocusVisible: el.matches(':focus-visible'),
    outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, outlineOffset: cs.outlineOffset, radius: cs.borderRadius, overflow: cs.overflow,
    rect: [r.left, r.top, r.width, r.height].map(Math.round), ancestors: anc };
})()
