import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import metadata from '../package.json' with { type: 'json' };
import { main } from '../src/main.js';

describe('release CLI metadata', () => {
  it.each(['--version', '-v', '--help', '-h'])('handles %s without opening a project or provider', async flag => {
    let output = '';
    const stdout = new Writable({ write(chunk, _encoding, done) { output += chunk; done(); } });
    const result = await main({ argv: [flag], cwd: '/nonexistent-release-smoke', env: {}, stdout: stdout as NodeJS.WriteStream });
    expect(result).toBe(0);
    if (flag === '--version' || flag === '-v') expect(output).toBe(`compositor ${metadata.version}\n`);
    else expect(output).toContain('Usage: compositor');
  });
});
