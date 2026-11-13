// Diagnostic Kitty-protocol emulator: consumes actual PTY output, never app state.
window.createGraphicsBench = (terminal, send, enabled) => {
  const screen = document.querySelector('.xterm-screen');
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, {position:'absolute',inset:'0',pointerEvents:'none',zIndex:'5',imageRendering:'pixelated'});
  screen.style.position='relative'; screen.append(canvas);
  const context=canvas.getContext('2d');
  const images=new Map(), placements=new Map();
  let pending='', upload;
  const stats={uploads:0,placements:0,deletions:0,queries:0,frames:0,lastWidth:0,lastHeight:0,errors:[]};
  function draw() {
    // Keep the last presented image while the terminal is repainting a synchronized frame.
    // A Kitty deletion and replacement may span several PTY chunks in that frame.
    if (terminal.modes.synchronizedOutputMode) return;
    const size=screen.getBoundingClientRect();
    canvas.width=Math.round(size.width);canvas.height=Math.round(size.height);
    context.imageSmoothingEnabled=false;
    const cw=size.width/terminal.cols,ch=size.height/terminal.rows;
    for(const place of placements.values()) {
      const image=images.get(place.i);if(!image)continue;
      const scale=Math.min(place.c*cw/image.width,place.r*ch/image.height);
      const w=image.width*scale,h=image.height*scale;
      context.drawImage(image,place.x*cw+(place.c*cw-w)/2,place.y*ch+(place.r*ch-h)/2,w,h);
    }
    stats.frames++;
  }
  async function command(body) {
    const split=body.indexOf(';'),control=body.slice(0,split<0?body.length:split),data=split<0?'':body.slice(split+1);
    const keys=Object.fromEntries(control.split(',').filter(Boolean).map(pair=>pair.split('=')));
    if(keys.a==='q') {stats.queries++;if(enabled)send(`\x1b_Gi=${keys.i};OK\x1b\\`);return;}
    if(!enabled)return;
    if(keys.a==='t'||(!keys.a&&keys.m!==undefined)) {
      if(keys.a==='t')upload={keys,data:''};
      if(!upload)throw Error('Continuation without image');
      upload.data+=data;
      if(keys.m==='1')return;
      const u=upload;upload=undefined;
      let bytes=Uint8Array.from(atob(u.data),c=>c.charCodeAt(0));
      if(u.keys.o==='z')bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
      const width=Number(u.keys.s),height=Number(u.keys.v);
      if(u.keys.f!=='32'||bytes.length!==width*height*4)throw Error('Invalid RGBA transmission');
      const image=document.createElement('canvas');image.width=width;image.height=height;
      image.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes),width,height),0,0);
      images.set(u.keys.i,image);stats.uploads++;stats.lastWidth=width;stats.lastHeight=height;return;
    }
    if(keys.a==='p') {
      const buffer=terminal.buffer.active;
      placements.set(`${keys.i}:${keys.p}`,{i:keys.i,p:keys.p,x:buffer.cursorX,y:buffer.cursorY,c:Number(keys.c),r:Number(keys.r)});
      stats.lastImage=keys.i;stats.lastPlacement={x:buffer.cursorX,y:buffer.cursorY,c:Number(keys.c),r:Number(keys.r)};stats.placements++;draw();return;
    }
    if(keys.a==='d') {
      for(const[key,place]of placements)if(place.i===keys.i&&(!keys.p||place.p===keys.p))placements.delete(key);
      if(keys.d==='I')images.delete(keys.i);
      stats.deletions++;draw();
    }
  }
  const write=text=>text?new Promise(resolve=>terminal.write(text,resolve)):Promise.resolve();
  return {
    stats, canvas,
    get active(){return placements.size;},
    async consume(text) {
      pending+=text;
      while(pending) {
        const start=pending.indexOf('\x1b_G');
        if(start<0) {
          const keep=pending.endsWith('\x1b_')?2:pending.endsWith('\x1b')?1:0;
          await write(pending.slice(0,pending.length-keep));pending=pending.slice(pending.length-keep);break;
        }
        if(start>0){await write(pending.slice(0,start));pending=pending.slice(start);}
        const end=pending.indexOf('\x1b\\',3);if(end<0)break;
        const body=pending.slice(3,end);pending=pending.slice(end+2);
        try{await command(body);}catch(error){stats.errors.push(String(error));}
      }
      draw();
    },
    reset(){pending='';upload=undefined;images.clear();placements.clear();draw();},
  };
};
