import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import UPNG from "upng-js";
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
  /** Repair the supplied pack's accidentally transparent dark line art. Custom packs default off. */
  restoreInk?: boolean;
  paused?: boolean;
  pack?: string;
  animations?: Partial<Record<State, string>>;
  tools?: Record<string, State>;
  reactions?: Record<string, State>;
}
export const defaultPack = fileURLToPath(new URL("./assets/", import.meta.url));
/** Recover existing line-art RGB near the visible sprite; never paint the matte. */
export function restoreDarkInk(buffer: ArrayBuffer, width: number, height: number): Buffer {
  const rgba = Buffer.from(buffer).subarray(0);
  const output = Buffer.from(rgba);
  const distance = new Uint16Array(width * height);
  for (let p = 0; p < distance.length; p++) distance[p] = rgba[p * 4 + 3] >= 128 ? 0 : 1024;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x;
    distance[p] = Math.min(distance[p], x ? distance[p - 1] + 1 : 1024, y ? distance[p - width] + 1 : 1024);
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const p = y * width + x;
    distance[p] = Math.min(distance[p], x + 1 < width ? distance[p + 1] + 1 : 1024, y + 1 < height ? distance[p + width] + 1 : 1024);
    const i = p * 4;
    if (distance[p] <= 12 && rgba[i + 3] === 0 && Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) <= 48) output[i + 3] = 255;
  }
  return output;
}

export async function decode(file: string, repairInk = false): Promise<Frame[]> {
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
    return {
      width,
      height,
      rgba: (repairInk ? restoreDarkInk(buffer, width, height) : Buffer.from(buffer)).toString("base64"),
      delay: Math.max(20, Math.min(10000, data.frames[index]?.delay || 180)),
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
    return decode(file, this.config.restoreInk ?? !this.config.pack);
  }
}
