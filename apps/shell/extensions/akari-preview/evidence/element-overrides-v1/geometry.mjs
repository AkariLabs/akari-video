export function geometryChecks(measurementFor) {
  const checks = [];
  const add = (name, pass) => checks.push({ name, pass });
  const boxes = (name, className) => measurementFor(name)?.boxes?.[className];
  const bars = boxes('bars', 'bar'), baselineBars = boxes('bars-base', 'bar');
  const values = boxes('bars', 'val'), baselineValues = boxes('bars-base', 'val');
  if (bars && baselineBars && values && baselineValues) add('bar-layout-reflow', bars.length === 5
    && Math.abs(bars[2].height - 260) <= 1
    && Math.abs((baselineValues[2].top - values[2].top) - 160) <= 1
    && [0, 1, 3, 4].every(i => Math.abs(bars[i].height - baselineBars[i].height) <= 1
      && Math.abs(values[i].top - baselineValues[i].top) <= 1));
  const card = boxes('card', 'heading')?.[0], baseCard = boxes('card-base', 'heading')?.[0];
  const body = boxes('card', 'body')?.[0], baseBody = boxes('card-base', 'body')?.[0];
  if (card && baseCard && body && baseBody) add('card-transform-and-body-static',
    Math.abs((card.left + card.width / 2) - (baseCard.left + baseCard.width / 2) - 40) <= 1
    && Math.abs((card.top + card.height / 2) - (baseCard.top + baseCard.height / 2) + 20) <= 1
    && Math.abs(card.width - 254.5) <= 1 && Math.abs(card.height - 84.3) <= 1
    && Math.abs(baseCard.width - 250) <= 1 && Math.abs(baseCard.height - 50) <= 1
    && Math.abs(body.top - baseBody.top) <= 1 && Math.abs(body.left - baseBody.left) <= 1);
  const bagBase = boxes('bag-base', 'free'), bag = boxes('bag', 'free'), child = boxes('bag-child', 'free');
  const baseParts = boxes('bag-base', 'part'), parts = boxes('bag', 'part');
  if (bagBase && bag && baseParts && parts) add('bag-width-and-parts-static', bagBase.length >= 2
    && bagBase.every(value => Math.abs(value.width - 100) <= 1)
    && bag.every(value => Math.abs(value.width - 180) <= 1)
    && parts.length === baseParts.length
    && parts.every((value, i) => ['left', 'top', 'width', 'height'].every(key =>
      Math.abs(value[key] - baseParts[i][key]) <= 1)));
  if (bag && child) add('bag-inheritance-and-child-wins', bag.length >= 2
    && bag.every(value => Math.abs(value.width - 180) <= 1)
    && child.some(value => Math.abs(value.width - 220) <= 1)
    && child.some(value => Math.abs(value.width - 180) <= 1));
  const lazy = boxes('bag-lazy', 'free');
  if (lazy) add('bag-lazy-single-override', lazy.length === 1 && Math.abs(lazy[0].width - 180) <= 1
    && (measurementFor('bag-lazy')?.styles?.free?.[0]?.match(/width\s*:\s*180px/gu) ?? []).length === 1);
  const paths = measurementFor('paths');
  if (paths) add('relative-image-load', paths.imagesLoaded === true);
  const missing = boxes('missing', 'bar'), base = boxes('bars-base', 'bar');
  if (missing && base) add('missing-address-no-visual-change', missing.length === base.length
    && missing.every((value, i) => ['left', 'top', 'width', 'height'].every(key => Math.abs(value[key] - base[i][key]) <= 1)));
  return checks;
}
