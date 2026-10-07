#!/usr/bin/env node
/** Render theme-neutral alpha specimens from bundled and locally supplied OFL fonts. */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--'))
    .map(arg => arg.slice(2).split(/=(.*)/s).slice(0, 2)));
const supplied = options['font-dir'] ?? process.env.AKARI_SPECIMEN_FONT_DIR;
const output = resolve(options['out-dir'] ?? join(root, 'catalog', 'font'));
const manifest = JSON.parse(await fs.readFile(join(root, 'catalog', 'font', 'download-manifest.json'), 'utf8'));
const dirs = await fs.readdir(join(root, 'catalog', 'font'), { withFileTypes: true });
const only = options.only?.split(',');
const rowOnly = 'row-only' in options;
let produced = 0;
for (const entry of dirs.filter(dir => dir.isDirectory() && (!only || only.includes(dir.name)))) {
    const id = entry.name;
    const meta = JSON.parse(await fs.readFile(join(root, 'catalog', 'font', id, 'meta.json'), 'utf8'));
    const bundledDir = join(root, 'assets', 'font', id);
    const bundled = (await fs.readdir(bundledDir).catch(() => []))
        .filter(name => /\.(ttf|otf)$/i.test(name)).sort();
    let font = bundled.length ? join(bundledDir, bundled.find(name => /regular|medium|variable/i.test(name)) ?? bundled[0]) : undefined;
    const boldFile = bundled.find(name => /-bold|-black/i.test(name));
    if (!font && supplied && manifest.fonts[id]) {
        const source = manifest.fonts[id];
        const candidate = join(supplied, id, source.file);
        const bytes = await fs.readFile(candidate).catch(() => undefined);
        if (bytes) {
            if (bytes.length !== source.bytes || createHash('sha256').update(bytes).digest('hex') !== source.sha256)
                throw new Error(`Font checksum mismatch: ${id}`);
            font = candidate;
        }
    }
    if (!font) continue;
    const dest = join(output, id);
    await fs.mkdir(dest, { recursive: true });
    const title = meta.title.replace(/（.*$/u, '').trim();
    const row = join(dest, 'row.webp');
    const sample = join(dest, 'sample.webp');
    const common = ['-background', 'none', '-fill', 'white', '-font', font, '-alpha', 'on'];
    const rowText = `${title} 文字もじモジ`;
    const rowGlyph = ['+size', '-background', 'none', '-fill', 'white', '-font', font, '-pointsize', '64',
        `label:${rowText}`, '-trim', '+repage', '-resize', 'x44'];
    const { stdout: textWidth } = await run('magick', [...rowGlyph, '-format', '%w', 'info:']);
    const rowWidth = Math.min(960, Math.max(64, Number(textWidth)));
    if (!Number.isFinite(rowWidth)) throw new Error(`Cannot measure font specimen: ${id}`);
    await run('magick', ['-size', `${rowWidth}x64`, 'xc:none',
        '(', ...rowGlyph, ')', '-gravity', 'West', '-geometry', '+0+0', '-composite',
        '-define', 'webp:lossless=true', row]);
    if (!rowOnly) {
        const lines = ['永あア字', 'あいうえお アイウエオ', 'AaBbCc 0123'];
        const sizes = [84, 46, 52];
        const positions = [84, 184, 270];
        const args = ['-size', '640x400', 'xc:none', ...common, '-gravity', 'NorthWest'];
        for (let index = 0; index < lines.length; index++) {
            args.push('-pointsize', String(sizes[index]), '-annotate', `+24+${positions[index]}`, lines[index]);
        }
        if (boldFile || /Variable|\[wght\]/i.test(font)) {
            args.push('-font', font, '-weight', '400', '-pointsize', '31', '-annotate', '+24+340', 'Regular 文字 Aa');
            args.push('-font', boldFile ? join(bundledDir, boldFile) : font, '-weight', '700',
                '-pointsize', '31', '-annotate', '+340+340', 'Bold 文字 Aa');
        }
        args.push('-define', 'webp:lossless=true', sample);
        await run('magick', args);
    }
    produced++;
    console.log(`${id}: row.webp ${rowWidth}x64${rowOnly ? '' : ', sample.webp 640x400'}`);
}
console.log(`Generated ${produced} font ${rowOnly ? 'rows' : 'specimen pairs'}`);
