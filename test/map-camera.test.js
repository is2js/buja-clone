import test from 'node:test';
import assert from 'node:assert/strict';
import {svgViewToCamera,cameraToSvgView} from '../src/scene3d.js';

test('portrait and expanded landscape viewports preserve geographic camera and scale',()=>{
  const center=[127.127,37.4065],zoom=15;
  for (const [width,height] of [[390,507],[1280,600],[800,380]]) {
    const view=cameraToSvgView(center,zoom,width,height);
    const camera=svgViewToCamera(view,width,height);
    assert.equal(view.ratio,height/width);
    assert.equal(view.pixelWidth,width);
    assert.ok(Math.abs(camera.center[0]-center[0])<1e-10);
    assert.ok(Math.abs(camera.center[1]-center[1])<1e-10);
    assert.ok(Math.abs(camera.zoom-zoom)<1e-10);
  }
});

test('explicit view aspect keeps legacy callers centered without a height argument',()=>{
  const view={x:1400,y:900,w:50,ratio:.6};
  const camera=svgViewToCamera(view,1000);
  const restored=cameraToSvgView(camera.center,camera.zoom,1000,600);
  for (const key of ['x','y','w']) assert.ok(Math.abs(restored[key]-view[key])<1e-8);
});
