import fs from 'node:fs';
import path from 'node:path';

export const forbidden = /^(?:src\/(?:judge\.mjs|catalog\.mjs|questions(?:\.mjs|\/)|candidates\.mjs|state\.mjs|apply\.mjs|deciders\/|judge\/|ops\/(?!_)[^/]+\.mjs)|judge-server\/)/;
export const privateDirectory = /(?:^|\/)(?:cases|results|experiments|sessions|calibration|fixture)(?:\/|$)/;
export const forbiddenPath = name => forbidden.test(name) || privateDirectory.test(name);
export const lineAt = (source, offset) => source.slice(0, offset).split('\n').length;
export function filesUnder(root) {
    const files = [];
    function walk(directory, prefix = '') {
        for (const entry of fs.readdirSync(directory, {withFileTypes:true}).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
            const name = prefix + entry.name;
            if (entry.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${name}`);
            if (entry.isDirectory()) walk(path.join(directory,entry.name), name+'/');
            else if (entry.isFile()) files.push(name);
            else throw new Error(`Not a regular file: ${name}`);
        }
    }
    walk(root);
    return files.sort();
}
function decode(text) {
    return text.replace(/\\(?:u\{([\da-f]+)\}|u([\da-f]{4})|x([\da-f]{2})|(\r?\n)|([\s\S]))/gi, (_, wide, unicode, hex, newline, other) => {
        if (wide || unicode || hex) return String.fromCodePoint(parseInt(wide || unicode || hex,16));
        if (newline) return '';
        return ({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0'})[other] ?? other;
    });
}
// Tokenize without evaluating source. Template expressions are visited recursively;
// comments, quoted strings and regexp bodies cannot conceal executable imports.
export function tokenize(source) {
    const tokens = [];
    let i = 0;
    const add = (type, value, start, end = i) => tokens.push({type,value,start,end});
    const regexAfter = new Set(['(', '[', '{', '=', ':', ',', ';', '!', '?', '&&', '||', '??', '=>', 'return', 'throw', 'case', 'yield', 'await', 'else', 'of']);
    function quoted(quote) {
        const start = i++;
        let raw = '';
        while (i < source.length) {
            const char = source[i++];
            if (char === quote) { add('string',decode(raw),start); return; }
            if (char === '\\') raw += char + (source[i++] ?? '');
            else raw += char;
        }
        throw new Error(`Unterminated string at line ${lineAt(source,start)}`);
    }
    function template() {
        const start = i++;
        add('template-start','`',start);
        let raw = '', part = i;
        while (i < source.length) {
            const char = source[i++];
            if (char === '\\') raw += char + (source[i++] ?? '');
            else if (char === '`') { add('template-part',decode(raw),part,i-1); add('template-end','`',i-1); return; }
            else if (char === '$' && source[i] === '{') {
                add('template-part',decode(raw),part,i-1); i++; add('punct','{',i-1);
                scan(true); raw = ''; part = i;
            } else raw += char;
        }
        throw new Error(`Unterminated template at line ${lineAt(source,start)}`);
    }
    function scan(inTemplate = false) {
        let braces = 0;
        while (i < source.length) {
            const char = source[i], start = i;
            if (/\s/.test(char)) { i++; continue; }
            if (source.startsWith('#!',i) && i === 0) { while (i < source.length && source[i] !== '\n') i++; continue; }
            if (source.startsWith('//',i)) { while (i < source.length && source[i] !== '\n') i++; continue; }
            if (source.startsWith('/*',i)) {
                const end = source.indexOf('*/',i+2);
                if (end < 0) throw new Error('Unterminated comment');
                i = end+2; continue;
            }
            if (char === '"' || char === "'") { quoted(char); continue; }
            if (char === '`') { template(); continue; }
            const previous = tokens.at(-1);
            if (char === '/' && (!previous || regexAfter.has(previous.value))) {
                i++; let bracket = false, closed = false;
                while (i < source.length) {
                    const next = source[i++];
                    if (next === '\\') { i++; continue; }
                    if (next === '[') bracket = true;
                    if (next === ']') bracket = false;
                    if (next === '/' && !bracket) { closed = true; break; }
                    if (next === '\n') break;
                }
                if (!closed) throw new Error(`Unrecognized slash at line ${lineAt(source,start)}`);
                while (/[a-z]/i.test(source[i] ?? '') && i < source.length) i++;
                add('regexp',source.slice(start,i),start); continue;
            }
            if (/[\p{ID_Start}_$]/u.test(char)) {
                i++; while (i < source.length && /[\p{ID_Continue}$]/u.test(source[i])) i++;
                add('word',source.slice(start,i),start); continue;
            }
            const operator = ['=>','&&','||','??','?.','++','--','==','!=','**'].find(op => source.startsWith(op,i));
            i += operator?.length ?? 1;
            add('punct',operator ?? char,start);
            if (char === '{') braces++;
            if (char === '}') { if (inTemplate && braces === 0) return; braces--; }
        }
        if (inTemplate) throw new Error('Unterminated template expression');
    }
    scan();
    return tokens;
}
export function inspectImports(source) {
    const tokens = tokenize(source), imports = [], nonLiteral = [], specifiers = new Set();
    function take(token) {
        imports.push({specifier:token.value,line:lineAt(source,token.start)});
        specifiers.add(token.start);
    }
    for (let i=0; i<tokens.length; i++) {
        const token = tokens[i];
        if (token.type !== 'word' || !['import','export'].includes(token.value)) continue;
        if (['.','?.'].includes(tokens[i-1]?.value)) continue;
        const next = tokens[i+1];
        if (token.value === 'import' && next?.value === '.') continue;
        if (token.value === 'import' && next?.value === '(') {
            const argument = tokens[i+2], end = tokens[i+3];
            if (argument?.type === 'string' && [')',','].includes(end?.value)) take(argument);
            else nonLiteral.push(lineAt(source,token.start));
            continue;
        }
        if (next?.type === 'string' && token.value === 'import') { take(next); continue; }
        if (token.value === 'export' && !['*','{'].includes(next?.value)) continue;
        for (let j=i+1; j<tokens.length && tokens[j].value !== ';'; j++) {
            if (tokens[j].value === 'from' && tokens[j+1]?.type === 'string') { take(tokens[j+1]); break; }
            if (j>i+1 && ['import','export'].includes(tokens[j].value)) break;
        }
    }
    return {tokens,imports,nonLiteral,specifiers};
}
export function importTarget(name, specifier) {
    if (specifier.startsWith('node:')) return {builtin:true};
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) return {error:'bare/absolute import'};
    // Shared workspace libraries used by the shipped companion.
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(name),specifier));
    if (target.startsWith('../edit-store/lib/') && !/[?#\\]/.test(specifier)) return {external:true};
    if (target === '../creator-root/src/index.mjs' && !/[?#\\]/.test(specifier)) return {external:true};
    if (/[?#\\]/.test(specifier) || target.startsWith('../') || target.startsWith('/')) return {error:'import outside package'};
    return {target};
}
export function auditModules(files) {
    const counts = {modules:0,nonLiteral:0,outside:0,bare:0,forbidden:0};
    const errors = [];
    for (const [name, bytes] of [...files].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) {
        if (forbiddenPath(name)) { counts.forbidden++; errors.push(`forbidden: ${name}`); }
        if (!name.endsWith('.mjs')) continue;
        counts.modules++;
        let parsed;
        try { parsed = inspectImports(bytes.toString()); }
        catch (error) { counts.nonLiteral++; errors.push(`syntax: ${name}: ${error.message}`); continue; }
        for (const line of parsed.nonLiteral) { counts.nonLiteral++; errors.push(`non-literal import: ${name}:${line}`); }
        for (const {specifier,line} of parsed.imports) {
            const result = importTarget(name,specifier);
            if (result.error) {
                counts[result.error.startsWith('bare') ? 'bare' : 'outside']++;
                errors.push(`${result.error}: ${name}:${line}: ${specifier}`);
            } else if (result.target && !files.has(result.target)) {
                counts.outside++; errors.push(`missing import: ${name}:${line}: ${specifier}`);
            }
        }
    }
    return {counts,errors};
}
