import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapController,fitMapBounds,resizeMapView,zoomMapView,viewRatio,mapProjection,apartmentsMarkup} from '../src/map.js';
import {createWalkController} from '../src/walk-ui.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} differs from ${b}`);
const world=(view,x,y)=>[view.x+x*view.w,view.y+y*view.w*viewRatio(view)];
const initial={x:100,y:200,w:440,ratio:.5,pixelWidth:440};
const target={getBoundingClientRect:()=>({left:0,top:0,width:440,height:220}),setPointerCapture(){},hasPointerCapture:()=>false};
const pointer=(pointerId,clientX,clientY)=>({pointerId,clientX,clientY,button:0,currentTarget:target,preventDefault(){}});
function controller() {const c=createMapController();c.mapView={...initial};c.renderMap=()=>{};return c;}

test('wide and tall viewport fits enclose the complete geographic bounds',()=>{
  for(const dimensions of [{width:1200,height:400},{width:360,height:700}]) {
    const v=fitMapBounds([10,20,200,300],0,dimensions);
    assert.ok(v.x<=10 && v.y<=20);
    assert.ok(v.x+v.w>=210 && v.y+v.w*v.ratio>=320);
    close(v.ratio,dimensions.height/dimensions.width);
    assert.equal(v.pixelWidth,dimensions.width);
  }
});

test('expanding and restoring preserves geographic centre and zoom per screen pixel',()=>{
  const expanded=resizeMapView(initial,{width:1200,height:700});
  assert.deepEqual(world(expanded,.5,.5),world(initial,.5,.5));
  close(expanded.w/expanded.pixelWidth,initial.w/initial.pixelWidth);
  const restored=resizeMapView(expanded,{width:440,height:220});
  for(const key of ['x','y','w','ratio','pixelWidth']) close(restored[key],initial[key]);
});

test('cursor-anchored zoom preserves the point under the cursor including zoom limits',()=>{
  const anchor={x:.2,y:.8}, before=world(initial,anchor.x,anchor.y);
  for(const factor of [.5,2,1e-9,1e9]) {
    const next=zoomMapView(initial,factor,anchor), after=world(next,anchor.x,anchor.y);
    close(before[0],after[0]);close(before[1],after[1]);
    assert.ok(next.w>=1.5 && next.w<=7500);
  }
});

test('wheel zoom uses the mouse position and a normal tap retains its SVG target',()=>{
  const c=controller(),before=world(c.mapView,.25,.75);
  c.onMapWheel({...pointer(1,110,165),deltaY:-1});
  const after=world(c.mapView,.25,.75);close(after[0],before[0]);close(after[1],before[1]);
  let captures=0;
  const tapTarget={...target,setPointerCapture(){captures++;}};
  c.onMapPointerDown({...pointer(1,100,100),currentTarget:tapTarget});
  c.onMapPointerUp({...pointer(1,100,100),currentTarget:tapTarget});
  assert.equal(captures,0);assert.equal(c.mapDidDrag,false);
});

test('two fingers zoom and pan about their midpoint without jumping when one lifts',()=>{
  const c=controller();
  c.onMapPointerDown(pointer(1,100,100));c.onMapPointerDown(pointer(2,200,100));
  const underStart=world(initial,150/440,100/220);
  c.onMapPointerMove(pointer(2,300,100));
  close(c.mapView.w,220);
  const underMoved=world(c.mapView,200/440,100/220);
  close(underStart[0],underMoved[0]);close(underStart[1],underMoved[1]);
  const afterPinch={...c.mapView};
  c.onMapPointerUp(pointer(2,300,100));c.onMapPointerMove(pointer(1,100,100));
  assert.deepEqual(c.mapView,afterPinch);
  c.onMapPointerMove(pointer(1,120,100));close(c.mapView.x,afterPinch.x-10);
  c.onMapPointerUp(pointer(1,120,100));
  assert.equal(c.mapDrag,null);assert.equal(c.mapDidDrag,true);
  c.onMapClick({target:{closest(){throw new Error('drag must not select a region');}}});
  assert.equal(c.mapDidDrag,false);
});

test('pointer cancellation clears stale gestures and suppresses a synthetic click',()=>{
  const c=controller();c.onMapPointerDown(pointer(1,100,100));
  c.onMapPointerCancel(pointer(1,100,100));
  assert.deepEqual(c.mapPointers,{});assert.equal(c.mapDrag,null);assert.equal(c.mapDidDrag,true);
  c.onMapPointerDown(pointer(2,10,10));assert.equal(c.mapDidDrag,false);
});

test('apartment culling and walking picking use the same dynamic viewport height',()=>{
  const view={...initial,w:10,x:100,y:200,ratio:.5,pixelWidth:440};
  const point=mapProjection.toLL(105,207);
  const result=apartmentsMarkup([{id:'outside',area:'11',name:'밖',coordinate:point,locationVerified:true}],'11',view);
  assert.equal(result.markup,'');
  const walk=createWalkController();walk.walkActive=true;walk.walkPicking='start';walk.mapView=view;
  let selected;walk.setWalkPoint=p=>{selected=p;};
  walk.onWalkMapClick({...pointer(1,220,110),preventDefault(){},stopImmediatePropagation(){}});
  const [x,y]=mapProjection.toXY(...selected);close(x,105);close(y,202.5);
  assert.equal(walk.walkViewBox(),'100 200 10 5');
});
