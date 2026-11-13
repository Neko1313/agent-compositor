import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, realpath, readFile, stat } from 'node:fs/promises';
import { resolve, join, dirname, sep } from 'node:path';
import ignore from 'ignore';
import {encodeReadCursor,readHash,readPageEnd,type ReadCursor} from './read-cursor.js';
import type {ReadArgs} from './tools/fs.js';
const exec = promisify(execFile);
const excluded = /(^|\/)(\.git|node_modules|dist|build|coverage|\.agent-compositor)(\/|$)/;
export async function confinedPath(root: string, value: string, missing = false): Promise<string> {
    const base = await realpath(root), target = resolve(base, value);
    if (target !== base && !target.startsWith(base + sep))
        throw new Error('Path escapes project');
    let resolved: string;
    try {
        resolved = await realpath(target);
    }
    catch (error) {
        if (!missing || !['ENOENT', 'ENOTDIR'].includes((error as any).code))
            throw error;
        resolved = await confinedPath(base, dirname(target), true);
    }
    if (resolved !== base && !resolved.startsWith(base + sep))
        throw new Error('Symlink escapes project');
    return target;
}
export async function projectFiles(root: string, limit = 20000): Promise<string[]> {
    let files: string[];
    try {
        files = (await exec('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, maxBuffer: 8 * 1024 * 1024, timeout: 10000 })).stdout.split('\0').filter(Boolean);
    }
    catch {
        files = [];
        const visit = async (dir: string, inherited: Array<{
            base: string;
            rules: ReturnType<typeof ignore>;
        }>): Promise<void> => {
            const rules = [...inherited, { base: dir, rules: ignore().add(await readFile(join(root, dir, '.gitignore'), 'utf8').catch(() => '')) }];
            for (const entry of (await readdir(join(root, dir), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
                const path = join(dir, entry.name).replaceAll('\\', '/');
                let ignored = false;
                for (const layer of rules) {
                    const local = path.slice(layer.base ? layer.base.length + 1 : 0) + (entry.isDirectory() ? '/' : '');
                    const result = layer.rules.test(local);
                    if (result.ignored)
                        ignored = true;
                    else if (result.unignored)
                        ignored = false;
                }
                if (excluded.test(path) || files.length >= limit || ignored)
                    continue;
                if (entry.isDirectory())
                    await visit(path, rules);
                else if (entry.isFile())
                    files.push(path);
            }
        };
        await visit('', []);
    }
    const policy = ignore();
    for (const file of ['.agentignore', '.geminiignore'])
        policy.add(await readFile(join(root, file), 'utf8').catch(() => ''));
    // Git can report deleted tracked files and tracked symlinks. Neither may escape
    // the project or make the whole query fail; validate before any text search.
    const candidates = [...new Set(files)].filter(file => file && !file.startsWith('../') && !excluded.test(file) && !policy.ignores(file)).sort();
    const valid: string[] = [];
    for (let i = 0; i < candidates.length && valid.length < limit; i += 64) {
        const batch = await Promise.all(candidates.slice(i, i + 64).map(async (file) => { try {
            const p = await confinedPath(root, file);
            return (await stat(p)).isFile() ? file : undefined;
        }
        catch {
            return undefined;
        } }));
        valid.push(...batch.filter((s): s is string => !!s));
    }
    return valid.slice(0, limit);
}
export function glob(pattern: string): RegExp {
    const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '(?:.*/)?').replace(/\u0001/g, '.*');
    return new RegExp(`^(?:${source})(?:/.*)?$`);
}
export interface ProjectQuery {
    cwd: string;
    action: 'glob' | 'grep';
    pattern: string;
    path?: string;
    regex?: boolean;
    limit?: number;
    offset?: number;
}
interface TextMatch {
    path:string;line:number;text:string;column?:number;textOffset?:number;textTruncated?:boolean;readArgs?:ReadArgs;
    readView?:Omit<ReadCursor,'path'>;
}
function textMatch(path:string,line:number,text:string,index:number):TextMatch {
    if(Buffer.byteLength(text,'utf8')<=2000)return{path,line,text};
    let start=Math.max(0,index-256);
    if(start>0&&/[\uD800-\uDBFF]/.test(text[start-1])&&/[\uDC00-\uDFFF]/.test(text[start]))start--;
    const end=readPageEnd(text,start,2000,2000);
    return{path,line,text:text.slice(start,end),column:index+1,textOffset:start,textTruncated:true,
        readView:{offset:line,limit:1,index:start,hash:readHash(text)}};
}
export async function queryProject(raw: unknown, signal?: AbortSignal): Promise<any> {
    const args = raw as ProjectQuery;
    if (typeof args.pattern !== 'string' || args.pattern.length > 1000 || !['glob', 'grep'].includes(args.action))
        throw Error('Invalid project query');
    const limit = args.limit ?? 40, offset = args.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(offset) || offset < 0 || offset > 100000)
        throw Error('Invalid query pagination');
    signal?.throwIfAborted();
    const all = await projectFiles(args.cwd), scope = args.path?.replaceAll('\\', '/').replace(/\/$/, '');
    if (scope)
        await confinedPath(args.cwd, scope);
    const files = all.filter(file => !scope || file === scope || file.startsWith(scope + '/'));
    if (args.action === 'glob') {
        const found = files.filter(file => glob(args.pattern).test(file));
        return { files: found.slice(offset, offset + limit), total: found.length, offset, truncated: found.length > offset + limit,...(!found.length&&offset===0?{hint:"No files returned for this pattern/filter. Use glob pattern **/* from a known project directory to discover actual paths; do not invent a filename."}:{}) };
    }
    const matches:TextMatch[] = [];
    let scannedFiles = 0,scannedBytes=0,scanLimited=false;const scan={skip:offset};const deadline=Date.now()+10000;
    if (args.regex) {
        const safe: string[] = [];
        for (const f of files) {
            signal?.throwIfAborted();
            if(Date.now()>deadline){scanLimited=true;break;}
            const size=(await stat(join(args.cwd,f)).catch(()=>null))?.size;
            if(size!==undefined&&size<=1024*1024){
                if(scannedBytes+size>32*1024*1024){scanLimited=true;break;}scannedBytes+=size;
                const bytes = await readFile(await confinedPath(args.cwd, f)).catch(() => null);
                if (bytes && !bytes.includes(0) && Buffer.from(bytes.toString('utf8'),'utf8').equals(bytes))
                    safe.push(f);
            }
        }
        for (let i = 0; i < safe.length && matches.length < limit + 1; i += 128) {
            const batch = safe.slice(i, i + 128);
            if(Date.now()>deadline){scanLimited=true;break;}
            await regexSearch(args, batch, matches, limit + 1, signal,scan,Math.max(100,deadline-Date.now()));
            scannedFiles += batch.length;
        }
    }
    else
        for (const file of files) {
            signal?.throwIfAborted();
            if(Date.now()>deadline){scanLimited=true;break;}
            if (matches.length >= limit + 1)
                break;
            try {
                const path = await confinedPath(args.cwd, file), info = await stat(path);
                scannedFiles++;
                if (info.size > 1024 * 1024)
                    continue;
                if(scannedBytes+info.size>32*1024*1024){scanLimited=true;break;}scannedBytes+=info.size;
                const bytes = await readFile(path),text=bytes.toString('utf8');
                if (bytes.includes(0)||!Buffer.from(text,'utf8').equals(bytes))
                    continue;
                for (const [index, line] of text.split('\n').entries()) {
                    const matchIndex=line.indexOf(args.pattern);
                    if(matchIndex>=0&&scan.skip>0){scan.skip--;continue;}
                    if (matchIndex>=0)
                        matches.push(textMatch(file,index+1,line,matchIndex));
                    if (matches.length >= limit + 1)
                        break;
                }
            }
            catch (e: any) {
                if (!['ENOENT', 'ENOTDIR'].includes(e.code))
                    throw e;
            }
        }
    const selected:TextMatch[]=[],paths=new Map<string,string>();
    for(const match of matches.slice(0,limit)){
        signal?.throwIfAborted();
        const {readView,...result}=match;
        if(readView){
            let path=paths.get(match.path);
            if(path===undefined){path=await realpath(await confinedPath(args.cwd,match.path));paths.set(match.path,path);}
            result.readArgs={path,offset:match.line,limit:1,maxChars:2000,...(readView.index>0?{cursor:encodeReadCursor({path,...readView})}:{})};
        }
        selected.push(result);
    }
    return { matches: selected, offset, truncated: matches.length > limit, scannedFiles,scannedBytes,...(scanLimited?{scanLimited:true,hint:"Scan cap reached; narrow the path or pattern"}:!matches.length&&offset===0?{hint:"No text matches returned. Try a shorter literal source fragment or use glob pattern **/* to discover filenames before reading; an empty text search does not identify a file to open."}:{}) };
}
/** Streaming rg prevents a small result limit from buffering the whole repository. */
async function regexSearch(args: ProjectQuery, files: string[], matches: TextMatch[], max: number, signal?: AbortSignal,scan={skip:0},timeoutMs=10000): Promise<void> {
    return new Promise((accept, reject) => {
        signal?.throwIfAborted();
        // Pin the raw UTF-8 view used by read; user rg config can enable
        // transcoding, multiline output or preprocessors with different content.
        const proc = spawn('rg', ['--no-config', '--json', '--encoding', 'none', '--sort', 'path', '--no-messages', '-e', args.pattern, '--', ...files], { cwd: args.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let buffer = '', stderr = '', failure: Error | undefined, limited = false;
        const stop = () => proc.kill('SIGTERM');
        const abort = () => { failure = Error('Search cancelled'); stop(); };
        signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(() => { failure = Error('Search timed out'); stop(); }, timeoutMs);
        proc.stdout.setEncoding('utf8');
        proc.stderr.setEncoding('utf8');
        proc.stdout.on('data', chunk => { if (limited || failure)
            return; buffer += chunk; let index: number; while ((index = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            try {
                const item = JSON.parse(line);
                if (item.type === 'match') {
                    if(scan.skip>0){scan.skip--;continue;}
                    const text=item.data.lines.text.replace(/\n$/, ''),start=item.data.submatches[0].start,bytes=Buffer.from(text,'utf8');
                    if(!Number.isSafeInteger(start)||start<0||start>bytes.length)throw Error('Invalid search location');
                    const prefix=bytes.subarray(0,start).toString('utf8');
                    if(!Buffer.from(prefix,'utf8').equals(bytes.subarray(0,start)))throw Error('Invalid search UTF-8 boundary');
                    matches.push(textMatch(item.data.path.text,item.data.line_number,text,prefix.length));
                    if (matches.length >= max) {
                        limited = true;
                        stop();
                        break;
                    }
                }
            }
            catch {
                failure = Error('Invalid search output');
                stop();
                break;
            }
        } if (buffer.length > 2 * 1024 * 1024) {
            failure = Error('Search line exceeds limit');
            stop();
        } });
        proc.stderr.on('data', s => { stderr = (stderr + s).slice(0, 4000); });
        proc.on('error', e => { failure = e; });
        proc.on('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', abort); if (failure)
            reject(failure);
        else if (!limited && code !== 0 && code !== 1)
            reject(Error(`Regex search failed: ${stderr}`));
        else
            accept(); });
    });
}
