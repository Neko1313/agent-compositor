import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const UPNG = createRequire(import.meta.url)("upng-js");
export const states = [
  "idle",
  "thinking",
  "searching",
  "editing",
  "planning",
  "waiting_subagents",
  "question",
  "approval",
  "done",
  "error",
] as const;
export type State = (typeof states)[number];
export interface Frame {
  width: number;
  height: number;
  rgba: string;
  delay: number;
}
export interface Config {
  enabled?: boolean;
  paused?: boolean;
  pack?: string;
  animations?: Partial<Record<State, string>>;
  tools?: Record<string, State>;
  reactions?: Record<string, State>;
}
export const defaultPack = fileURLToPath(new URL("./assets/", import.meta.url));
export async function decode(file: string): Promise<Frame[]> {
  const bytes = await readFile(file);
  if (
    bytes.length > 2 * 1024 * 1024 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  )
    throw Error("Invalid or oversized PNG");
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  let count = 1,
    actualFrames = 0;
  for (let i = 8; i + 12 <= bytes.length; ) {
    const length = bytes.readUInt32BE(i);
    if (i + 12 + length > bytes.length) throw Error("Truncated PNG");
    const type = bytes.toString("ascii", i + 4, i + 8);
    if (type === "acTL") {
      if (length !== 8) throw Error("Invalid animation header");
      count = bytes.readUInt32BE(i + 8);
    }
    if (type === "fcTL") {
      if (length !== 26) throw Error("Invalid frame header");
      actualFrames++;
      const w = bytes.readUInt32BE(i + 12),
        h = bytes.readUInt32BE(i + 16),
        x = bytes.readUInt32BE(i + 20),
        y = bytes.readUInt32BE(i + 24);
      if (!w || !h || w + x > width || h + y > height)
        throw Error("Frame outside PNG canvas");
    }
    i += length + 12;
  }
  if (
    !width ||
    !height ||
    width > 512 ||
    height > 512 ||
    (actualFrames > 0 && actualFrames !== count) ||
    !count ||
    count > 120 ||
    width * height * count > 8_000_000
  )
    throw Error("PNG dimensions/frame budget exceeded");
  const data = UPNG.decode(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  );
  // APNG specifies BACKGROUND for PREVIOUS on the first frame; older UPNG
  // otherwise looks for a nonexistent preceding frame. Originals stay intact.
  if (data.frames[0]?.dispose === 2) data.frames[0].dispose = 1;
  const decoded: ArrayBuffer[] = UPNG.toRGBA8(data);
  return decoded.map((buffer, index) => {
    const source = new Uint8Array(buffer),
      scale = Math.min(1, 96 / Math.max(width, height)),
      w = Math.max(1, Math.floor(width * scale)),
      h = Math.max(1, Math.floor(height * scale)),
      out = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4;
        out.set(source.subarray(i, i + 4), (y * w + x) * 4);
      }
    return {
      width: w,
      height: h,
      rgba: out.toString("base64"),
      delay: Math.max(80, Math.min(2000, data.frames[index]?.delay || 180)),
    };
  });
}
export class AnimationPack {
  cache = new Map<State, Promise<Frame[]>>();
  constructor(private cwd: string, private config: Config) {}
  async load(state: State): Promise<Frame[]> {
    if (!this.cache.has(state)) this.cache.set(state, this.read(state));
    return this.cache.get(state)!;
  }
  private async read(state: State) {
    const root = await realpath(
      this.config.pack ? resolve(this.cwd, this.config.pack) : defaultPack
    );
    if (this.config.pack) {
      const rel = relative(await realpath(this.cwd), root);
      if (rel.startsWith("..") || isAbsolute(rel))
        throw Error("Pack must be inside the project");
    }
    const file = await realpath(
      resolve(root, this.config.animations?.[state] ?? `${state}.apng`)
    );
    const rel = relative(root, file);
    if (rel.startsWith("..") || isAbsolute(rel))
      throw Error("Animation must be inside its pack");
    return decode(file);
  }
}
