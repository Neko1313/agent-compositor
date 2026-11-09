import { PassThrough } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { InputData } from "./keys.js";

/** Strip SGR mouse reports before Ink's keyboard parser, including split reports. */
export class MouseDecoder {
  constructor(private onResponse?: (control: string, payload: string) => void) {}
  private pending = "";
  push(text: string): { text: string; events: InputData[] } {
    this.pending += text;
    let output = "";
    const events: InputData[] = [];
    while (this.pending) {
      const index = this.pending.indexOf("\x1b");
      if (index < 0) { output += this.pending; this.pending = ""; break; }
      output += this.pending.slice(0, index); this.pending = this.pending.slice(index);
      if(this.pending.startsWith('\x1b]11;')){
        const match=/^\x1b\]11;([^\x07\x1b]*)(?:\x07|\x1b\\)/.exec(this.pending);
        if(match){this.onResponse?.('background',match[1]);this.pending=this.pending.slice(match[0].length);continue;}
        if(this.pending.length<4096)break;
      }
      const da=/^\x1b\[\?([0-9;]+)c/.exec(this.pending);
      if(da){this.onResponse?.('da1',da[1]);this.pending=this.pending.slice(da[0].length);continue;}
      const cell=/^\x1b\[6;([0-9]+);([0-9]+)t/.exec(this.pending);
      if(cell){this.onResponse?.('cell',`${cell[1]};${cell[2]}`);this.pending=this.pending.slice(cell[0].length);continue;}
      const area=/^\x1b\[([48]);([0-9]+);([0-9]+)t/.exec(this.pending);
      if(area){this.onResponse?.(area[1]==='4'?'areaPixels':'areaCells',`${area[2]};${area[3]}`);this.pending=this.pending.slice(area[0].length);continue;}
      if(/^\x1b\[\?[0-9;]*$/.test(this.pending)||/^\x1b\[[468];[0-9;]*$/.test(this.pending)||'\x1b]11;'.startsWith(this.pending))break;
      if (this.pending.startsWith('\x1b_G')) {
        const end = this.pending.indexOf('\x1b\\', 3);
        if (end < 0 && this.pending.length < 4096) break;
        if (end >= 0) {
          const body = this.pending.slice(3, end), separator = body.indexOf(';');
          if (separator >= 0) this.onResponse?.(body.slice(0, separator), body.slice(separator + 1));
          this.pending = this.pending.slice(end + 2); continue;
        }
      }
      if (["\x1b_", "\x1b", "\x1b[", "\x1b[<"].includes(this.pending)) break;
      if (this.pending.startsWith("\x1b[<")) {
        const match = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(this.pending);
        if (match) {
          const code = Number(match[1]), col = Number(match[2]) - 1, row = Number(match[3]) - 1;
          if (row >= 0 && col >= 0) {
            const button = code & 64 ? (code & 1 ? "wheel-down" : "wheel-up") : (code & 3) === 0 ? "left" : "other";
            events.push({ kind: "mouse", row, col, button, action: match[4] === "m" ? "release" : code & 32 ? "move" : "press" });
          }
          this.pending = this.pending.slice(match[0].length); continue;
        }
        if (/^\x1b\[<[\d;]*$/.test(this.pending) && this.pending.length < 64) break;
      }
      output += this.pending[0]; this.pending = this.pending.slice(1);
    }
    return { text: output, events };
  }
  flush(): string {
    const pending = this.pending; this.pending = "";
    return pending.startsWith("\x1b[<") || pending.startsWith("\x1b_") || pending.startsWith("\x1b]11;") || /^\x1b\[\?[0-9;]*$/.test(pending) || /^\x1b\[[468];[0-9;]*$/.test(pending) ? "" : pending;
  }
}

export function mouseInput(source: NodeJS.ReadableStream, onMouse: (data: InputData) => void, onResponse?: (control: string, payload: string) => void) {
  const terminal = source as NodeJS.ReadStream;
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: (enabled: boolean) => void; ref: () => void; unref: () => void };
  input.isTTY = terminal.isTTY;
  input.setRawMode = enabled => { terminal.setRawMode(enabled); };
  input.ref = () => { terminal.ref?.(); };
  input.unref = () => { terminal.unref?.(); };
  const decoder = new MouseDecoder(onResponse), utf8 = new StringDecoder("utf8");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const data = (chunk: Buffer | string) => {
    clearTimeout(timer);
    const decoded = decoder.push(typeof chunk === "string" ? chunk : utf8.write(chunk));
    // Deliver preceding keyboard input before mouse coordinates from the same chunk.
    if (decoded.text) input.write(decoded.text);
    for (const event of decoded.events) onMouse(event);
    timer = setTimeout(() => { const text = decoder.flush(); if (text) input.write(text); }, 40);
  };
  const end = () => { clearTimeout(timer); input.end(decoder.flush()); };
  source.on("data", data); source.on("end", end);
  return { input,
    pause: () => { clearTimeout(timer); source.off('data', data); (source as NodeJS.ReadStream).pause?.(); },
    resume: () => { source.on('data', data); (source as NodeJS.ReadStream).resume?.(); },
    dispose: () => { clearTimeout(timer); source.off("data", data); source.off("end", end); input.destroy(); } };
}
