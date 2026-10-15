export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function inline(text: string): string {
    let html = escapeHtml(text);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) => {
        if (!/^(https?:|mailto:)/i.test(href.replace(/&amp;/g, '&'))) {
            return label;
        }
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    return html;
}

function cells(row: string): string[] {
    return row.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
}

export function renderMarkdown(markdown: string): string {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const output: string[] = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];
        if (!line.trim()) {
            index++;
            continue;
        }
        if (/^```/.test(line)) {
            const language = line.slice(3).trim();
            const code: string[] = [];
            index++;
            while (index < lines.length && !/^```/.test(lines[index])) {
                code.push(lines[index++]);
            }
            if (index < lines.length) {
                index++;
            }
            output.push(
                `<pre><code data-language="${escapeHtml(language)}">${escapeHtml(code.join('\n'))}</code></pre>`
            );
            continue;
        }
        if (/^#{1,6}\s/.test(line)) {
            const match = /^(#{1,6})\s+(.*)$/.exec(line)!;
            output.push(`<h${match[1].length}>${inline(match[2])}</h${match[1].length}>`);
            index++;
            continue;
        }
        if (/^\s*\|/.test(line) && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
            const header = cells(line);
            const rows: string[] = [];
            index += 2;
            while (index < lines.length && /^\s*\|/.test(lines[index])) {
                rows.push(`<tr>${cells(lines[index++]).map(cell => `<td>${inline(cell)}</td>`).join('')}</tr>`);
            }
            output.push(
                `<table><thead><tr>${header.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
            );
            continue;
        }
        if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
            const ordered = /^\s*\d+\./.test(line);
            const tag = ordered ? 'ol' : 'ul';
            const items: string[] = [];
            while (index < lines.length && (
                ordered ? /^\s*\d+\.\s+/.test(lines[index]) : /^\s*[-*+]\s+/.test(lines[index])
            )) {
                items.push(`<li>${inline(lines[index++].replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''))}</li>`);
            }
            output.push(`<${tag}>${items.join('')}</${tag}>`);
            continue;
        }
        const paragraph: string[] = [line];
        index++;
        while (
            index < lines.length &&
            lines[index].trim() &&
            !/^(?:#{1,6}\s|```|\s*\||\s*[-*+]\s+|\s*\d+\.\s+)/.test(lines[index])
        ) {
            paragraph.push(lines[index++]);
        }
        output.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    }
    return output.join('');
}
