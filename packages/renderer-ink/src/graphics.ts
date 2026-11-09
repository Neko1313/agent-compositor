import { createHash, randomInt } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { RenderMessage } from '@agent-compositor/protocol';
import type { RendererState } from './state.js';

export type Raster = NonNullable<RenderMessage['raster']>;
export type GraphicsMode = 'auto' | 'kitty' | 'off';
const escape = (control: string, data = '') => `\x1b_G${control};${data}\x1b\\`;

/** Terminal-owned pixel rendering. No plugin-supplied escape strings are executed. */
export class TerminalGraphics {
  enabled = false;
  suspended = false;
  readonly queryId = randomInt(1_000_000, 2_000_000);
  private nextId = randomInt(2_000_001, 4_000_000);
  private readonly images = new Map<string, number>();
  private readonly placements = new Map<string, { image: number; placement: number }>();
  private finishProbe?: (supported: boolean) => void;
  constructor(private write: (text: string) => unknown) {}

  async detect(mode: GraphicsMode, tty: boolean, multiplexed = false): Promise<boolean> {
    if (!tty || mode === 'off' || (multiplexed && mode === 'auto')) return false;
    if (mode === 'kitty') return this.enabled = true;
    return new Promise(resolve => {
      const timer = setTimeout(() => this.finishProbe?.(false), 350);
      this.finishProbe = supported => {
        clearTimeout(timer); this.finishProbe = undefined;
        this.enabled = supported; resolve(supported);
      };
      this.write(escape(`a=q,i=${this.queryId},s=1,v=1,f=24,t=d`, 'AAAA'));
    });
  }

  response(control: string, payload: string): void {
    if (control.split(',').includes(`i=${this.queryId}`)) this.finishProbe?.(payload === 'OK');
  }

  paint(state: RendererState): void {
    if (!this.enabled || this.suspended) return;
    const frames = state.layout?.frames ?? [];
    const visible = new Set(frames.filter(frame => {
      const raster = state.rasters.get(frame.surface);
      return raster && frame.width >= 5 && frame.height >= 4 &&
        frame.width - 4 - raster.column > 0 && frame.height - 3 - raster.row > 0;
    }).map(frame => frame.surface));
    for (const [surface, previous] of this.placements) {
      if (!visible.has(surface) || !state.rasters.has(surface)) {
        this.write(escape(`a=d,d=i,i=${previous.image},p=${previous.placement},q=2`));
        this.placements.delete(surface);
      }
    }
    let output = '';
    for (const frame of frames) {
      const raster = state.rasters.get(frame.surface);
      if (!raster || frame.width < 5 || frame.height < 4) continue;
      const columns = Math.min(raster.columns, frame.width - 4 - raster.column);
      const rows = Math.min(raster.rows, frame.height - 3 - raster.row);
      if (columns < 1 || rows < 1) continue;
      const key = createHash('sha256').update(`${raster.width}:${raster.height}:`).update(raster.rgba).digest('hex');
      let image = this.images.get(key);
      if (!image) {
        image = this.nextId++;
        const bytes = Buffer.from(raster.rgba, 'base64');
        if (bytes.length !== raster.width * raster.height * 4) continue;
        const payload = deflateSync(bytes).toString('base64');
        for (let offset = 0; offset < payload.length; offset += 4096) {
          const chunk = payload.slice(offset, offset + 4096), more = offset + 4096 < payload.length ? 1 : 0;
          output += escape(offset === 0 ? `a=t,f=32,s=${raster.width},v=${raster.height},i=${image},o=z,q=2,m=${more}` : `m=${more},q=2`, chunk);
        }
        this.images.set(key, image);
      }
      const old = this.placements.get(frame.surface);
      const placement = old?.placement ?? this.nextId++;
      if (old && old.image !== image) output += escape(`a=d,d=i,i=${old.image},p=${placement},q=2`);
      // Ink restores its own cursor below the UI. Never leave it at the image.
      output += `\x1b7\x1b[${frame.y + 3 + raster.row};${frame.x + 3 + raster.column}H`;
      output += escape(`a=p,i=${image},p=${placement},c=${columns},r=${rows},C=1,z=1,q=2`);
      output += '\x1b8';
      this.placements.set(frame.surface, { image, placement });
    }
    const active = new Set([...this.placements.values()].map(p => p.image));
    for (const [key, image] of this.images) {
      if (this.images.size <= 64) break;
      if (!active.has(image)) { output += escape(`a=d,d=I,i=${image},q=2`); this.images.delete(key); }
    }
    if (output) this.write(output);
  }

  clear(): void {
    for (const image of this.images.values()) this.write(escape(`a=d,d=I,i=${image},q=2`));
    this.images.clear(); this.placements.clear();
  }

  dispose(): void { this.finishProbe?.(false); this.clear(); this.suspended = true; }
}
