import {markdownRows} from "./markdown.js";
import type { UiAppearance, UiTextView } from "@agent-compositor/events";
import type { RenderMessage } from "@agent-compositor/protocol";

export const DEFAULT_APPEARANCE = {
  colors: {
    text: "#dce3e9",
    muted: "#9aa9b6",
    accent: "#8fc7dd",
    success: "#a8cca0",
    warning: "#e5c18c",
    danger: "#ef9c9c",
    border: "#46525c",
    titleBackground: "#202b34",
    selectionBackground: "#314652",
    selectionText: "#f3f7fa",
  },
  chrome: {
    borderStyle: "single" as "single" | "round" | "double",
    controls: "focus" as "always" | "focus",
  },
  presentation: {
    userLabel: "You",
    agentLabel: "Agent",
    welcome: "What would you like to work on?",
    toolDetails: false,
    hints: true,
    showTools: false,
  },
};
export type Appearance = typeof DEFAULT_APPEARANCE;
export type Tone = NonNullable<UiTextView["lines"][number]["tone"]>;
export type Row = UiTextView["lines"][number] & { cells?: Grid[number];actions?:{start:number;end:number;action?:string;selected?:boolean;focused?:boolean;disabled?:boolean}[] };
export const rowActions=(row:Row):string[]=>[...new Set([...(row.action?[row.action]:[]),...(row.actions??[]).flatMap(range=>range.action?[range.action]:[])])];
export const actionAt=(row:Row|undefined,column:number)=>row?.actions?.find(range=>column>=range.start&&column<range.end)?.action??(row?.actions?undefined:row?.action);
export type Grid = NonNullable<RenderMessage["grid"]>;
export interface TranscriptBlock {
  kind: "user" | "assistant" | "tool" | "notice";
  text: string;
  tone?: Tone;
  tool?: string;
  callId?: string;
  args?: string;
  state?: "running" | "done" | "error";
}

/** Contributions replace per plugin; later publishers win per field. */
export function appearanceFrom(
  contributions: Iterable<UiAppearance>
): Appearance {
  const result: Appearance = structuredClone(DEFAULT_APPEARANCE);
  for (const patch of contributions) {
    Object.assign(result.colors, patch.colors);
    Object.assign(result.chrome, patch.chrome);
    Object.assign(result.presentation, patch.presentation);
  }
  return result;
}

/** Strip all controls, including OSC payload escapes, before creating cells. */
export function clean(text: string): string {
  return text
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "")
    .replace(/\t/g, "  ");
}

export function wrap(text: string, columns: number): string[] {
  const width = Math.max(1, columns);
  return clean(text)
    .split("\n")
    .flatMap((line) => {
      const result: string[] = [];
      let chars = Array.from(line);
      while (chars.length > width) {
        let cut = chars.slice(0, width + 1).lastIndexOf(" ");
        if (cut <= 0 || !chars.slice(0, cut).join("").trim()) cut = width;
        result.push(chars.slice(0, cut).join(""));
        chars = chars.slice(cut + (chars[cut] === " " ? 1 : 0));
      }
      result.push(chars.join(""));
      return result;
    });
}

export function textRows(
  text: string,
  columns: number,
  tone: Tone = "text"
): Row[] {
  return clean(text)
    .split("\n")
    .flatMap((line) => {
      const indent = /^\[[ x~]\] /.test(line) && columns > 12 ? "    " : "";
      const lines = wrap(line, columns);
      if (!indent || lines.length < 2)
        return lines.map((text) => ({ text, tone }));
      const remainder = line.slice(lines[0].length).trimStart();
      return [
        { text: lines[0], tone },
        ...wrap(remainder, columns - indent.length).map((text) => ({
          text: indent + text,
          tone,
        })),
      ];
    });
}

const markdownCache=new WeakMap<TranscriptBlock,{text:string;columns:number;theme:Appearance;rows:Row[]}>();

