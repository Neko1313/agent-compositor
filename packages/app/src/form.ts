import type { UiForm, UiFormResult } from '@agent-compositor/events';
import type { WireMessage } from '@agent-compositor/protocol';
import { textRows, type Row } from './presentation.js';
import { previousGraphemeBoundary, nextGraphemeBoundary, floorGraphemeBoundary, truncateGraphemes } from './text-edit.js';
type Input=Extract<WireMessage,{type:'input'}>['data'];
/** Private drafts never enter prompt history, ui.render hooks, or catalog events. */
export class FormDialog {
  values:Record<string,string|boolean>={}; focus=0; cursor=0; scroll=0; error=''; selectAll=false;
  private hits: Array<{row:number;end:number;index:number}>=[];
  constructor(readonly request:UiForm) {
    for(const field of request.fields) {
      const value=field.type==='toggle'?field.value===true:field.type==='password'?'':String(field.value??field.options?.[0]?.value??'');
      this.values[field.id]=field.type==='text'||field.type==='url'?truncateGraphemes(String(value),4096):value;
    }
    this.move(0);
  }
  private move(index:number) {this.focus=(index+this.request.fields.length+this.request.actions.length)%(this.request.fields.length+this.request.actions.length);const f=this.request.fields[this.focus];this.cursor=f?String(this.values[f.id]).length:0;this.selectAll=false;}
  private validate() {
    for(const [i,f] of this.request.fields.entries()) {
      const value=this.values[f.id];
      if(f.required&&!String(value).trim()){this.move(i);this.error=`${f.label} is required`;return false;}
      if(f.type==='url'&&value){try{const url=new URL(String(value));if(!['http:','https:'].includes(url.protocol))throw Error();}catch{this.move(i);this.error=`${f.label}: enter an HTTP(S) URL`;return false;}}
      if(f.type==='select'&&!f.options?.some(o=>o.value===value)){this.move(i);this.error=`Choose ${f.label}`;return false;}
    }
    return true;
  }
  visible(columns:number,height:number):Row[] {
    const rows:Row[]=[];const markers:number[]=[];
    if(this.request.description) rows.push(...textRows(this.request.description,columns,'muted'),{text:''});
    for(const [index,f] of this.request.fields.entries()) {
      markers[index]=rows.length;
      rows.push(...textRows(f.label+(f.required?' (required)':''),columns,this.focus===index?'accent':'text').map(row=>({...row,bold:true})));
      const value=String(this.values[f.id]);const active=this.focus===index;
      let content=f.type==='password'?'•'.repeat(value.length):value;
      if(f.type==='toggle')content=this.values[f.id]?'[x] Enabled':'[ ] Disabled';
      if(f.type==='select')content=`‹ ${f.options?.find(o=>o.value===value)?.label??value} ›`;
      if(['text','password','url'].includes(f.type)) {
        const offset=active?Math.max(0,this.cursor-columns+6):0;
        // Segment the displayed value so password clipping never reads plaintext.
        const start=floorGraphemeBoundary(content,offset);
        content=truncateGraphemes(content.slice(start),Math.max(1,columns-4));
        if(active) {const c=this.cursor-start;content=content.slice(0,c)+'▏'+content.slice(c);}
      }
      rows.push({text:`${active?'›':' '} ${content||'…'}`,selected:active});
      if(f.hint) rows.push(...textRows(f.hint,columns,'muted'));
      rows.push({text:''});
    }
    for(const [i,action] of this.request.actions.entries()){markers[this.request.fields.length+i]=rows.length;rows.push({text:`${this.focus===this.request.fields.length+i?'›':' '} [ ${action.label} ]`,tone:'accent',selected:this.focus===this.request.fields.length+i});}
    const field=this.request.fields[this.focus];
    const kind=field?.type;
    const hint=kind==='toggle'?'Space toggle':kind==='select'?'←→ choose':field?'←→ edit': 'Enter activate';
    const count=this.request.fields.length+this.request.actions.length;
    const compact=`${this.focus+1}/${count} · ${hint} · Tab next`;
    const help=columns<60?compact:`${this.focus+1}/${count} · ${hint} · Tab / Shift+Tab focus · Esc cancel`;
    const feedback:Row[]=this.error
      ?textRows(this.error,columns,'danger').slice(0,Math.max(1,height-2))
      :[{text:Array.from(help).slice(0,columns).join(''),tone:'muted'}];
    const available=Math.max(1,height-feedback.length);
    const position=markers[this.focus];
    const end=field?Math.min(rows.length,position+textRows(field.label+(field.required?' (required)':''),columns).length+1):position+1;
    if(position<this.scroll)this.scroll=position;
    if(end>=this.scroll+available)this.scroll=Math.max(0,Math.min(position,end-available));
    this.scroll=Math.min(this.scroll,Math.max(0,rows.length-available));
    this.hits=markers.map((row,index)=>({row:row-this.scroll,end:Math.min(available-1,(markers[index+1]??rows.length)-this.scroll-1),index})).filter(hit=>hit.end>=0&&hit.row<available);
    return [...rows.slice(this.scroll,this.scroll+available),...feedback].slice(0,height);
  }

