import {expect,it,vi} from 'vitest';
import {verifiedPreviousArchive} from './ci-review-upgrade.js';
import {digest} from './certification.js';
const bytes=Buffer.from('pinned previous release bytes'),previous={version:'0.1.0',url:'https://releases.example/previous.tar.gz',sha256:digest(bytes)};
it('follows a secure release redirect and returns only checksum-verified bytes',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(null,{status:302,headers:{location:'https://assets.example/previous.tar.gz'}})).mockResolvedValueOnce(new Response(bytes));
 expect(await verifiedPreviousArchive(previous,fetcher)).toEqual(bytes);expect(fetcher.mock.calls.map(call=>call[0])).toEqual([previous.url,'https://assets.example/previous.tar.gz']);
});
it('rejects modified previous bytes before they reach installation',async()=>{
 await expect(verifiedPreviousArchive(previous,vi.fn(async()=>new Response('altered')))).rejects.toThrow(/checksum mismatch/i);
});
it.each(['http://releases.example/previous.tar.gz','https://user:PRIVATE_FIXTURE@releases.example/previous.tar.gz'])('rejects unsafe source %s before transport',async url=>{
 const fetcher=vi.fn();await expect(verifiedPreviousArchive({...previous,url},fetcher)).rejects.toThrow('credential-free HTTPS');expect(fetcher).not.toHaveBeenCalled();
});
it('rejects an insecure redirect without requesting its target',async()=>{
 const fetcher=vi.fn(async()=>new Response(null,{status:302,headers:{location:'http://assets.example/previous.tar.gz'}}));
 await expect(verifiedPreviousArchive(previous,fetcher)).rejects.toThrow('credential-free HTTPS');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('cancels an advertised oversized body before reading it',async()=>{
 let cancelled=false;const body=new ReadableStream({cancel(){cancelled=true;}});
 await expect(verifiedPreviousArchive(previous,vi.fn(async()=>new Response(body,{headers:{'content-length':String(128*1024*1024+1)}})))).rejects.toThrow('download limit');expect(cancelled).toBe(true);
});
it('cancels an unsuccessful HTTP body instead of leaving its connection open',async()=>{
 let cancelled=false;const body=new ReadableStream({cancel(){cancelled=true;}});
 await expect(verifiedPreviousArchive(previous,vi.fn(async()=>new Response(body,{status:503})))).rejects.toThrow('HTTP 503');expect(cancelled).toBe(true);
});
it('does not expose transport exception details in certification logs',async()=>{
 await expect(verifiedPreviousArchive(previous,vi.fn(async()=>{throw Error('PRIVATE_PROXY_FIXTURE');}))).rejects.toThrow(/^Previous release transport failed$/);
});
