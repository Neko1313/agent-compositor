import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir, chmod, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentCore, ScriptedProvider } from '@agent-compositor/core';
import { isReadOnlyShell } from '@agent-compositor/tools';
import { readCommandParts } from '../../tools/src/read-only-shell.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true }); });
async function temp() { const d = await mkdtemp(join(tmpdir(), 'readonly-')); roots.push(d); return d; }
it('allows verified local reads and pipelines without an approval model or human', async () => {
    const cwd = await temp();
    await mkdir(join(cwd, 'src'));
    await writeFile(join(cwd, 'src/a.txt'), 'needle\n');
    let asks = 0;
    const core = new AgentCore({ cwd, provider: new ScriptedProvider([]), onApproval: async () => { asks++; return false; } });
    for (const command of ['ls -la src', "grep -n 'needle' src/a.txt", 'ls src | head -1', 'pwd && wc -l src/a.txt'])
        expect((await core.invokeTool('exec', { command })).ok, command).toBe(true);
    expect(asks).toBe(0);
});
it('does not auto-allow write effects, substitutions, external paths, executable flags or shadow binaries', async () => {
    const cwd = await temp(), outside = await temp();
    await writeFile(join(cwd, '.env'), 'private');
    await symlink(outside, join(cwd, 'escape'));
    const attacks = ['ls; touch hacked', 'ls > hacked', 'ls $(touch hacked)', 'ls `touch hacked`', 'ls &', 'ls /etc', 'cat .env', 'ls escape', 'rg --pre sh needle .', 'rg --follow needle .', "grep -R 'needle' .", 'find . -exec touch hacked \\;', 'ls *.ts', 'PATH=/tmp ls', 'ls\nwhoami'];
    for (const command of attacks)
        expect(await isReadOnlyShell(command, cwd, cwd), command).toBe(false);
    expect(readCommandParts("grep '$(literal)' src/a")).toEqual([['grep', '$(literal)', 'src/a']]);
    const bin = join(cwd, 'bin');
    await mkdir(bin);
    await writeFile(join(bin, 'ls'), '#!/bin/sh\ntouch hacked\n');
    await chmod(join(bin, 'ls'), 0o755);
    expect(await isReadOnlyShell('ls', cwd, cwd, { PATH: bin + ':' + process.env.PATH })).toBe(false);
    expect(await isReadOnlyShell('rg needle .', cwd, cwd, { ...process.env, RIPGREP_CONFIG_PATH: 'custom' })).toBe(false);
    const core = new AgentCore({ cwd, provider: new ScriptedProvider([]), onApproval: async () => false });
    expect((await core.invokeTool('exec', { command: 'ls; touch hacked' })).ok).toBe(false);
    await expect(readFile(join(cwd, 'hacked'))).rejects.toThrow();
});
it('keeps explicit ask/deny rules binding for verified read commands', async () => {
    const cwd = await temp();
    for (const decision of ['ask', 'deny'] as const) {
        let asks = 0;
        const core = new AgentCore({ cwd, provider: new ScriptedProvider([]), rules: [{ tool: 'exec', decision }], onApproval: async () => { asks++; return false; } });
        expect((await core.invokeTool('exec', { command: 'ls' })).ok).toBe(false);
        expect(asks).toBe(decision === 'ask' ? 1 : 0);
    }
});
