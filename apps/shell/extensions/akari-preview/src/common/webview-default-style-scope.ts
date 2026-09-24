// issue #84: Theia の既定 CSS を overlay 内だけから外す。webview へ toString() で埋め込むため自己完結させる。
export function scopeSelectorOutsideOverlays(selectorText: string): string {
    const guard = ':where(:not(#overlay-stage [data-overlay-id] *))';
    const parts: string[] = [];
    let start = 0;
    let depth = 0;
    let bracket = 0;
    let quote = '';
    let escaped = false;
    for (let i = 0; i < selectorText.length; i += 1) {
        const char = selectorText[i];
        if (escaped) { escaped = false; continue; }
        if (char === '\\') { escaped = true; continue; }
        if (quote) { if (char === quote) quote = ''; continue; }
        if (char === '"' || char === "'") { quote = char; continue; }
        if (char === '[') bracket += 1;
        else if (char === ']') bracket -= 1;
        else if (!bracket && char === '(') depth += 1;
        else if (!bracket && char === ')') depth -= 1;
        else if (!bracket && !depth && char === ',') { parts.push(selectorText.slice(start, i)); start = i + 1; }
    }
    parts.push(selectorText.slice(start));
    return parts.map(part => {
        if (part.includes(guard)) return part;
        const end = part.search(/\s*$/);
        let compound = 0;
        let pseudoElement = -1;
        let depth = 0;
        let bracket = 0;
        let quote = '';
        let escaped = false;
        for (let i = 0; i < end; i += 1) {
            const char = part[i];
            if (escaped) { escaped = false; continue; }
            if (char === '\\') { escaped = true; continue; }
            if (quote) { if (char === quote) quote = ''; continue; }
            if (char === '"' || char === "'") { quote = char; continue; }
            if (char === '[') { bracket += 1; continue; }
            if (char === ']') { bracket -= 1; continue; }
            if (bracket) continue;
            if (char === '(') { depth += 1; continue; }
            if (char === ')') { depth -= 1; continue; }
            if (depth) continue;
            if (/\s|[>+~]/.test(char)) { compound = i + 1; pseudoElement = -1; continue; }
            if (char === ':' && pseudoElement < 0 &&
                (part[i + 1] === ':' || /^:(?:before|after|first-line|first-letter)(?![\w-])/i.test(part.slice(i)))) {
                pseudoElement = i;
            }
        }
        const at = pseudoElement >= compound ? pseudoElement : end;
        return part.slice(0, at) + guard + part.slice(at);
    }).join(',');
}

export function neutralizeWebviewDefaultStylesForOverlays(
    doc: Document,
    scope: (selectorText: string) => string = scopeSelectorOutsideOverlays
): { rewritten: number; failed: number } {
    const result = { rewritten: 0, failed: 0 };
    const sheet = (doc.getElementById('_defaultStyles') as HTMLStyleElement | null)?.sheet;
    if (!sheet) return result;
    const visit = (rules: CSSRuleList): void => {
        for (const rule of Array.from(rules)) {
            if ('selectorText' in rule) {
                const styleRule = rule as CSSStyleRule;
                const before = styleRule.selectorText;
                const after = scope(before);
                if (after === before) continue;
                try { styleRule.selectorText = after; } catch { /* CSSOM が代入を拒否する場合がある */ }
                if (styleRule.selectorText === before) result.failed += 1;
                else result.rewritten += 1;
            } else if ('cssRules' in rule) {
                visit((rule as CSSGroupingRule).cssRules);
            }
        }
    };
    visit(sheet.cssRules);
    return result;
}
