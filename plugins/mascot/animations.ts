import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import UPNG from "upng-js";
import { GifReader } from "omggif";
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
export type AnimationFrames = Frame[] & { plays?: number };
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
// Repair applies automatically only to the exact historical files, never new art.
const legacyInk = new Set([
  "8af078d87c2a51bd96fee854219a7cf935eded6dd86b2d8fa9d0aba7ad6c8369",
  "09ae93ecd10f30d0b03a00c4f71abca5b4e36e0fd4ada61b8443a142d2e6df74",
  "2a888ba9d3be4940503919dfbbfe914f248ae2d3317c04da0ae0af2fc40ac673",
  "6effe056155600b5344eb83e547cdec87e01497c9fa5bc75ae369f10497b56b1",
  "68a9f4d0e86389f863786eecfdd33a32504683b708d8944e4f5defc2e3940941",
  "e87406b92e62f76139a22dd59845a597ea0510beabdaa96f14627e9f4131aaf6",
  "c5131b764f2628829b942d7688526bdc4473dfbbf4b76a6b77a3f6d4660f40d6",
  "3145b96c6a735ad245308d66e2c575e0da9d7a491bebab28fa4034c6c811339a",
  "33482eadeb0dc3a89485c4494bc78826b09c080b0d330ad94433f81d05a02891",
  "c89ee6743b60a4c574eda0bf59b1be96b7001ae330fcc31b2b89eaacb4b5497d"
]);
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

export async function decode(file: string, repairInk: boolean | "legacy" = false): Promise<AnimationFrames> {
  const bytes = await readFile(file);
  if(bytes.length > 2 * 1024 * 1024)throw Error("Animation exceeds 2 MiB");
  if(["GIF87a","GIF89a"].includes(bytes.subarray(0,6).toString("ascii")))return decodeGif(bytes);
  if (
    bytes.length > 2 * 1024 * 1024 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  )
    throw Error("Invalid or oversized PNG");
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  let count = 1, plays = 1,
    actualFrames = 0;
  for (let i = 8; i + 12 <= bytes.length; ) {
    const length = bytes.readUInt32BE(i);
    if (i + 12 + length > bytes.length) throw Error("Truncated PNG");
    const type = bytes.toString("ascii", i + 4, i + 8);
    if (type === "acTL") {
      if (length !== 8) throw Error("Invalid animation header");
      count = bytes.readUInt32BE(i + 8);
      plays = bytes.readUInt32BE(i + 12);
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
    count > 600 ||
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
  const repair = repairInk === "legacy" ? legacyInk.has(createHash("sha256").update(bytes).digest("hex")) : repairInk;
  return Object.assign(decoded.map((buffer, index) => {
    return {
      width,
      height,
      rgba: (repair ? restoreDarkInk(buffer, width, height) : Buffer.from(buffer)).toString("base64"),
      delay: data.frames[index] ? (data.frames[index].delay > 0 ? data.frames[index].delay : 10) : 180,
    };
  }),{plays});
}
/** Composite bounded GIF patches, including transparency and disposal 2/3. */
export function decodeGif(bytes:Uint8Array):AnimationFrames {
  if(bytes.length>2*1024*1024)throw Error("GIF exceeds 2 MiB");
  const gif=new GifReader(bytes), width=gif.width,height=gif.height,count=gif.numFrames();
  if(!width||!height||width>512||height>512||!count||count>600||width*height*count>8_000_000)throw Error("GIF dimensions/frame budget exceeded");
  const bgIndex=bytes[11],bgOffset=13+bgIndex*3;
  const background=bytes[10]&128?[bytes[bgOffset],bytes[bgOffset+1],bytes[bgOffset+2],255]:[0,0,0,0];
  const backgroundFor=(info:ReturnType<GifReader['frameInfo']>)=>info.transparent_index===null?background:[0,0,0,0];
  let canvas=Buffer.alloc(width*height*4),restore:Buffer|undefined;
  for(let offset=0;offset<canvas.length;offset+=4)canvas.set(backgroundFor(gif.frameInfo(0)),offset);
  let previous:ReturnType<GifReader['frameInfo']>|undefined;
  const frames:AnimationFrames=[];
  for(let i=0;i<count;i++){
    const info=gif.frameInfo(i);
    if(info.x<0||info.y<0||!info.width||!info.height||info.x+info.width>width||info.y+info.height>height)throw Error("GIF patch outside canvas");
    if(previous?.disposal===2){
      for(let y=previous.y;y<previous.y+previous.height;y++)for(let x=previous.x;x<previous.x+previous.width;x++)canvas.set(backgroundFor(previous),(y*width+x)*4);
    }else if(previous?.disposal===3&&restore)canvas=Buffer.from(restore);
    restore=info.disposal===3?Buffer.from(canvas):undefined;
    gif.decodeAndBlitFrameRGBA(i,canvas);
    frames.push({width,height,rgba:canvas.toString('base64'),delay:info.delay>0?info.delay*10:100});
    previous=info;
  }
  const repeats=gif.loopCount();frames.plays=repeats===null?1:repeats===0?0:repeats+1;
  return frames;
}
export class AnimationPack {
  cache = new Map<State, Promise<AnimationFrames>>();
  constructor(private cwd: string, private config: Config) {}
  async load(state: State): Promise<AnimationFrames> {
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
    return decode(file, this.config.restoreInk ?? (this.config.pack ? false : "legacy"));
  }
}
