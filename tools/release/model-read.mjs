import assert from 'node:assert/strict';

/** Decode the current model-facing read frame without changing its verbatim body. */
export function readModelResult(text) {
  const prefix='Read metadata (JSON):\n',marker='\n\nFile content (verbatim):\n';
  assert.equal(typeof text,'string','Read result must be text');
  assert.ok(text.startsWith(prefix),'Read result must carry its metadata header');
  const index=text.indexOf(marker,prefix.length);
  assert.ok(index>=prefix.length,'Read result must separate metadata from verbatim content');
  const metadata=JSON.parse(text.slice(prefix.length,index));
  assert.ok(metadata&&typeof metadata==='object'&&!Array.isArray(metadata),'Read metadata must be an object');
  assert.ok(!Object.hasOwn(metadata,'content'),'Verbatim file content must stay outside metadata');
  return {...metadata,content:text.slice(index+marker.length)};
}
