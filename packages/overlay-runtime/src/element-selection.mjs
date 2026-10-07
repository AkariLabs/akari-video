// Pure DOM selection rules. interaction.js carries this marked body verbatim.
// BEGIN element-selection
function isRuntimeElement(element) {
  return element?.matches?.('script, style, template, [data-akari-hit-proxy], [data-akari-interaction], [data-akari-part-mask], .akari-u')
    || Boolean(element?.closest?.('[data-akari-hit-proxy], [data-akari-interaction], [data-akari-part-mask]'));
}

function elementAddress(root, element) {
  if (!root || !element || isRuntimeElement(element) || !root.contains(element)) return null;
  const id = element.getAttribute('id');
  const token = element.getAttribute('class')?.trim().split(/\s+/u).find(value => value && value !== 'akari-u');
  if (!id && !token) return null;
  const candidates = [root, ...root.querySelectorAll('*')].filter(candidate => !isRuntimeElement(candidate)
    && (id ? candidate.getAttribute('id') === id
      : candidate.getAttribute('class')?.split(/\s+/u).includes(token)));
  const index = candidates.indexOf(element);
  return index < 0 ? null : `${id ? '#' : '.'}${id || token}[${index}]`;
}

function selectableElement(root, element, outputRect) {
  if (!root || !element || element === root || !root.contains(element) || isRuntimeElement(element)
    || element.closest('svg') !== (element.tagName.toLowerCase() === 'svg' ? element : null)
    || !elementAddress(root, element)) return false;
  const rect = element.getBoundingClientRect();
  if (!(rect.width > 1 && rect.height > 1)) return false;
  for (let ancestor = element; ancestor && root.contains(ancestor); ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  }
  const replaced = ['img', 'video', 'canvas', 'svg'].includes(element.tagName.toLowerCase());
  return replaced || !outputRect || rect.width < outputRect.width * 0.95
    || rect.height < outputRect.height * 0.95;
}

function nearestSelectableElement(root, hit, outputRect) {
  for (let element = hit; element && element !== root; element = element.parentElement) {
    if (selectableElement(root, element, outputRect)) return element;
  }
  return null;
}

function firstSelectableElement(root, outputRect) {
  return [root, ...root.querySelectorAll('*')].find(element => selectableElement(root, element, outputRect)) ?? null;
}

function elementByAddress(root, ref) {
  if (!root || typeof ref !== 'string') return null;
  return [root, ...root.querySelectorAll('*')].find(element => elementAddress(root, element) === ref) ?? null;
}

function elementLabel(root, element) {
  const ref = elementAddress(root, element);
  if (!ref) return '';
  if (ref.startsWith('#')) return ref.slice(0, ref.lastIndexOf('['));
  const name = ref.slice(1, ref.lastIndexOf('['));
  const siblings = [...element.parentElement.children].filter(sibling => sibling.getAttribute('class')?.split(/\s+/u).includes(name));
  return siblings.length > 1 ? `${name} ${siblings.indexOf(element) + 1}` : name;
}
// END element-selection
export { isRuntimeElement, elementAddress, selectableElement, nearestSelectableElement,
  firstSelectableElement, elementByAddress, elementLabel };