  handle(input:Input):UiFormResult|'cancel'|undefined {
    if(input.kind==='mouse') {
      if(input.button==='wheel-up'||input.button==='wheel-down'){this.move(this.focus+(input.button==='wheel-up'?-1:1));return;}
      if(input.button!=='left'||input.action==='move'||input.action==='release')return;
      const hit=[...this.hits].reverse().find(h=>input.row>=Math.max(0,h.row)&&input.row<=h.end);
      if(!hit)return;this.move(hit.index);
      const field=this.request.fields[this.focus];
      if(field&& !['toggle','select'].includes(field.type))return;
      return this.handle({kind:'key',key:'enter'});
    }
    if(input.kind==='key') {
      if(input.key==='escape'||(input.key==='c'&&input.modifiers?.includes('ctrl')))return 'cancel';
      if(input.key==='tab'||input.key==='up'||input.key==='down') {this.move(this.focus+(input.key==='up'||input.modifiers?.includes('shift')?-1:1));return;}
      if(input.key==='enter'&&this.focus>=this.request.fields.length) {
        const action=this.request.actions[this.focus-this.request.fields.length].id;
        if(action==='cancel')return 'cancel';
        if(this.validate())return {action,values:{...this.values}};
        return;
      }
    }
    // Ink can coalesce consecutive control-only keystrokes in one input chunk.
    if(input.kind==='text'&&/^[\t\r]+$/.test(input.text)){for(const c of input.text){const result=this.handle({kind:'key',key:c==='\t'?'tab':'enter'});if(result)return result;}return;}
    const field=this.request.fields[this.focus];if(!field)return;
    this.error='';
    if(field.type==='toggle') {if((input.kind==='key'&&['enter','left','right','space'].includes(input.key))||(input.kind==='text'&&input.text===' '))this.values[field.id]=!this.values[field.id];return;}
    if(field.type==='select') {
      if(input.kind==='key'&&['enter','left','right','space'].includes(input.key)){const options=field.options??[],current=options.findIndex(o=>o.value===this.values[field.id]);if(options.length)this.values[field.id]=options[(current+(input.key==='left'?-1:1)+options.length)%options.length].value;}return;
    }
    let value=String(this.values[field.id]);
    if(input.kind==='text') {const text=input.text.replace(/[\x00-\x1f\x7f]/g,' ');if(this.selectAll){value='';this.cursor=0;}value=value.slice(0,this.cursor)+text+value.slice(this.cursor);this.cursor+=text.length;this.selectAll=false;}
    if(input.kind==='key') {
      if(input.modifiers?.includes('ctrl')&&input.key==='a'){this.selectAll=true;return;}
      if(input.modifiers?.includes('ctrl')&&input.key==='u'){value='';this.cursor=0;}
      if(input.key==='enter'){this.move(this.focus+1);return;}
      if(input.key==='left')this.cursor=previousGraphemeBoundary(value,this.cursor);
      if(input.key==='right')this.cursor=nextGraphemeBoundary(value,this.cursor);
      if(input.key==='home')this.cursor=0;if(input.key==='end')this.cursor=value.length;
      if(['backspace','delete'].includes(input.key)) {
        if(this.selectAll){value='';this.cursor=0;this.selectAll=false;}
        else if(input.key==='backspace'&&this.cursor) {
          const previous=previousGraphemeBoundary(value,this.cursor);
          value=value.slice(0,previous)+value.slice(this.cursor);this.cursor=previous;
        } else if(input.key==='delete')value=value.slice(0,this.cursor)+value.slice(nextGraphemeBoundary(value,this.cursor));
      }
    }
    value=truncateGraphemes(value,4096);
    // Insertions and deletions can also join neighboring graphemes.
    this.cursor=floorGraphemeBoundary(value,Math.min(this.cursor,value.length));
    this.values[field.id]=value;
  }
  clear(){this.values={};}
}
