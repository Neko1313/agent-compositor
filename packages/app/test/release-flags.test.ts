import { Readable, Writable } from 'node:stream';
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

describe('explicit terminal renderer selection',()=>{
  it.each([['--renderer'],['--renderer','unknown'],['--renderer','opentui','--plain'],
    ['--renderer','opentui','-p','hello'],['--renderer','ink']].map(argv=>({argv})))('rejects invalid/noninteractive selection before loading project state ($argv)',async({argv})=>{
    let output='';
    const stdout=new Writable({write(chunk,_encoding,done){output+=chunk;done();}});
    const stdin=Readable.from([]);
    expect(await main({argv,cwd:'/nonexistent-renderer-validation',env:{},stdin:stdin as NodeJS.ReadStream,stdout:stdout as NodeJS.WriteStream})).toBe(2);
    expect(output).toContain('--renderer');
  });
  it('documents the opt-in renderer without initializing native code',async()=>{
    let output='';
    const stdout=new Writable({write(chunk,_encoding,done){output+=chunk;done();}});
    expect(await main({argv:['--help'],cwd:'/nonexistent-renderer-help',env:{},stdout:stdout as NodeJS.WriteStream})).toBe(0);
    expect(output).toContain('ink (default) or opentui (experimental)');
  });
});
