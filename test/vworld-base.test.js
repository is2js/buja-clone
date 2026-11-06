import test from 'node:test';
import assert from 'node:assert/strict';
import {tileMarkup,createMapController,mapProjection} from '../src/map.js';
const [cx,cy]=mapProjection.toXY(127.127,37.4065);
const view={x:cx-3,y:cy-3*mapProjection.ratio,w:6};

test('VWorld tiles use only same-origin proxy URLs and retain OSM fallback',()=>{
 const html=tileMarkup(view,'vworld');
 assert.match(html,/href="\/api\/vworld\/tiles\/\d+\/\d+\/\d+\.png"/);
 assert.match(html,/data-vworld-fallback="https:\/\/tile\.openstreetmap\.org\//);
 assert.doesNotMatch(html,/vworld\.kr|VWORLD_API_KEY/);
});
test('failed VWorld SVG tile switches once to its corresponding OSM tile',()=>{
 const controller=createMapController(); let href;
 const image={dataset:{vworldFallback:'https://tile.openstreetmap.org/15/1/2.png'},setAttribute:(name,value)=>{if(name==='href')href=value;}};
 controller.onMapImageError({target:image});
 assert.equal(href,'https://tile.openstreetmap.org/15/1/2.png');
 assert.match(controller.mapBaseError,/대체/);
 assert.equal(image.dataset.vworldFallback,undefined);
});
test('default map remains OSM and makes no VWorld tile requests',()=>{
 const html=tileMarkup(view);
 assert.match(html,/href="https:\/\/tile\.openstreetmap\.org\//);
 assert.doesNotMatch(html,/api\/vworld/);
});
