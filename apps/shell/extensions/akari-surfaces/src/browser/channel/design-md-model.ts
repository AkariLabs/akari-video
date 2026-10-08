export const DESIGN_SECTION_HEADINGS = ['雰囲気', '色', '文字と字幕', 'ロゴ', '避けること'] as const;
export const DESIGN_SECTION_PLACEHOLDERS = [
    'あたたかく、手づくり感。白い器と木のまな板が映える明るさ。',
    'メインの色は強調したい 1 語だけに使う。背景に色を敷かない。',
    '太め・黒フチ。1 行は短く。英単語は半角のまま。',
    '右上に小さく。オープニングだけ大きく出す。',
    '絵文字の多用、虹色のグラデーション、画面を埋める字幕。'
] as const;
const REST_MARKER = '<!-- 読み取れなかった行 -->';

export interface DesignMdValues {
    colors: { main: string; sub: string; text: string; background: string };
    fonts: { heading: string; body: string };
    sections: { heading: string; body: string }[];
    rest: string;
}

export function defaultDesignValues(): DesignMdValues {
    return {
        colors: { main: '', sub: '', text: '#ffffff', background: '#111111' },
        fonts: { heading: '', body: '' },
        sections: DESIGN_SECTION_HEADINGS.map(heading => ({ heading, body: '' })), rest: ''
    };
}

function mapValue(line: string, key: string): string {
    const match = line.match(new RegExp(`(?:^|[,\\s{])${key}\\s*:\\s*"([^"\\n]*)"`));
    return match?.[1] ?? '';
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

export function buildDesignMd(values: DesignMdValues, channelName: string): string {
    const colors = values.colors;
    const fonts = values.fonts;
    const sections = [...DESIGN_SECTION_HEADINGS.map(heading => values.sections.find(section => section.heading === heading) ?? { heading, body: '' }),
        ...values.sections.filter(section => !(DESIGN_SECTION_HEADINGS as readonly string[]).includes(section.heading))];
    const parts = [
        '---',
        `colors: { main: "${quote(colors.main)}", sub: "${quote(colors.sub)}", text: "${quote(colors.text || '#ffffff')}", background: "${quote(colors.background || '#111111')}" }`,
        `fonts: { heading: "${quote(fonts.heading)}", body: "${quote(fonts.body)}" }`,
        '---',
        `# ${channelName} のデザイン`,
        ...sections.map(section => `## ${section.heading}\n${section.body.trim()}`)
    ];
    const body = `${parts.slice(0, 5).join('\n')}\n\n${parts.slice(5).join('\n\n')}`;
    return `${body}${values.rest.trim() ? `\n\n${REST_MARKER}\n${values.rest.trimEnd()}` : ''}\n`;
}