export function transcriptRows(
  blocks: TranscriptBlock[],
  columns: number,
  theme: Appearance
): Row[] {
  const rows: Row[] = [];
  for (const block of blocks) {
    if (rows.length) rows.push({ text: "" });
    if (block.kind === "tool") {
      const symbol =
        block.state === "done" ? "✓" : block.state === "error" ? "!" : "…";
      rows.push(
        ...textRows(
          `${symbol} ${block.tool} · ${block.text}`,
          columns,
          block.state === "error"
            ? "danger"
            : block.state === "done"
            ? "success"
            : "muted"
        )
      );
      if (theme.presentation.toolDetails && block.args)
        rows.push(...textRows(block.args, columns, "muted"));
    } else if (block.kind === "notice")
      rows.push(...textRows(block.text, columns, block.tone ?? "muted"));
    else {
      rows.push({
        text:
          block.kind === "user"
            ? theme.presentation.userLabel
            : theme.presentation.agentLabel,
        tone: block.kind === "user" ? "accent" : "muted",
        bold: true,
      });
      let cached=markdownCache.get(block);
      if(!cached||cached.text!==block.text||cached.columns!==columns||cached.theme!==theme){cached={text:block.text,columns,theme,rows:markdownRows(clean(block.text),columns,theme)};markdownCache.set(block,cached);}
      rows.push(...cached.rows);
    }
  }
  return rows;
}

/** Simple inline Markdown in the default view; plugins can replace the entire view. */
export function gridFrom(
  rows: Row[],
  theme: Appearance,
  columns: number,
  literal = false
): Grid {
  return rows.map((row) => {
    if(row.actions)return Array.from(clean(row.text)).slice(0,columns).map((ch,index)=>{
      const range=row.actions!.find(range=>index>=range.start&&index<range.end);
      return{ch,fg:range?.disabled?theme.colors.muted:range?.focused?theme.colors.selectionText:range?.selected?theme.colors.accent:theme.colors.muted,
        ...(range?.focused&&!range.disabled?{bg:theme.colors.selectionBackground}:{}),...(range?.selected&&!range.disabled?{bold:true,underline:true}:{})};
    });
    if (row.cells) return row.cells.slice(0, columns).map(cell => row.selected
      ? { ...cell, fg: theme.colors.selectionText, bg: theme.colors.selectionBackground }
      : cell);
    const cells: Grid[number] = [];
    const parts = literal ? [clean(row.text)] : clean(row.text).split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    for (const part of parts) {
      const code =
        !literal && part.startsWith("`") && part.endsWith("`") && part.length > 1;
      const strong =
        !literal && part.startsWith("**") && part.endsWith("**") && part.length > 3;
      const text = code ? part.slice(1, -1) : strong ? part.slice(2, -2) : part;
      for (const ch of Array.from(text))
        cells.push({
          ch,
          fg: row.selected ? theme.colors.selectionText : theme.colors[code ? "accent" : row.tone ?? "text"],
          ...(row.selected ? { bg: theme.colors.selectionBackground } : {}),
          ...(row.bold || strong ? { bold: true } : {}),
        });
    }
    return cells.slice(0, Math.max(1, columns));
  });
}

/** Allocate the same cell rectangle for graphics and the portable fallback. */
export function rasterForView(view: UiTextView, columns: number, height: number): RenderMessage['raster'] {
  const image = view.raster;
  const textCount = view.lines.flatMap(row => wrap(row.text, columns)).length+(view.table?tableRows(view.table,columns).length:0)+tabRows(view.tabs,columns).length;
  const available = Math.max(0, height - textCount);
  if (!image || !available || columns < 1) return;
  const scale = Math.min(columns / image.width, available * 2 / image.height, 1);
  const w = Math.max(1, Math.floor(image.width * scale));
  const h = Math.max(1, Math.floor(image.height * scale));
  return { ...image, column: Math.floor((columns - w) / 2), row: 0, columns: w, rows: Math.ceil(h / 2) };
}

/** Portable true-colour half-block raster rendering, shared by all plugins. */
export function tabRows(tabs:UiTextView['tabs'],columns:number):Row[]{
  const rows:Row[]=[];let row:Row={text:'',actions:[]};const width=Math.max(1,columns);
  for(const tab of tabs??[]){
    const label=Array.from(clean(tab.label).replace(/\s+/g,' '));
    const shown=label.length>width-2?label.slice(0,Math.max(0,width-3)).join('')+'…':label.join('');
    const text=Array.from('['+shown+']').slice(0,width).join('');
    const length=Array.from(row.text).length,size=Array.from(text).length;
    if(length&&length+1+size>width){rows.push(row);row={text:'',actions:[]};}
    const start=Array.from(row.text).length+(row.text?1:0);
    row.text+=(row.text?' ':'')+text;
    row.actions!.push({start,end:start+size,...(!tab.disabled?{action:tab.action}:{}),selected:tab.selected,disabled:tab.disabled});
  }
  if(row.text)rows.push(row);return rows;
}

