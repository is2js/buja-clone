import test from 'node:test';
import assert from 'node:assert/strict';
import {filterOsmBuildingOverlap,mergeBuildingSources,loadVWorldBuildings} from '../src/vworld-buildings.js';
function rect(x,y,w,h,id){return {type:'Feature',geometry:{type:'Polygon',coordinates:[[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]]},properties:{id}};}
test('only strongly coincident true polygons are suppressed; unrelated and missing WFS buildings remain',()=>{
 const a=rect(127,37,.001,.001,'same');
 const overlap=rect(127.00002,37.00002,.001,.001,'confirmed-near');
 const near=rect(127.0007,37,.001,.001,'adjacent');
 const large=rect(127,37,.003,.003,'larger');
 const osm=[a,near,large,rect(127.01,37,.001,.001,'missing-height')];
 const result=filterOsmBuildingOverlap(osm,[overlap]);
 assert.equal(result.suppressedCount,1);
 assert.deepEqual(result.features.map(x=>x.properties.id),['adjacent','larger','missing-height']);
});
test('bounding boxes alone do not suppress polygons whose center is a hole',()=>{
 const ring=[[127,37],[127.001,37],[127.001,37.001],[127,37.001],[127,37]];
 const hole=[[127.0003,37.0003],[127.0007,37.0003],[127.0007,37.0007],[127.0003,37.0007],[127.0003,37.0003]];
 const donut={type:'Feature',geometry:{type:'Polygon',coordinates:[ring,hole]},properties:{id:'hole'}};
 assert.equal(filterOsmBuildingOverlap([rect(127,37,.001,.001,'candidate')],[donut]).suppressedCount,0);
});
test('flat official footprint does not suppress an OSM building with height',()=>{
 const osm=rect(127,37,.001,.001,'osm');
 const official=rect(127,37,.001,.001,'official');
 official.properties.source='vworld'; official.properties.heightSource='unknown'; official.properties.height=null;
 assert.equal(filterOsmBuildingOverlap([osm],[official]).suppressedCount,0);
});
test('overlap prefers OSM stated height while retaining VWorld estimate, footprint and provenance',()=>{
 const osm=rect(127,37,.001,.001,'osm');Object.assign(osm.properties,{source:'OpenStreetMap',heightSource:'height',height:90});
 const official=rect(127,37,.001,.001,'official');Object.assign(official.properties,{source:'vworld',heightSource:'levels',height:45,levels:15});
 const result=mergeBuildingSources([osm],[official]);
 assert.equal(result.features.length,1);assert.equal(result.osmHeightPreferred,1);
 const p=result.features[0].properties;assert.equal(p.height,90);assert.equal(p.alternativeHeight,45);assert.equal(p.alternativeId,'official');
 assert.deepEqual(JSON.parse(p.alternativeGeometry),official.geometry);
 assert.equal(osm.properties.alternativeHeight,undefined);
});
test('official estimate wins over OSM estimate; unknown or ambiguous footprints remain separate',()=>{
 const osm=rect(127,37,.001,.001,'osm');Object.assign(osm.properties,{source:'OpenStreetMap',heightSource:'levels',height:30});
 const official=rect(127,37,.001,.001,'official');Object.assign(official.properties,{source:'vworld',heightSource:'levels',height:45});
 const flat=rect(127,37,.001,.001,'flat');Object.assign(flat.properties,{source:'vworld',heightSource:'unknown',height:null});
 const merged=mergeBuildingSources([osm],[official,flat]);assert.equal(merged.features.length,2);
 assert.equal(merged.features.find(x=>x.properties.id==='official').properties.alternativeHeight,30);
 const ambiguous=mergeBuildingSources([osm],[official,{...official,properties:{...official.properties,id:'second'}}]);
 assert.equal(ambiguous.features.length,3);assert.equal(ambiguous.matchedCount,0);
});
test('abort stops pending tile scheduling and never returns stale partial results',async()=>{
 const ctrl=new AbortController();let calls=0;
 const fetcher=async(_url,opts)=>{calls++;assert.equal(opts.signal,ctrl.signal);ctrl.abort();throw new Error('aborted');};
 const result=await loadVWorldBuildings([127.126,37.406,127.144,37.424],{fetcher,signal:ctrl.signal});
 assert.equal(result.metadata.aborted,true);assert.equal(result.features.length,0);assert.equal(calls,1);
});
