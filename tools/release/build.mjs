// Run with Bun on the target platform so native plugin dependencies match it.
import { cp, mkdir, readdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { installCallix } from '../../plugins/callix/distribution.mjs';
import { copyPluginResources } from './resources.mjs';
import {copyLicenseNotices} from './licenses.mjs';
import {openTuiRenderer, openTuiNativeExternals, writeOpenTuiBundle} from './opentui.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const app = JSON.parse(await readFile('packages/app/package.json', 'utf8'));
const version = `v${pkg.version}`;
if (app.version !== pkg.version) throw new Error('Root and app versions must match');
if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== version) throw new Error('Tag must match package versions');
const platform = `${process.platform}-${process.arch}`;
if (!['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'].includes(platform)) throw new Error(`Unsupported platform: ${platform}`);
const output = resolve('dist/release');
const stage = join(output, platform, 'compositor');
await rm(join(output, platform), { recursive: true, force: true });
await mkdir(stage, { recursive: true });
const exists = path => access(path).then(() => true, () => false);
async function bundle(entry, outfile, external = [openTuiRenderer]) {
  const result = await Bun.build({ entrypoints: [entry], target: 'bun', format: 'esm', external });
  if (!result.success) throw new AggregateError(result.logs, `Cannot bundle ${entry}`);
  if (result.outputs.length !== 1) throw new Error(`Unexpected assets in ${entry}`);
  await writeFile(outfile, Buffer.from(await result.outputs[0].arrayBuffer()));
}
// Keep OpenTUI lazy. Bundle its JS once and retain every native/parser asset;
// disk packages with bare scoped imports are not relocatable in standalone Bun.
const rendererDest = join(stage, 'node_modules', openTuiRenderer);
await mkdir(rendererDest, {recursive: true});
const rendererMetadata = JSON.parse(await readFile('packages/renderer-opentui/package.json', 'utf8'));
const rendererBuild = await Bun.build({entrypoints: ['packages/renderer-opentui/src/run.tsx'], target: 'bun', format: 'esm', external: openTuiNativeExternals(platform), metafile: true});
await writeOpenTuiBundle(rendererBuild, rendererDest, platform);
await writeFile(join(rendererDest, 'package.json'), JSON.stringify({name: rendererMetadata.name, version: rendererMetadata.version, type: 'module', main: './index.js', exports: './index.js'}) + '\n');
// Plugins remain external and replaceable; compile their dependencies into each entry.
for (const name of await readdir('plugins')) {
  const source = join('plugins', name), dest = join(stage, 'plugins', name);
  if (!await exists(join(source, 'plugin.json'))) continue;
  await mkdir(dest, { recursive: true });
  const manifest = JSON.parse(await readFile(join(source, 'plugin.json'), 'utf8'));
  const entry = manifest.main ?? manifest.entry ?? (await exists(join(source, 'hooks.ts')) ? 'hooks.ts' : undefined);
  if (entry) { await bundle(join(source, entry), join(dest, 'hooks.js')); manifest.main = 'hooks.js'; delete manifest.entry; }
  if (await exists(join(source, 'tools.ts'))) await bundle(join(source, 'tools.ts'), join(dest, 'tools.js'));
  await writeFile(join(dest, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
  await copyPluginResources(source, dest, manifest);
}
// The catalog ships offline; its packages remain inactive until explicit selection.
await mkdir(join(stage,'.claude-plugin'),{recursive:true});
await cp('.claude-plugin/marketplace.json',join(stage,'.claude-plugin/marketplace.json'));
await cp('examples/plugins/portable-example',join(stage,'examples/plugins/portable-example'),{recursive:true});
// Resolve a target-specific verified upstream release, not the ignored local bin/.
const callix = await installCallix({ destination: join(stage, 'plugins/callix'), platform, archivePath: process.env.CALLIX_RELEASE_ARCHIVE });
console.log(`Bundled Callix ${callix.version} for ${callix.platform} (${callix.archiveSha256})`);
// Monty runs in a Node bridge with a platform-specific native worker.
const dependencies = ['@pydantic/monty', `@pydantic/monty-${platform}${process.platform === 'linux' ? '-gnu' : ''}`];
const copied = new Set();
for (const dep of dependencies) {
  if (copied.has(dep)) continue;
  copied.add(dep);
  const source = join('node_modules', dep);
  const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  await cp(source, join(stage, 'plugins/monty/node_modules', dep), { recursive: true, dereference: true });
  dependencies.push(...Object.keys(metadata.dependencies ?? {}));
}
// Native marketplace extensions can import the host's public runtime API.
for (const name of await readdir('packages')) {
  const source = join('packages', name);
  if (!await exists(join(source, 'src/index.ts'))) continue;
  const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  if (metadata.name === openTuiRenderer) continue;
  const dest = join(stage, 'node_modules', metadata.name);
  await mkdir(dest, { recursive: true });
  await bundle(join(source, 'src/index.ts'), join(dest, 'index.js'));
  await writeFile(join(dest, 'package.json'), JSON.stringify({ name: metadata.name, version: metadata.version, type: 'module', main: './index.js', exports: './index.js' }) + '\n');
}
// Preserve third-party license texts for bundled modules as well as disk modules.
await copyLicenseNotices(root,join(stage,'licenses'),undefined,Object.keys(rendererBuild.metafile.inputs));
const command = ['build', '--compile', 'packages/app/src/bin.ts', '--external', openTuiRenderer, '--outfile', join(stage, 'compositor')];
if (process.arch === 'x64') command.push(`--target=bun-${process.platform === 'darwin' ? 'darwin' : 'linux'}-x64-baseline`);
execFileSync(process.execPath, command, { stdio: 'inherit' });
for (const file of ['LICENSE', 'README.md', 'install.sh']) await cp(file, join(stage, file));
await writeFile(join(stage, 'VERSION'), version + '\n');
const archive = `compositor-${platform}.tar.gz`;
execFileSync('tar', ['-czf', join(output, archive), '-C', join(output, platform), 'compositor'], { stdio: 'inherit' });
console.log(`Built ${version}: ${join(output, archive)}`);
