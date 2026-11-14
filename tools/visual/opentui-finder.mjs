/** Known-label Finder actions use only real terminal cells and keyboard input. */
export function createOpenTuiFinder({page,key,wait,absent}){
  const marker='windows · ↑↓ select · Enter open';
  async function state(value,count,selected=false){
    const handle=await page.waitForFunction(({value,count,selected})=>{
      const terminal=visual.terminal,buffer=terminal.buffer.active;
      if(terminal.modes?.synchronizedOutputMode===true)return;
      const cells=row=>Array.from({length:terminal.cols},(_,col)=>buffer.getLine(buffer.viewportY+row)?.getCell(col)?.getChars()??'');
      for(let row=0;row<terminal.rows-2;row++){
        const header=cells(row);if(!header.join('').includes('─ Windows '))continue;
        const left=header.lastIndexOf('┌'),right=header.indexOf('┐',left);if(left<0||right<0)continue;
        const content=y=>cells(y).slice(left+1,right).join('').trim();
        if(content(row+1)!==value)return;
        if(count!==undefined&&content(row+2)!==count+' windows · ↑↓ select · Enter open')return;
        const choices=[];
        for(let y=row+3;y<terminal.rows;y++){
          const line=cells(y);if(line[left]==='└')break;
          const text=content(y),name=text.replace(/\s{2,}(?:WS [1-9]|Closed|Available|Unavailable)$/,'');
          if(name!==value)continue;
          const col=line.findIndex((ch,x)=>x>left&&x<right&&ch!==''&&ch!==' '),cell=buffer.getLine(buffer.viewportY+y)?.getCell(col);
          choices.push({row:y,selected:cell?.getBgColor()===0xa6dfd4&&cell?.getFgColor()===0x171a20&&Boolean(cell?.isBold())});
        }
        if(count!==undefined&&choices.length!==count||selected&&!choices.some(choice=>choice.selected))return;
        return{choices,selected:choices.some(choice=>choice.selected)};
      }
    },{value,count,selected});
    return handle.jsonValue();
  }
  // Query-only checks deliberately allow partial or negative queries and leave
  // selection/opening to their caller, including real Closed-row mouse checks.
  async function query(value,count){await page.keyboard.type(value);return state(value,count);}
  async function pick(value,count=1){
    if(!Number.isSafeInteger(count)||count<1)throw Error('A known Finder label needs a positive expected result count');
    await key('F2');await wait(marker);const choice=await query(value,count);
    // A request can publish after query editing. Its late row intentionally has
    // no selection; select that visible current result before one explicit Enter.
    if(!choice.selected)await key('ArrowDown');
    await state(value,count,true);await key('Enter');await absent(marker);
  }
  return{marker,state,query,pick};
}
