import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

it('keeps host changes unreleased when an independent plugin tag points at HEAD',async()=>{
 const root=await mkdtemp(join(tmpdir(),'compositor-host-changelog-'));
 let date='2026-01-01T00:00:00Z';
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',env:{...process.env,GIT_AUTHOR_DATE:date,GIT_COMMITTER_DATE:date}}).trim();
 try{
  git('init','--quiet');git('config','user.name','Release fixture');git('config','user.email','fixture@example.invalid');
  await writeFile(join(root,'example'),'initial');git('add','.');git('commit','--quiet','-m','feat: initial host');git('tag','-a','v1.0.0','-m','Host release');
  date='2026-01-02T00:00:00Z';
  await writeFile(join(root,'example'),'fixed');git('add','.');git('commit','--quiet','-m','fix: preserve host changes');
  const change=git('rev-parse','HEAD');git('tag','-a','plugin/ci-review/v0.1.0','-m','Independent plugin release');
  const context=JSON.parse(execFileSync(resolve('node_modules/.bin/git-cliff'),['--config',resolve('cliff.toml'),'--unreleased','--context'],{cwd:root,encoding:'utf8'}));
  expect(context[0].commits.map(commit=>commit.id)).toEqual([change]);
  expect(context[0].previous.version).toBe('v1.0.0');
 }finally{await rm(root,{recursive:true,force:true});}
});
