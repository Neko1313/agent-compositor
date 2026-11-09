import { marked, type Token } from 'marked';
import stringWidth from 'string-width';
import type { Appearance, Grid, Row } from './presentation.js';
type Cell = Grid[number][number];
type Style = Omit<Cell, 'ch'>;
const decode = (s: string) => s.replace(/&(?:amp|lt|gt|quot|#39|#x[\da-f]+|#\d+);/gi, e => { const name = e.slice(1, -1); if (name[0] === '#') {
    const n = name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return n > 31 && n <= 0x10ffff && !(n >= 0x7f && n <= 0x9f) ? String.fromCodePoint(n) : '';
} return ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" } as Record<string, string>)[name.toLowerCase()] ?? e; });
const cells = (s: string, style: Style = {}): Cell[] => Array.from(s.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, ''), ch => ({ ch, ...style }));
const text = (row: Cell[]) => row.map(c => c.ch).join('');
function inline(tokens: Token[] | undefined, style: Style, theme: Appearance, depth = 0): Cell[] {
    if (depth > 16)
        return [];
    return (tokens ?? []).flatMap((token: any): Cell[] => {
        const nested = (patch: Style = {}) => inline(token.tokens ?? marked.Lexer.lexInline(token.text ?? ''), { ...style, ...patch }, theme, depth + 1);
        switch (token.type) {
            case 'strong': return nested({ bold: true });
            case 'em': return nested({ italic: true });
            case 'codespan': return cells(decode(token.text), { ...style, fg: theme.colors.accent, bg: theme.colors.titleBackground });
            case 'link': {
                const label = nested({ underline: true, fg: theme.colors.accent });
                return [...label, ...(text(label) === token.href ? [] : cells(` (${token.href})`, { ...style, fg: theme.colors.muted }))];
            }
            case 'image': return cells(`[${token.text || 'image'}] (${token.href})`, { ...style, fg: theme.colors.muted });
            case 'br': return cells('\n', style);
            case 'html': return cells(decode((token.text ?? '').replace(/<[^>]*>/g, '')), style);
            default: return token.tokens ? nested() : cells(decode((token.text ?? token.raw ?? '').replace(/\n/g, ' ')), style);
        }
    });
}
/** Wrap styled content after parsing markup, preserving styles across line breaks. */
function wrapped(source: Cell[], width: number, hard = false): Cell[][] {
    width = Math.max(1, width);
    const result: Cell[][] = [];
    let row: Cell[] = [], used = 0;
    const flush = () => { result.push(row); row = []; used = 0; };
    for (const cell of source) {
        if (cell.ch === '\n') {
            flush();
            continue;
        }
        const size = stringWidth(cell.ch);
        if (used + size > width && row.length) {
            const space = hard ? -1 : row.map(c => c.ch).lastIndexOf(' ');
            if (space > width / 2) {
                const tail = row.slice(space + 1);
                row = row.slice(0, space);
                flush();
                row = tail;
                used = stringWidth(text(row));
            }
            else
                flush();
        }
        if (size > width)
            continue;
        row.push(cell);
        used += size;
    }
    if (row.length || !result.length)
        flush();
    return result;
}
function blocks(tokens: Token[], width: number, theme: Appearance, depth = 0): Cell[][] {
    if (depth > 16)
        return [];
    const out: Cell[][] = [];
    const base = { fg: theme.colors.text };
    const line = (s: string, style: Style = base) => out.push(...wrapped(cells(s, style), width, true));
    for (const token of tokens as any[]) {
        switch (token.type) {
            case 'space':
                if (out.length && out.at(-1)!.length)
                    out.push([]);
                break;
            case 'heading':
                out.push(...wrapped(inline(token.tokens, { ...base, bold: true, fg: theme.colors.accent }, theme), width));
                break;
            case 'paragraph':
            case 'text':
                out.push(...wrapped(inline(token.tokens ?? marked.Lexer.lexInline(token.text ?? ''), base, theme), width));
                break;
            case 'code':
                line('── ' + (token.lang || 'code'), { fg: theme.colors.muted });
                for (const raw of token.text.split('\n'))
                    out.push(...wrapped(cells(raw, { fg: theme.colors.accent }), width, true));
                line('──', { fg: theme.colors.muted });
                break;
            case 'blockquote': {
                const prefix = cells('│ ', { fg: theme.colors.muted });
                out.push(...blocks(token.tokens, Math.max(1, width - 2), theme, depth + 1).map(r => [...prefix, ...r]));
                break;
            }
            case 'list':
                for (const [i, item] of token.items.entries()) {
                    const prefix = item.task ? `[${item.checked ? '✓' : ' '}] ` : token.ordered ? `${Number(token.start) + i}. ` : '• ';
                    const indent = stringWidth(prefix);
                    const rows = blocks(item.tokens, Math.max(1, width - indent), theme, depth + 1);
                    while (rows.length && !rows.at(-1)!.length)
                        rows.pop();
                    out.push(...(rows.length ? rows : [[]]).map((r, j) => [...cells(j ? ' '.repeat(indent) : prefix, { fg: theme.colors.muted }), ...r]));
                }
                break;
            case 'table': {
                const matrix = [token.header, ...token.rows].map((r: any[], i: number) => r.map(c => inline(c.tokens, { ...base, ...(i ? {} : { bold: true }) }, theme)));
                const count = token.header.length, available = width - (count - 1) * 3;
                if (available < count * 3) {
                    for (const r of token.rows)
                        for (let i = 0; i < count; i++) {
                            out.push(...wrapped([...inline(token.header[i].tokens, { ...base, bold: true }, theme), ...cells(': ', base), ...inline(r[i].tokens, base, theme)], width));
                        }
                    break;
                }
                const sizes = Array.from({ length: count }, (_, i) => Math.max(3, ...matrix.map((r: Cell[][]) => stringWidth(text(r[i])))));
                while (sizes.reduce((a, b) => a + b, 0) > available) {
                    const max = Math.max(...sizes);
                    sizes[sizes.indexOf(max)]--;
                }
                for (const [index, r] of matrix.entries()) {
                    const lines = r.map((c: Cell[], i: number) => wrapped(c, sizes[i]));
                    for (let j = 0; j < Math.max(...lines.map((c: Cell[][]) => c.length)); j++) {
                        const row: Cell[] = [];
                        for (let i = 0; i < count; i++) {
                            if (i)
                                row.push(...cells(' │ ', { fg: theme.colors.muted }));
                            const part = lines[i][j] ?? [];
                            row.push(...part, ...cells(' '.repeat(Math.max(0, sizes[i] - stringWidth(text(part)))), base));
                        }
                        out.push(row);
                    }
                    if (!index)
                        line(sizes.map(n => '─'.repeat(n)).join('─┼─'), { fg: theme.colors.muted });
                }
                break;
            }
            case 'hr':
                line('─'.repeat(Math.min(40, width)), { fg: theme.colors.muted });
                break;
            case 'html':
                line((token.text ?? '').replace(/<[^>]*>/g, ''));
                break;
            default: line(token.raw ?? '');
        }
    }
    return out;
}
/** Input has already passed terminal-control sanitization in presentation.clean. */
export function markdownRows(source: string, columns: number, theme: Appearance): Row[] {
    try {
        return blocks(marked.lexer(source, { gfm: true }), Math.max(1, columns), theme).map(row => ({ text: text(row), cells: row }));
    }
    catch {
        return source.split('\n').flatMap(s => wrapped(cells(s, { fg: theme.colors.text }), columns).map(row => ({ text: text(row), cells: row })));
    }
}
