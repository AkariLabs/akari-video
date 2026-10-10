export const DESIGN_SECTION_HEADINGS = ['雰囲気', '色', '文字と字幕', 'ロゴ', '避けること'] as const;
export const DESIGN_SECTION_PLACEHOLDERS = [
    'あたたかく、手づくり感。白い器と木のまな板が映える明るさ。',
    'メインの色は強調したい 1 語だけに使う。背景に色を敷かない。',
    '太め・黒フチ。1 行は短く。英単語は半角のまま。',
    '右上に小さく。オープニングだけ大きく出す。',
    '絵文字の多用、虹色のグラデーション、画面を埋める字幕。'
] as const;
const REST_MARKER = '<!-- 読み取れなかった行 -->';
export const DESIGN_ASSET_ROLES = ['logo', 'logo-mono', 'icon', 'font', 'reference', 'other'] as const;
export type DesignAssetRole = typeof DESIGN_ASSET_ROLES[number];
export const DESIGN_ASSET_ROLE_LABELS: Record<DesignAssetRole, string> = {
    logo: 'ロゴ', 'logo-mono': 'ロゴ（単色）', icon: 'アイコン', font: 'フォント', reference: '参考画像', other: 'そのほか'
};
export interface DesignAsset { role: DesignAssetRole; file: string; note: string }

export interface DesignMdValues {
    colors: { main: string; sub: string; text: string; background: string };
    fonts: { heading: string; body: string };
    assets: DesignAsset[];
    sections: { heading: string; body: string }[];
    rest: string;
}

export function defaultDesignValues(): DesignMdValues {
    return {
        colors: { main: '', sub: '', text: '#ffffff', background: '#111111' },
        fonts: { heading: '', body: '' },
        assets: [],
        sections: DESIGN_SECTION_HEADINGS.map(heading => ({ heading, body: '' })), rest: ''
    };
}

function mapValue(line: string, key: string): string {
    const match = line.match(new RegExp(`(?:^|[,\\s{])${key}\\s*:\\s*"([^"\\n]*)"`));
    return match?.[1] ?? '';
}

function parseAssets(line: string): DesignAsset[] | undefined {
    const match = line.match(/^assets:\s*\[(.*)\]\s*$/);
    if (!match) return undefined;
    const source = match[1];
    const quoted = '"(?:\\\\.|[^"\\\\])*"';
    const field = new RegExp(`\\s*([a-z]+)\\s*:\\s*(${quoted})\\s*`, 'y');
    let index = 0;
    const assets: DesignAsset[] = [];
    while (index < source.length) {
        while (/\s/.test(source[index] ?? '')) index++;
        if (index === source.length) break;
        if (source[index++] !== '{') return undefined;
        const item: Record<string, string> = {};
        while (source[index] !== '}') {
            field.lastIndex = index;
            const entry = field.exec(source);
            if (!entry || !['role', 'file', 'note'].includes(entry[1]) || entry[1] in item) return undefined;
            try { item[entry[1]] = JSON.parse(entry[2]); } catch { return undefined; }
            index = field.lastIndex;
            if (source[index] === ',') index++;
            else if (source[index] !== '}') return undefined;
        }
        index++;
        if (!('role' in item && 'file' in item)) return undefined;
        if ((DESIGN_ASSET_ROLES as readonly string[]).includes(item.role)
            && item.file.startsWith('design/') && !item.file.includes('..') && item.file.length > 'design/'.length) {
            assets.push({ role: item.role as DesignAssetRole, file: item.file, note: item.note ?? '' });
        }
        while (/\s/.test(source[index] ?? '')) index++;
        if (index < source.length && source[index++] !== ',') return undefined;
    }
    return assets;
}

export function isDesignAssetFileName(name: string): boolean {
    return /\.(?:png|jpe?g|svg|webp|ttf|otf|woff2)$/i.test(name);
}

export function isDesignImageFile(file: string): boolean {
    return /\.(?:png|jpe?g|svg|webp)$/i.test(file);
}

