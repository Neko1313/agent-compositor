// Bench-only observations of real PTY output and terminal paint events.
window.observeTerminalPerformance = terminal => {
  let active=false,started=0,lastResize=-Infinity,resizeChunks=0,lastImage,arm,pendingInput,pointerArm,pendingPointer,pendingHover;
  let samples,totals;
  const text=()=>Array.from({length:terminal.rows},(_,n)=>terminal.buffer.active.getLine(n+terminal.buffer.active.viewportY)?.translateToString(true,0,terminal.cols)??'').join('\n');
  const reset=()=>{samples={inputMs:[],pointerMs:[],hoverMs:[],queueMs:[],parseMs:[],longTasksMs:[]};totals={outputChunks:0,outputBytes:0,paintEvents:0,eraseDisplay:0,eraseScrollback:0,eraseWholeLine:0,eraseToLineEnd:0,emptyPaints:0,resizeEmptyPaints:0,imageChanges:0};arm=undefined;pendingInput=undefined;pointerArm=undefined;pendingPointer=undefined;pendingHover=undefined;};reset();
  const summary=values=>{const sorted=[...values].sort((a,b)=>a-b);return{count:sorted.length,p50:sorted[Math.floor((sorted.length-1)*.5)]??0,p95:sorted[Math.ceil((sorted.length-1)*.95)]??0,max:sorted.at(-1)??0};};
  terminal.parser.registerCsiHandler({final:'J'},params=>{if(active){if(params[0]===2)totals.eraseDisplay++;if(params[0]===3)totals.eraseScrollback++;}return false;});
  terminal.parser.registerCsiHandler({final:'K'},params=>{if(active){if((params[0]??0)===0)totals.eraseToLineEnd++;if(params[0]===2)totals.eraseWholeLine++;}return false;});
  terminal.onResize(()=>{lastResize=performance.now();resizeChunks=totals.outputChunks;});
  terminal.onData(()=>{if(active&&pointerArm){const at=performance.now();pendingPointer=pointerArm.shape?{expected:pointerArm.shape,at}:undefined;pendingHover=pointerArm.cell?{...pointerArm.cell,at}:undefined;pointerArm=undefined;}if(active&&arm){pendingInput={expected:arm,at:performance.now()};arm=undefined;}});
  terminal.onRender(()=>{
    if(!active)return;totals.paintEvents++;
    if(pendingHover){const c=terminal.buffer.active.getLine(pendingHover.row+terminal.buffer.active.viewportY)?.getCell(pendingHover.col);if(c&&!!c.isBold()===pendingHover.bold){samples.hoverMs.push(performance.now()-pendingHover.at);pendingHover=undefined;}}
    const screen=text();if(!screen.trim()){if(performance.now()-lastResize<100&&totals.outputChunks===resizeChunks)totals.resizeEmptyPaints++;else totals.emptyPaints++;}
    if(pendingInput&&screen.split('\n').slice(-20).some(line=>line.includes('› '+pendingInput.expected))){samples.inputMs.push(performance.now()-pendingInput.at);pendingInput=undefined;}
  });
  const observer=new PerformanceObserver(list=>{if(active)for(const entry of list.getEntries())if(samples.longTasksMs.length<2000)samples.longTasksMs.push(entry.duration);});
  observer.observe({entryTypes:['longtask']});
  return{
    start(){reset();started=performance.now();lastImage=window.visual.graphics?.stats.lastImage;active=true;},
    expectPointer(shape,cell){if(pointerArm||pendingPointer||pendingHover)throw Error('Previous hover observation is unfinished');pointerArm={shape,cell};},
    pointer(shape){if(active&&pendingPointer?.expected===shape){samples.pointerMs.push(performance.now()-pendingPointer.at);pendingPointer=undefined;}},
    expectInput(expected){if(arm||pendingInput)throw Error('Previous input observation is unfinished');arm=expected;},
    queued(data){if(!active)return undefined;totals.outputChunks++;totals.outputBytes+=new TextEncoder().encode(data).length;return performance.now();},
    consuming(queued){if(queued===undefined||!active)return undefined;if(samples.queueMs.length<10000)samples.queueMs.push(performance.now()-queued);return performance.now();},
    consumed(at){const image=window.visual.graphics?.stats.lastImage;if(active&&image!==lastImage){totals.imageChanges++;lastImage=image;}if(at!==undefined&&active&&samples.parseMs.length<10000)samples.parseMs.push(performance.now()-at);},
    report(){return{...totals,durationMs:performance.now()-started,inputToPaintMs:summary(samples.inputMs),pointerRoundTripMs:summary(samples.pointerMs),hoverToPaintMs:summary(samples.hoverMs),outputQueueMs:summary(samples.queueMs),terminalConsumeMs:summary(samples.parseMs),browserLongTasksMs:summary(samples.longTasksMs),pendingInput:!!(arm||pendingInput),pendingPointer:!!(pointerArm||pendingPointer||pendingHover)};},
    stop(){const report=this.report();active=false;return report;},
    snapshot(){return Array.from({length:terminal.rows},(_,y)=>Array.from({length:terminal.cols},(_,x)=>{const c=terminal.buffer.active.getLine(y+terminal.buffer.active.viewportY)?.getCell(x);return c?[c.getChars()||' ',c.getWidth(),c.getFgColorMode(),c.getFgColor(),c.getBgColorMode(),c.getBgColor(),c.isBold(),c.isDim(),c.isItalic(),c.isUnderline(),c.isInverse()]:null;}));},
  };
};
