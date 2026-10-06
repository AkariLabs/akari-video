/** Filter composed catalogue rows without changing their order or contents. */
export function filterListItems(items, { category, source, tags = [], query } = {}) {
  const needle = query?.toLocaleLowerCase();
  return items.filter(item =>
    (!category || item.category === category)
    && (!source || item.sourceKind === source)
    && tags.every(tag => item.tags?.includes(tag))
    && (!needle || [item.title, item.id, ...(item.tags ?? [])]
      .some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(needle))));
}