export function safeDesignFileName(original: string, existing: readonly string[]): string {
    const cleaned = original.replace(/[<>:"/\\|?*]/g, '-')
        .split('').map(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? '-' : char).join('')
        .replace(/^\.+/, '') || 'asset';
    const dot = cleaned.lastIndexOf('.');
    const stem = dot > 0 ? cleaned.slice(0, dot) : cleaned;
    const ext = dot > 0 ? cleaned.slice(dot).toLowerCase() : '';
    const used = new Set(existing.map(name => name.toLowerCase()));
    let candidate = `${stem}${ext}`;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}${ext}`;
    return candidate;
}

export function designAssetBadge(assets: readonly DesignAsset[]): string | undefined {
    if (!assets.length) return undefined;
    if (assets.some(asset => asset.role === 'logo' || asset.role === 'logo-mono')) return 'ロゴあり';
    return `${assets.every(asset => asset.role === 'font') ? 'フォント' : '画像'} ${assets.length}`;
}

export function parseDesignMd(text: string): DesignMdValues {
    const values = defaultDesignValues();
    values.colors.text = '';
    values.colors.background = '';
    const [mainText, ...preserved] = text.replace(/\r\n/g, '\n').split(`\n\n${REST_MARKER}\n`);
    const lines = mainText.split('\n');
    const unknown: string[] = [];
    let start = 0;
    if (lines[0] === '---') {
        const end = lines.indexOf('---', 1);
        if (end > 0) {
            for (const line of lines.slice(1, end)) {
                if (/^colors:\s*\{.*\}\s*$/.test(line)) {
                    for (const key of ['main', 'sub', 'text', 'background'] as const) values.colors[key] = mapValue(line, key);
                } else if (/^fonts:\s*\{.*\}\s*$/.test(line)) {
                    for (const key of ['heading', 'body'] as const) values.fonts[key] = mapValue(line, key);
                } else if (line.startsWith('assets:')) {
                    const assets = parseAssets(line);
                    if (assets) values.assets = assets;
                    else unknown.push(line);
                } else if (line.trim()) unknown.push(line);
            }
            start = end + 1;
        }
    }
    let heading: string | undefined;
    let body: string[] = [];
    const sections: DesignMdValues['sections'] = [];
    const flush = (): void => {
        if (heading !== undefined) sections.push({ heading, body: body.join('\n').trim() });
        else if (body.some(line => line.trim())) unknown.push(body.join('\n').trim());
    };
    for (const line of lines.slice(start)) {
        if (/^# (?!#)/.test(line) && heading === undefined && !body.some(item => item.trim())) continue;
        if (line.startsWith('## ')) { flush(); heading = line.slice(3); body = []; }
        else body.push(line);
    }
    flush();
    values.sections = sections;
    values.rest = [...unknown, ...preserved.map(part => part.trimEnd())].filter(Boolean).join('\n\n');
    return values;
}

function quote(value: string): string { return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' '); }
function quoteAsset(value: string): string {
    return quote(value.split('').map(char => {
        const code = char.charCodeAt(0);
        return code < 32 || (code >= 127 && code <= 159) ? ' ' : char;
    }).join(''));
}

export function buildDesignMd(values: DesignMdValues, channelName: string): string {
    const colors = values.colors;
    const fonts = values.fonts;
    const sections = [...DESIGN_SECTION_HEADINGS.map(heading => values.sections.find(section => section.heading === heading) ?? { heading, body: '' }),
        ...values.sections.filter(section => !(DESIGN_SECTION_HEADINGS as readonly string[]).includes(section.heading))];
    const parts = [
        '---',
        `colors: { main: "${quote(colors.main)}", sub: "${quote(colors.sub)}", text: "${quote(colors.text || '#ffffff')}", background: "${quote(colors.background || '#111111')}" }`,
        `fonts: { heading: "${quote(fonts.heading)}", body: "${quote(fonts.body)}" }`,
        ...(values.assets.length ? [`assets: [${values.assets.map(asset => `{ role: "${quoteAsset(asset.role)}", file: "${quoteAsset(asset.file)}", note: "${quoteAsset(asset.note)}" }`).join(', ')}]`] : []),
        '---',
        `# ${channelName} のデザイン`,
        ...sections.map(section => `## ${section.heading}\n${section.body.trim()}`)
    ];
    const frontLength = values.assets.length ? 6 : 5;
    const body = `${parts.slice(0, frontLength).join('\n')}\n\n${parts.slice(frontLength).join('\n\n')}`;
    return `${body}${values.rest.trim() ? `\n\n${REST_MARKER}\n${values.rest.trimEnd()}` : ''}\n`;
}
