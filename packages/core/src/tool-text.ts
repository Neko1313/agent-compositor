/** The same bounded presentation is used live and when replaying explicit text. */
export function modelToolText(value:unknown,modelText?:string):string {
  const text=modelText??JSON.stringify(value)??'null';
  if(Buffer.byteLength(text,'utf8')<=128*1024)return text;
  return JSON.stringify({truncated:true,originalBytes:Buffer.byteLength(text,'utf8'),preview:text.slice(0,16000),hint:'Tool result exceeded 128 KiB. Query a smaller page/range; this preview is not a complete edit source.'});
}
