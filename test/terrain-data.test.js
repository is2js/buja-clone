import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeTerrarium,worldPixel,sampleElevations,createHillshadeController} from '../src/terrain-data.js';

test('Terrarium RGB decodes signed and fractional metres; transparent data is missing',()=>{
 assert.equal(decodeTerrarium(128,0,0),0);
 assert.equal(decodeTerrarium(127,255,128),-.5);
 assert.equal(decodeTerrarium(128,31,64),31.25);
 assert.equal(decodeTerrarium(128,0,0,0),null);
});
test('Mercator pixel conversion rejects invalid coordinates and latitude',()=>{
 assert.deepEqual(worldPixel(0,0,0),[127.5,127.5]);
 assert.equal(worldPixel(127,90,14),null);
 assert.equal(worldPixel(NaN,37,14),null);
 assert.equal(worldPixel(127,37,16),null);
});
test('missing, invalid or inaccessible terrain returns null rather than invented height',async()=>{
 const before=globalThis.fetch;
 globalThis.fetch=async()=>({ok:false});
 try {assert.deepEqual(await sampleElevations([[127,37],[127,99],null,[null,37]]),[null,null,null,null]);}
 finally {globalThis.fetch=before;}
});
test('empty view does not report a fake hillshade',async()=>{
 const shade=createHillshadeController({canvas:null});
 assert.equal(await shade.render({x:1,y:1,w:1}),false);
 shade.destroy();
});