export function tableRows(table:NonNullable<UiTextView['table']>,columns:number):Row[]{
  const result:Row[]=[];
  const widths=table.columns.map(column=>column.width??16);
  const stacked=columns<widths.reduce((sum,width)=>sum+width,2)+(widths.length-1)*3;
  const fit=(text:string,width:number)=>{
    const chars=Array.from(clean(text).replace(/\s+/g,' '));
    return(chars.length>width?chars.slice(0,Math.max(0,width-1)).join('').trimEnd()+'…':chars.join('')).padEnd(width,' ');
  };
  if(!table.rows.length)return textRows(table.empty??'No rows.',columns,'muted');
  if(!stacked)result.push({text:'  '+table.columns.map((column,index)=>fit(column.label,widths[index])).join('   '),bold:true,tone:'muted'});
  for(const row of table.rows){
    const marker=row.details?.length?(row.expanded?'- ':'+ '):'  ';
    if(stacked){
      result.push(...wrap(marker+row.cells[0],columns).map(text=>({text,bold:true,action:row.action,tone:row.tone})));
      for(let index=1;index<row.cells.length;index++)result.push(...wrap(`${table.columns[index].label}: ${row.cells[index]}`,columns).map(text=>({text,action:row.action,tone:row.tone})));
    }else result.push({text:marker+row.cells.map((cell,index)=>fit(cell,widths[index])).join('   '),action:row.action,tone:row.tone});
    if(row.expanded)for(const detail of row.details??[]){const indent=' '.repeat(Math.min(2,Math.max(0,columns-1)));result.push(...wrap(detail.text,Math.max(1,columns-indent.length)).map(text=>({...detail,text:indent+text})));}
  }
  return result;
}

export function viewRows(
  view: UiTextView,
  columns: number,
  height: number,
  nativeRaster = false
): Row[] {
  const text = [...tabRows(view.tabs,columns),...view.lines.flatMap((row) =>
    wrap(row.text, columns).map((text) => ({ ...row, text }))
  ),...(view.table?tableRows(view.table,columns):[])];
  const image = view.raster;
  const available = Math.max(0, height - text.length);
  if (!image || !available) return text;
  // Native graphics already carry the source pixels. Reserve their rectangle
  // without decoding/downsampling the same RGBA frame into disposable text art.
  if(nativeRaster)return [...Array.from({length:rasterForView(view,columns,height)?.rows??0},()=>({text:''})),...text];
  const rgba = Buffer.from(image.rgba, "base64");
  if (rgba.length !== image.width * image.height * 4) return text;
  const scale = Math.min(
    columns / image.width,
    (available * 2) / image.height,
    1
  );
  const w = Math.max(1, Math.floor(image.width * scale)),
    h = Math.max(1, Math.floor(image.height * scale));
  const color = (x: number, y: number): string | undefined => {
    if (y >= h) return;
    const i =
      (Math.min(image.height - 1, Math.floor(y / scale)) * image.width +
        Math.min(image.width - 1, Math.floor(x / scale))) *
      4;
    return rgba[i + 3] < 16
      ? undefined
      : "#" + rgba.subarray(i, i + 3).toString("hex");
  };
  const rows: Row[] = [];
  for (let y = 0; y < h; y += 2) {
    const cells: Grid[number] = Array.from(
      { length: Math.floor((columns - w) / 2) },
      () => ({ ch: " " })
    );
    for (let x = 0; x < w; x++) {
      const top = color(x, y),
        bottom = color(x, y + 1);
      cells.push(
        top
          ? { ch: "▀", fg: top, ...(bottom ? { bg: bottom } : {}) }
          : bottom
          ? { ch: "▄", fg: bottom }
          : { ch: " " }
      );
    }
    rows.push({ text: "", cells });
  }
  return [...rows, ...text];
}
