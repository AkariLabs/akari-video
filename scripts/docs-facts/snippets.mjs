const quote = (value, lang) => lang === 'ja' ? `「${value}」` : `“${value}”`;
const code = (value) => `\`${value}\``;
const commandBlock = (usage) => {
  const commands = usage.replace(/^(?:使い方|Usage):\s*/, '').split(' | ');
  return `\`\`\`sh\n${commands.join('\n')}\n\`\`\``;
};

function shippedNote(facts, lang) {
  const changes = facts.shipped.filter((row) => row.lang === lang);
  if (!changes.length) return '';
  const uiChanges = changes.filter((row) => !row.key.startsWith('cli.'));
  const newUsage = changes.find((row) => row.key === 'cli.new.usage');
  const templateUsage = changes.find((row) => row.key === 'cli.template.usage');
  const tag = facts.meta.shippedTag;
  const parts = [];
  if (uiChanges.length) {
    const arrow = lang === 'ja' ? '→' : ' → ';
    const pairs = uiChanges.map(({ shipped, current }) => `${quote(shipped ?? (lang === 'ja' ? '未収録' : 'not yet present'), lang)}${arrow}${quote(current, lang)}`);
    parts.push(lang === 'ja'
      ? `配布中の ${tag} では${pairs.join('、')}と表示されます。次の版から右側の名前になります。`
      : `The shipped ${tag} build displays ${pairs.join(', ')}. The next release uses the names on the right.`);
  }
  if (newUsage) {
    const { scaffold, alias } = facts.cli.new;
    if (!newUsage.shipped?.includes(scaffold) && newUsage.current.includes(scaffold)) {
      parts.push(lang === 'ja'
        ? `配布中の ${tag} では ${code(alias)} を使い、次の版から ${code(scaffold)} も使えます。`
        : `Use ${code(alias)} in the shipped ${tag} build. ${code(scaffold)} arrives in the next release.`);
    } else {
      parts.push(lang === 'ja' ? `${code('akari new')} の使い方は配布中の ${tag} から変わります。` : `${code('akari new')} usage differs from the shipped ${tag} build.`);
    }
  }
  if (templateUsage) {
    const { export: exportCommand, list, alias } = facts.cli.template;
    if (!templateUsage.shipped?.includes(exportCommand) && templateUsage.current.includes(exportCommand)) {
      parts.push(lang === 'ja'
        ? `配布中の ${tag} では ${code(alias)} を使い、次の版から ${code(exportCommand)} と ${code(list)} が使えます。`
        : `Use ${code(alias)} in the shipped ${tag} build. ${code(exportCommand)} and ${code(list)} arrive in the next release.`);
    } else {
      parts.push(lang === 'ja' ? `テンプレートの CLI の使い方は配布中の ${tag} から変わります。` : `Template CLI usage differs from the shipped ${tag} build.`);
    }
  }
  if (newUsage || templateUsage) parts.push(lang === 'ja' ? '旧名は別名として残ります。' : 'The older CLI names remain aliases.');
  return parts.join(lang === 'ja' ? '' : ' ');
}

export const snippets = Object.freeze({
  'cli.new': (facts, lang) => `${commandBlock(facts.cli.new.usage[lang])}\n\n${lang === 'ja'
    ? `${code(facts.cli.new.alias)} は ${code(facts.cli.new.scaffold)} の別名として使えます。`
    : `${code(facts.cli.new.alias)} remains an alias for ${code(facts.cli.new.scaffold)}.`}`,
  'cli.template': (facts, lang) => `${commandBlock(facts.cli.template.usage[lang])}\n\n${lang === 'ja'
    ? `${code(facts.cli.template.alias)} は ${code(facts.cli.template.export)} の別名です。`
    : `${code(facts.cli.template.alias)} remains an alias for ${code(facts.cli.template.export)}.`}`,
  'paths.credentials': (facts, lang) => lang === 'ja'
    ? `鍵の実体は ${code(facts.paths.credentials.primary)} に置きます。旧い場所の ${code(facts.paths.credentials.legacy)} も読み取れます。`
    : `Store API keys in ${code(facts.paths.credentials.primary)}. The former location ${code(facts.paths.credentials.legacy)} remains readable.`,
  'shipped-note': shippedNote,
  'stamp': (facts, lang) => {
    const { version, releaseDate } = facts.meta;
    return lang === 'ja'
      ? `この文書は AKARI Video v${version}${releaseDate ? `（${releaseDate} 公開）` : ''}時点の説明です。`
      : `This page describes AKARI Video v${version}${releaseDate ? ` (released ${releaseDate})` : ''}.`;
  },
});
