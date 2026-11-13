import {mkdir, writeFile} from 'node:fs/promises';
import {basename, join} from 'node:path';

export const openTuiRenderer = '@agent-compositor/renderer-opentui';
const supportedPlatforms = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'];
const nativePlatforms = [...supportedPlatforms, 'win32-x64', 'win32-arm64', 'linux-x64-musl', 'linux-arm64-musl'];

/** Other native optional dependencies are unavailable on the native build runner. */
export function openTuiNativeExternals(platform = `${process.platform}-${process.arch}`) {
  if (!supportedPlatforms.includes(platform)) throw Error(`Unsupported OpenTUI release platform: ${platform}`);
  return nativePlatforms.filter(value => value !== platform).map(value => '@opentui/core-' + value);
}

/** Retain every emitted worker/parser/native asset with its bundled relative name. */
export async function writeOpenTuiBundle(result, destination, platform = `${process.platform}-${process.arch}`) {
  openTuiNativeExternals(platform);
  if (!result.success) throw new AggregateError(result.logs, 'Cannot bundle the OpenTUI renderer');
  if (result.outputs.filter(output => output.kind === 'entry-point').length !== 1)
    throw Error('OpenTUI requires exactly one renderer entry');
  const extension = platform.startsWith('darwin-') ? 'dylib' : 'so';
  const natives = result.outputs.filter(output => /^libopentui(?:-[a-z0-9]+)?\.(?:so|dylib)$/.test(basename(output.path)));
  if (natives.length !== 1 || !basename(natives[0].path).endsWith('.' + extension))
    throw Error(`OpenTUI requires exactly one ${platform} native library`);
  const nativeFile = basename(natives[0].path);
  const outputs = result.outputs.map(output => ({output, name: output.kind === 'entry-point' ? 'index.js' : basename(output.path)}));
  if (new Set(outputs.map(output => output.name)).size !== outputs.length)
    throw Error('OpenTUI bundle assets collide');
  await mkdir(destination, {recursive: true});
  for (const {output, name} of outputs) {
    const content = Buffer.from(await output.arrayBuffer());
    // Bun's ordinary file-asset bundle exports a relative native path, whereas
    // OpenTUI's dlopen expects an absolute path. Resolve it before its module
    // initialization, preserving an explicitly supplied upstream override.
    const bootstrap = output.kind === 'entry-point'
      ? `if(!process.env.OPENTUI_LIB_PATH&&!process.env.OTUI_ASSET_ROOT)process.env.OPENTUI_LIB_PATH=(await import("node:url")).fileURLToPath(new URL(${JSON.stringify('./' + nativeFile)},import.meta.url));\n`
      : '';
    await writeFile(join(destination, name), bootstrap ? Buffer.concat([Buffer.from(bootstrap), content]) : content);
  }
  return {nativeFile, assets: outputs.map(output => output.name)};
}
