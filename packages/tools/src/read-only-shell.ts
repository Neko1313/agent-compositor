import { access, realpath } from 'node:fs/promises';
import { basename, dirname, delimiter, isAbsolute, relative, resolve } from 'node:path';
/** Deliberately small POSIX subset. No expansions, redirects, jobs or subshells. */
export function readCommandParts(source: string): string[][] | undefined {
    if (!source.trim() || source.length > 12000 || /[\r\n\0]/.test(source))
        return;
    const parts: string[][] = [[]];
    let word = '', started = false, quote = '';
    const flush = () => { if (started)
        parts.at(-1)!.push(word); word = ''; started = false; };
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (quote === "'") {
            if (c === "'")
                quote = '';
            else
                word += c;
            continue;
        }
        if (quote === '"') {
            if (c === '"') {
                quote = '';
                continue;
            }
            if (c === '$' || c === '`')
                return;
            if (c === '\\' && /["\\$`]/.test(source[i + 1] ?? '')) {
                word += source[++i];
                continue;
            }
            word += c;
            continue;
        }
        if (c === '"' || c === "'") {
            quote = c;
            started = true;
            continue;
        }
        if (c === '\\') {
            if (i + 1 === source.length)
                return;
            word += source[++i];
            started = true;
            continue;
        }
        if (/[\s]/.test(c)) {
            flush();
            continue;
        }
        if (c === '|' || c === '&' || c === ';') {
            flush();
            if (!parts.at(-1)!.length)
                return;
            if (c === '&' && source[i + 1] !== '&')
                return;
            if ((c === '|' || c === '&') && source[i + 1] === c)
                i++;
            parts.push([]);
            continue;
        }
        if (/[<>$`(){}*?\[\]~#]/.test(c))
            return;
        word += c;
        started = true;
    }
    if (quote)
        return;
    flush();
    if (parts.some(p => !p.length))
        return;
    return parts;
}
const switches: Record<string, RegExp> = {
    ls: /^-(?:[aAbBcCdDfFgGhHiIklLmNnOpqQrRsStTuUvwxX1]+|-all|-almost-all|-directory|-human-readable|-recursive|-color(?:=(?:auto|always|never))?)$/,
    grep: /^-(?:[nrilIHsovqFwxcEahb]+|-line-number|-ignore-case|-recursive|-files-with-matches|-fixed-strings|-extended-regexp|-invert-match|-count|-quiet|-with-filename|-no-filename)$/,
    rg: /^-(?:[nliIHsvqFwxcSUEa]+|-files|-hidden|-no-config|-line-number|-ignore-case|-smart-case|-fixed-strings|-word-regexp|-count|-files-with-matches|-json|-no-heading|-heading|-with-filename|-no-filename|-multiline|-stats|-only-matching|-color=(?:never|auto|always))$/,
    cat: /^-(?:[AbEnstTuv]+|-number|-show-all|-help|-version)$/,
    head: /^-(?:[qv]+|[0-9]+|-quiet|-verbose)$/,
    tail: /^-(?:[qv]+|[0-9]+|-quiet|-verbose)$/,
    wc: /^-(?:[clmwL]+|-bytes|-chars|-lines|-words|-max-line-length)$/,
    stat: /^-(?:[fLt]+|-file-system|-dereference|-terse)$/,
    pwd: /^-(?:[LP]+|-logical|-physical)$/,
};
const values: Record<string, string[]> = { grep: ['-e', '--regexp', '-A', '-B', '-C', '--after-context', '--before-context', '--context', '-m', '--max-count', '--include', '--exclude', '--exclude-dir'], rg: ['-e', '--regexp', '-g', '--glob', '-t', '--type', '--type-not', '-A', '-B', '-C', '-m', '--max-count', '--max-depth', '--context', '--after-context', '--before-context'], head: ['-n', '-c', '--lines', '--bytes'], tail: ['-n', '-c', '--lines', '--bytes'] };
async function inProject(path: string, root: string, cwd: string) {
    const absolute = resolve(cwd, path);
    const target = await realpath(absolute).catch(async (e: any) => { if (e.code !== 'ENOENT')
        throw e; return resolve(await realpath(dirname(absolute)), basename(absolute)); });
    const rel = relative(root, target);
    return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !/(?:^|\/)(?:\.env(?:\.[^/]*)?|credentials?(?:\.[^/]*)?)(?:$|\/)/i.test(rel);
}
/** Only the original builtin exec uses this classification; deny/ask rules still win. */
export async function isReadOnlyShell(command: string, cwd: string, root: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
    try {
        const parts = readCommandParts(command);
        if (!parts)
            return false;
        root = await realpath(root);
        cwd = await realpath(cwd);
        if (!await inProject(cwd, root, root))
            return false;
        for (const [program, ...args] of parts) {
            const name = basename(program);
            if (!Object.hasOwn(switches, name))
                return false;
            const executable = program.includes('/') ? resolve(cwd, program) : await (async () => { for (const dir of (env.PATH ?? '').split(delimiter)) {
                const p = resolve(cwd, dir || ".", program);
                if (await access(p, 1).then(() => true, () => false))
                    return p;
            } throw Error('Missing executable'); })();
            const binary = await realpath(executable);
            if (!['/usr/bin/' + name, '/bin/' + name].includes(binary))
                return false;
            if (name === 'rg' && env.RIPGREP_CONFIG_PATH && !args.includes('--no-config'))
                return false;
            let pattern = name !== 'grep' && name !== 'rg' || name === 'rg' && args.includes('--files'), end = false;
            for (let i = 0; i < args.length; i++) {
                const arg = args[i];
                if (arg === '--' && !end) {
                    end = true;
                    continue;
                }
                if (!end && arg.startsWith('-') && arg !== '-') {
                    const [flag, ...assigned] = arg.split('=');
                    if (values[name]?.includes(flag)) {
                        const value = assigned.length ? assigned.join('=') : args[++i];
                        if (value === undefined)
                            return false;
                        if (flag === '-e' || flag === '--regexp')
                            pattern = true;
                        else if (!['-g', '--glob', '-t', '--type', '--type-not', '--include', '--exclude', '--exclude-dir'].includes(flag) && !/^\+?\d+$/.test(value))
                            return false;
                    }
                    else if (!switches[name].test(arg))
                        return false;
                }
                else if (!pattern)
                    pattern = true;
                else if (!await inProject(arg, root, cwd))
                    return false;
            }
        }
        return true;
    }
    catch {
        return false;
    }
}
