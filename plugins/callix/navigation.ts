import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import * as toolsSdk from '@agent-compositor/tools';
import { estimateTokens } from '@agent-compositor/context';
import type { Graph, GraphNode, GraphRelation, Query } from './adapter.js';
const indexes = new WeakMap<Graph, ReturnType<typeof makeIndex>>();
const {confinedPath}=toolsSdk;
export function filePath(cwd: string, path: string) { const p = isAbsolute(path) ? relative(resolve(cwd), path) : path; const normalized = p.replaceAll('\\', '/').replace(/^\.\//, ''); return normalized === '..' || normalized.startsWith('../') ? undefined : normalized; }
function makeIndex(graph: Graph) {
    const ids = new Map<string, GraphNode>(), names = new Map<string, GraphNode[]>(), qualified = new Map<string, GraphNode[]>(), files = new Map<string, GraphNode[]>(), incoming = new Map<string, GraphRelation[]>(), outgoing = new Map<string, GraphRelation[]>();
    const add = <T>(map: Map<string, T[]>, key: string, value: T) => { const a = map.get(key); if (a)
        a.push(value);
    else
        map.set(key, [value]); };
    for (const n of graph.nodes) {
        ids.set(n.id, n);
        add(names, n.name, n);
        add(qualified, n.qualified_name, n);
        if (n.file_path)
            add(files, n.file_path.replaceAll('\\', '/').replace(/^\.\//, ''), n);
    }
    for (const r of graph.relations) {
        add(incoming, r.target_id, r);
        add(outgoing, r.source_id, r);
    }
    return { ids, names, qualified, files, incoming, outgoing };
}
export function graphIndex(graph: Graph) { let i = indexes.get(graph); if (!i) {
    i = makeIndex(graph);
    indexes.set(graph, i);
} return i; }
export function selectSymbols(graph: Graph, args: Query): GraphNode[] {
    const i = graphIndex(graph), pattern = args.pattern ?? '';
    let nodes = pattern ? (i.ids.has(pattern) ? [i.ids.get(pattern)!] : i.qualified.get(pattern) ?? i.names.get(pattern)) : (args.path ? i.files.get(filePath(args.cwd,args.path)??'')??[] : graph.nodes);
    if (!nodes)
        nodes = graph.nodes.filter(n => (n.name + ' ' + n.qualified_name).toLowerCase().includes(pattern.toLowerCase()));
    if (pattern && !i.ids.has(pattern) && ['definition', 'read_symbol', 'callers', 'callees', 'references', 'impact'].includes(args.action)) {
        const located = nodes.filter(n => n.file_path && n.span && !['import', 'parameter', 'module', 'file', 'external_symbol'].includes(n.kind));
        if (located.length)
            nodes = located;
        else {
            const named = i.names.get(pattern)?.filter(n => n.file_path && n.span && !['import', 'parameter', 'module', 'file', 'external_symbol'].includes(n.kind));
            if (named?.length)
                nodes = named;
        }
    }
    const path = args.path ? filePath(args.cwd, args.path) : undefined;
    if (args.path && !path)
        return [];
    return nodes.filter(n => (!path || !!n.file_path && (filePath(args.cwd, n.file_path) === path)) && (!args.kinds?.length || args.kinds.includes(n.kind))).sort((a, b) => (a.file_path ?? '').localeCompare(b.file_path ?? '') || (a.span?.[0] ?? 0) - (b.span?.[0] ?? 0) || a.id.localeCompare(b.id));
}
export function compactNode(node: GraphNode) { return { id: node.id, name: node.name, qualified_name: node.qualified_name, kind: node.kind, ...(node.file_path ? { file_path: node.file_path } : {}), ...(node.span ? { span: node.span } : {}) }; }
export function quality(graph: Graph) { return { resolver_status: graph.metadata.resolver_status ?? 'unknown', ...(graph.metadata.resolver_metrics ? { resolver_metrics: graph.metadata.resolver_metrics } : {}) }; }
/** UTF-8 columns are one-based; the end position is exclusive in Callix v1. */
export function symbolSlice(bytes: Buffer, span: number[]) {
    if (span.length !== 4 || span.some(n => !Number.isSafeInteger(n) || n < 1))
        throw Error('Symbol has no usable source span');
    const starts = [0];
    for (let i = 0; i < bytes.length; i++)
        if (bytes[i] === 10)
            starts.push(i + 1);
    const point = (line: number, column: number) => { if (line > starts.length)
        throw Error('Source span exceeds file'); const start = starts[line - 1], end = line < starts.length ? starts[line] - 1 : bytes.length; const offset = start + column - 1; if (offset > end)
        throw Error('Source column exceeds line'); return offset; };
    const startByte = point(span[0], span[1]), endByte = point(span[2], span[3]);
    if (endByte <= startByte)
        throw Error('Symbol span is empty');
    const content = bytes.subarray(startByte, endByte).toString('utf8'), prefix = bytes.subarray(0, startByte).toString('utf8');
    if (!Buffer.from(content).equals(bytes.subarray(startByte, endByte)) || !Buffer.from(prefix).equals(bytes.subarray(0, startByte)))
        throw Error('Source span is not aligned to UTF-8 characters');
    return { content, startByte, endByte, range: { start: prefix.length, end: prefix.length + content.length } };
}
export async function readSymbol(graph: Graph, args: Query) {
    const selected = selectSymbols(graph, args);
    if (selected.length !== 1)
        return { symbols: selected.slice(0, args.limit ?? 40).map(compactNode), ambiguous: selected.length > 1, notFound: !selected.length, hint: 'Choose one exact symbol ID, optionally restricted by path.', metadata: quality(graph) };
    const node = selected[0];
    if (!node.file_path || !node.span)
        throw Error('Symbol has no source location; use a located definition');
    const path = filePath(args.cwd, node.file_path);
    if (!path)
        throw Error('Symbol path escapes project');
    const file = await confinedPath(args.cwd, path), bytes = await readFile(file);
    if (bytes.length > 2 * 1024 * 1024)
        throw Error('Symbol source file exceeds 2 MiB');
    if (bytes.includes(0) || !Buffer.from(bytes.toString('utf8')).equals(bytes))
        throw Error('Symbol source is not UTF-8 text');
    const slice = symbolSlice(bytes, node.span), expectedHash = createHash('sha256').update(bytes).digest('hex');
    // Never advertise a complete edit anchor alongside a truncated body.
    if (estimateTokens(slice.content) > (args.maxTokens ?? 2000) - 256)
        return { symbol: compactNode(node), path, range: slice.range, expectedHash, sourceTooLarge: true, hint: 'Increase maxTokens or read a smaller located symbol. No edit anchor was issued.', metadata: quality(graph) };
    const editRef=typeof toolsSdk.encodeEditAnchor==='function'?toolsSdk.encodeEditAnchor({path:file,expectedHash,range:slice.range,strict:true}):undefined;
    return { symbol: compactNode(node), path, content: slice.content, location: { startLine: node.span[0], endLine: node.span[2], startByte: slice.startByte, endByte: slice.endByte }, edit: { path, expectedHash, range: slice.range, strict: true }, ...(editRef?{editRef}:{}), metadata: quality(graph) };
}
/** Budget the actual JSON result, including metrics. No hidden raw graph payload. */
export function budgetResult(value: any, maxTokens = 2000, reserveTokens = 0) {
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 256 || maxTokens > 16000)
        throw Error('maxTokens must be 256..16000');
    const result = { ...value, metrics: { ...value.metrics, tokenEstimateMethod: 'utf8-weighted-heuristic', estimatedTokens: 0, bytes: 0 } };
    const size = () => estimateTokens(JSON.stringify(result));
    const refresh = () => { for (let i = 0; i < 3; i++) {
        result.metrics.estimatedTokens = size();
        result.metrics.bytes = Buffer.byteLength(JSON.stringify(result));
    } };
    refresh();
    // Graph record lists and text matches are reduced together; a caller receives
    // explicit pagination/continuation instead of silent string truncation.
    while (size() > maxTokens - reserveTokens) {
        const arrays = ['matches', 'files', 'relations', 'symbols', 'nodes', 'stages'].filter(k => Array.isArray(result[k]) && result[k].length);
        const key = arrays.sort((a, b) => JSON.stringify(result[b]).length - JSON.stringify(result[a]).length)[0];
        if (key) {
            if (key === 'nodes' && result.relations?.length)
                result.relations.pop();
            else
                result[key].pop();
            if (result.relations && result.nodes) {
                const ids = new Set(result.relations.flatMap((r: GraphRelation) => [r.source_id, r.target_id]));
                result.nodes = result.nodes.filter((n: GraphNode) => ids.has(n.id));
            }
            result.truncated = true;
            refresh();
            continue;
        }
        if (result.content !== undefined) {
            delete result.content;
            delete result.edit;
            delete result.editRef;
            result.sourceTooLarge = true;
            result.hint = 'Increase maxTokens or read a smaller symbol; no edit anchor was issued.';
            refresh();
            continue;
        }
        if (result.warnings) {
            delete result.warnings;
            result.truncated = true;
            refresh();
            continue;
        }
        if (result.metadata) {
            result.metadata = { resolver_status: result.metadata.resolver_status ?? 'unknown', detailsOmitted: true };
            if (size() <= maxTokens - reserveTokens)
                break;
            delete result.metadata;
            refresh();
            continue;
        }
        throw Error('Result cannot fit maxTokens; increase the budget');
    }
    refresh();
    return result;
}
