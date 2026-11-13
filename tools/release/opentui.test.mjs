import {afterEach, expect, it} from 'vitest';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openTuiNativeExternals, writeOpenTuiBundle} from './opentui.mjs';
import {copyLicenseNotices} from './licenses.mjs';

const roots = [];
afterEach(async () => {for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true});});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ac-opentui-package-')); roots.push(root);
  return root;
}
const artifact = (path, content = path, kind = 'asset') => ({path, kind, async arrayBuffer() {return Buffer.from(content);}});
const result = (...outputs) => ({success: true, outputs});

it.each(['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'])('retains only the %s native dependency for bundling', platform => {
  const external = openTuiNativeExternals(platform);
  expect(external).toHaveLength(7);
  expect(external).not.toContain('@opentui/core-' + platform);
  expect(external).toContain('@opentui/core-win32-x64');
  expect(external).toContain('@opentui/core-linux-x64-musl');
});

it('preserves every worker, parser and native artifact and resolves native loading after relocation', async () => {
  const root = await fixture(), directory = join(root, 'installed renderer with spaces');
  const outputs = result(artifact('./run.js', 'export const native=process.env.OPENTUI_LIB_PATH;', 'entry-point'),
    artifact('./libopentui-native.so', 'NATIVE_LIBRARY'), artifact('./parser.worker-hash.js', 'PARSER_WORKER'),
    artifact('./tree-sitter-hash.wasm', 'PARSER_WASM'), artifact('./highlights-hash.scm', 'PARSER_QUERIES'));
  expect(await writeOpenTuiBundle(outputs, directory, 'linux-x64')).toEqual({nativeFile: 'libopentui-native.so', assets: ['index.js', 'libopentui-native.so', 'parser.worker-hash.js', 'tree-sitter-hash.wasm', 'highlights-hash.scm']});
  await writeFile(join(directory, 'package.json'), JSON.stringify({type: 'module'}));
  const previous = process.env.OPENTUI_LIB_PATH;
  const previousRoot = process.env.OTUI_ASSET_ROOT;
  try {
    delete process.env.OPENTUI_LIB_PATH;
    delete process.env.OTUI_ASSET_ROOT;
    const entry = await import(pathToFileURL(join(directory, 'index.js')).href);
    expect(entry.native).toBe(join(directory, 'libopentui-native.so'));
    for (const output of outputs.outputs.slice(1)) expect(await readFile(join(directory, output.path), 'utf8')).toBe(await output.arrayBuffer().then(value => value.toString()));
    process.env.OPENTUI_LIB_PATH = '/explicit/upstream/library.so';
    const override = await import(pathToFileURL(join(directory, 'index.js')).href + '?override');
    expect(override.native).toBe('/explicit/upstream/library.so');
    delete process.env.OPENTUI_LIB_PATH;
    process.env.OTUI_ASSET_ROOT = '/explicit/upstream/assets';
    const assetRoot = await import(pathToFileURL(join(directory, 'index.js')).href + '?asset-root');
    expect(assetRoot.native).toBeUndefined();
  } finally {
    if (previous === undefined) delete process.env.OPENTUI_LIB_PATH;
    else process.env.OPENTUI_LIB_PATH = previous;
    if (previousRoot === undefined) delete process.env.OTUI_ASSET_ROOT;
    else process.env.OTUI_ASSET_ROOT = previousRoot;
  }
});

it('refuses unsupported platforms, missing/wrong native libraries, colliding assets and multiple entries', async () => {
  const root = await fixture(), entry = artifact('./run.js', '', 'entry-point'), native = artifact('./libopentui-native.so');
  expect(() => openTuiNativeExternals('win32-x64')).toThrow('Unsupported OpenTUI release platform');
  await expect(writeOpenTuiBundle(result(entry), root)).rejects.toThrow('native library');
  await expect(writeOpenTuiBundle(result(entry, native), root, 'darwin-arm64')).rejects.toThrow('native library');
  await expect(writeOpenTuiBundle(result(entry, native, artifact('./other/index.js')), root)).rejects.toThrow('collide');
  await expect(writeOpenTuiBundle(result(entry, native, artifact('./another.js', '', 'entry-point')), root)).rejects.toThrow('exactly one renderer entry');
});

it('retains native source/author/patent notices and separate nested dependency versions', async () => {
  const root = await fixture(), destination = join(root, 'licenses');
  const packages = [
    ['node_modules/@opentui/core-linux-x64', {name: '@opentui/core-linux-x64', version: '0.8.4'}, {LICENSE: 'MIT', 'LICENSE-FFMPEG': 'LGPL', 'FFMPEG-SOURCE.md': 'Source and relinking instructions', 'AUTHORS-LIBWEBP': 'Authors', 'PATENTS-LIBWEBP': 'Patent notice'}],
    ['node_modules/react-devtools-core', {name: 'react-devtools-core', version: '6.1.5'}, {LICENSE: 'OLDER_NOTICE'}],
    ['packages/renderer-opentui/node_modules/react-devtools-core', {name: 'react-devtools-core', version: '7.0.1'}, {LICENSE: 'NESTED_NOTICE'}],
  ];
  for (const [directory, metadata, files] of packages) {
    await mkdir(join(root, directory), {recursive: true});
    for (const [name, content] of Object.entries({'package.json': JSON.stringify(metadata), ...files})) await writeFile(join(root, directory, name), content);
  }
  await copyLicenseNotices(root, destination, undefined, packages.map(([directory]) => join(directory, 'package.json')));
  for (const file of ['LICENSE-FFMPEG', 'FFMPEG-SOURCE.md', 'AUTHORS-LIBWEBP', 'PATENTS-LIBWEBP'])
    expect(await readFile(join(destination, '@opentui/core-linux-x64', file), 'utf8')).toBe(packages[0][2][file]);
  expect(await readFile(join(destination, 'react-devtools-core/LICENSE'), 'utf8')).toBe('OLDER_NOTICE');
  expect(await readFile(join(destination, 'react-devtools-core@7.0.1/LICENSE'), 'utf8')).toBe('NESTED_NOTICE');
});
