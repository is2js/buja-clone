/** Public Mapzen Terrain Tiles / AWS. Heights are estimates, never surveyed route gradients. */
import {viewRatio} from './map.js';
export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const TERRAIN_ATTRIBUTION = 'Terrain Tiles / Mapzen · SRTM 및 GMTED2010: U.S. Geological Survey';
const TILE=256, MAX_CACHE=96;
const PK=Math.cos(36.5*Math.PI/180),SCALE=1200,MX=100.1684389,MY=-38.6136915;
const toXY=(lon,lat)=>[(lon*PK-MX)*SCALE,(-lat-MY)*SCALE];
const toLL=(x,y)=>[(x/SCALE+MX)/PK,-(y/SCALE+MY)];
const cache=new Map();
export function decodeTerrarium(r,g,b,a=255) { return a===0 || ![r,g,b,a].every(Number.isFinite) ? null : r*256+g+b/256-32768; }
function valid(lon,lat) { return Number.isFinite(lon) && Number.isFinite(lat) && lon>=-180 && lon<=180 && lat>-85.05112878 && lat<85.05112878; }
export function worldPixel(lon,lat,z=14) {
  if (!valid(lon,lat) || !Number.isInteger(z) || z<0 || z>15) return null;
  const n=2**z*TILE;
  return [(lon+180)/360*n-.5,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n-.5];
}
function canvas2d(width,height) {
  if (typeof document==='undefined') throw new Error('고도 이미지 처리를 지원하지 않습니다.');
  const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true}); if(!ctx) throw new Error('고도 이미지 처리를 지원하지 않습니다.');
  return {canvas,ctx};
}
async function loadTile(z,x,y) {
  const n=2**z; if(x<0||y<0||x>=n||y>=n) return null;
  const key=`${z}/${x}/${y}`;
  if(cache.has(key)) { const existing=cache.get(key);cache.delete(key);cache.set(key,existing);return existing; }
  const promise=(async()=>{
    try {
      const response=await fetch(TERRARIUM_URL.replace('{z}',z).replace('{x}',x).replace('{y}',y),{mode:'cors'});
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      const image=await createImageBitmap(await response.blob());
      const {canvas,ctx}=canvas2d(TILE,TILE); ctx.drawImage(image,0,0,TILE,TILE); image.close?.();
      return {canvas,rgba:ctx.getImageData(0,0,TILE,TILE).data,shade:null};
    } catch { return null; }
  })();
  cache.set(key,promise);
  while(cache.size>MAX_CACHE) cache.delete(cache.keys().next().value);
  const result=await promise;
  // Failed tiles may recover on the next explicit action.
  if(!result && cache.get(key)===promise) cache.delete(key);
  return result;
}
async function pixelAt(x,y,z) {
  const n=2**z*TILE;
  if(x<0||y<0||x>=n||y>=n) return null;
  const tx=Math.floor(x/TILE),ty=Math.floor(y/TILE), tile=await loadTile(z,tx,ty);
  if(!tile) return null;
  const px=x-tx*TILE,py=y-ty*TILE,i=(py*TILE+px)*4,d=tile.rgba;
  return decodeTerrarium(d[i],d[i+1],d[i+2],d[i+3]);
}
/** Return one height in metres per [lon, lat]; missing/failed samples remain null. */
export async function sampleElevations(coordinates,{zoom=14}={}) {
  return Promise.all((coordinates||[]).map(async point=>{
    if(!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) return null;
    const p=worldPixel(point[0],point[1],zoom); if(!p) return null;
    const [x,y]=p, x0=Math.floor(x),y0=Math.floor(y),dx=x-x0,dy=y-y0;
    const heights=await Promise.all([pixelAt(x0,y0,zoom),pixelAt(x0+1,y0,zoom),pixelAt(x0,y0+1,zoom),pixelAt(x0+1,y0+1,zoom)]);
    if(heights.some(v=>v==null)) return null;
    return heights[0]*(1-dx)*(1-dy)+heights[1]*dx*(1-dy)+heights[2]*(1-dx)*dy+heights[3]*dx*dy;
  }));
}
function shadedTile(tile,z,y) {
  if(tile.shade) return tile.shade;
  const {canvas,ctx}=canvas2d(TILE,TILE), output=ctx.createImageData(TILE,TILE),d=tile.rgba;
  const lat=Math.atan(Math.sinh(Math.PI*(1-2*(y+.5)/2**z)))*180/Math.PI;
  const metres=40075016.686*Math.cos(lat*Math.PI/180)/(2**z*TILE);
  const h=(x,y)=>{const i=(Math.max(0,Math.min(255,y))*TILE+Math.max(0,Math.min(255,x)))*4;return decodeTerrarium(d[i],d[i+1],d[i+2],d[i+3]);};
  for(let y=0;y<TILE;y++) for(let x=0;x<TILE;x++) {
    const i=(y*TILE+x)*4, l=h(x-1,y),r=h(x+1,y),t=h(x,y-1),b=h(x,y+1);
    if([l,r,t,b].some(v=>v==null)) continue;
    const dx=(r-l)/(2*metres),dy=(b-t)/(2*metres), len=Math.hypot(dx,dy,1);
    const light=(-dx*.5-dy*.5+.707)/len, dark=Math.max(0,Math.min(1,(.707-light)*1.4));
    output.data[i]=30;output.data[i+1]=49;output.data[i+2]=68;output.data[i+3]=Math.round(dark*125);
  }
  ctx.putImageData(output,0,0); tile.shade=canvas;return canvas;
}
function lonAt(x,n){return x/n*360-180;}
function latAt(y,n){return Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI;}
function tileRange(view,width) {
  const [west,north]=toLL(view.x,view.y),[east,south]=toLL(view.x+view.w,view.y+view.w*viewRatio(view));
  let z=Math.max(7,Math.min(14,Math.ceil(Math.log2(360*PK*SCALE*width/(256*view.w))-.25)));
  let range;
  do {
    const n=2**z,tx=lon=>Math.floor((lon+180)/360*n),ty=lat=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n);
    range={z,n,x0:Math.max(0,tx(west)),x1:Math.min(n-1,tx(east)),y0:Math.max(0,ty(north)),y1:Math.min(n-1,ty(south))};
    if((range.x1-range.x0+1)*(range.y1-range.y0+1)<=36||z===7) break; z--;
  }while(z>=7);
  return range;
}
/** A pointer-transparent overlay for the existing SVG view; no hidden tile prefetch. */
export function createHillshadeController({canvas,onStatus}={}) {
  let revision=0,closed=false;
  function clear(){revision++;if(canvas) canvas.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height);}
  async function render(view) {
    const token=++revision;
    if(closed||!canvas||!view||!Number.isFinite(view.w)||view.w<=0) return false;
    const rect=canvas.getBoundingClientRect(),width=rect.width,height=rect.height;
    if(width<=0||height<=0) return false;
    const density=Math.min(globalThis.devicePixelRatio||1,2);
    canvas.width=Math.round(width*density);canvas.height=Math.round(height*density);
    const ctx=canvas.getContext('2d'); if(!ctx) {onStatus?.('error');return false;}
    onStatus?.('loading');
    try {
      const range=tileRange(view,width), jobs=[];
      for(let x=range.x0;x<=range.x1;x++) for(let y=range.y0;y<=range.y1;y++) jobs.push((async()=>({x,y,tile:await loadTile(range.z,x,y)}))());
      const tiles=await Promise.all(jobs); if(closed||token!==revision) return false;
      if(!tiles.length || tiles.some(item=>!item.tile)) {ctx.clearRect(0,0,canvas.width,canvas.height);onStatus?.('error');return false;}
      ctx.clearRect(0,0,canvas.width,canvas.height);
      const verticalScale=canvas.height/(view.w*viewRatio(view));
      for(const {x,y,tile} of tiles) {
        const [left,top]=toXY(lonAt(x,range.n),latAt(y,range.n)),[right,bottom]=toXY(lonAt(x+1,range.n),latAt(y+1,range.n));
        ctx.drawImage(shadedTile(tile,range.z,y),(left-view.x)/view.w*canvas.width,(top-view.y)*verticalScale,(right-left)/view.w*canvas.width+1,(bottom-top)*verticalScale+1);
      }
      onStatus?.('ready');return true;
    } catch {if(token===revision&&!closed){ctx.clearRect(0,0,canvas.width,canvas.height);onStatus?.('error');}return false;}
  }
  return {render,clear,destroy(){clear();closed=true;}};
}
