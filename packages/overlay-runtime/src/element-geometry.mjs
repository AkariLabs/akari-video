// Geometry shared with the marked copy in interaction.js. Coordinates are client pixels.
// BEGIN element-geometry
function elementAxes(center, xProbe, yProbe) {
  return { x: { x: xProbe.x - center.x, y: xProbe.y - center.y },
    y: { x: yProbe.x - center.x, y: yProbe.y - center.y } };
}

function elementPoint(geometry, horizontal, vertical) {
  return { x: geometry.center.x + horizontal * geometry.width * geometry.axes.x.x / 2
      + vertical * geometry.height * geometry.axes.y.x / 2,
    y: geometry.center.y + horizontal * geometry.width * geometry.axes.x.y / 2
      + vertical * geometry.height * geometry.axes.y.y / 2 };
}

function elementHandlePoints(geometry, name) {
  const signs = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0],
    nw: [-1, -1], ne: [1, -1], se: [1, 1], sw: [-1, 1] }[name];
  if (!signs) return null;
  return { dragged: elementPoint(geometry, ...signs),
    anchor: elementPoint(geometry, -signs[0], -signs[1]), signs };
}

function elementBoxSize(width, height, name, delta, shift) {
  const signs = elementHandlePoints({ center: { x: 0, y: 0 }, width, height,
    axes: { x: { x: 1, y: 0 }, y: { x: 0, y: 1 } } }, name)?.signs;
  if (!signs) return { width, height };
  let nextWidth = signs[0] ? Math.max(4, width + signs[0] * delta.x) : width;
  let nextHeight = signs[1] ? Math.max(4, height + signs[1] * delta.y) : height;
  if (signs[0] && signs[1] && !shift) {
    const ratio = Math.max(4 / width, 4 / height,
      (width * nextWidth + height * nextHeight) / (width * width + height * height));
    nextWidth = width * ratio;
    nextHeight = height * ratio;
  }
  return { width: Math.round(nextWidth * 100) / 100,
    height: Math.round(nextHeight * 100) / 100 };
}

function elementLocalDelta(screen, axes) {
  const determinant = axes.x.x * axes.y.y - axes.y.x * axes.x.y;
  if (Math.abs(determinant) < 1e-6) return { x: 0, y: 0 };
  return { x: (screen.x * axes.y.y - screen.y * axes.y.x) / determinant,
    y: (screen.y * axes.x.x - screen.x * axes.x.y) / determinant };
}

function elementAngle(value, shift) {
  const angle = ((value + 180) % 360 + 360) % 360 - 180;
  return Math.round((shift ? Math.round(angle / 15) * 15 : angle) * 100) / 100;
}

function elementHandleLayout(width, height) {
  return { hideHorizontalEdges: width < 30, hideVerticalEdges: height < 30,
    outsideX: width < 36, outsideY: height < 36,
    cornerOffsetX: width < 36 ? 14 : 0, cornerOffsetY: height < 36 ? 14 : 0,
    rotateTop: -32 };
}

function elementBoxCompanions(style, parentStyle, width, height) {
  const result = {};
  if (style.boxSizing !== 'border-box') result['box-sizing'] = 'border-box';
  if (style.display === 'inline') result.display = 'inline-block';
  if (['flex', 'inline-flex'].includes(parentStyle?.display) && style.flex !== '0 0 auto') result.flex = '0 0 auto';
  if (width !== null) {
    if (Number.parseFloat(style.minWidth) > width) result['min-width'] = '0px';
    if (Number.parseFloat(style.maxWidth) < width) result['max-width'] = 'none';
  }
  if (height !== null) {
    if (Number.parseFloat(style.minHeight) > height) result['min-height'] = '0px';
    if (Number.parseFloat(style.maxHeight) < height) result['max-height'] = 'none';
  }
  return result;
}
// END element-geometry
export { elementAxes, elementPoint, elementHandlePoints, elementBoxSize,
  elementLocalDelta, elementAngle, elementHandleLayout, elementBoxCompanions };
