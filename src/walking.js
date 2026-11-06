// Local OSM walking-graph routing; no online route request is made.
// Positions are [longitude, latitude], distances and heights are meters.
const base = import.meta.env?.BASE_URL || '/';
const graphCache = new Map();
// Deliberately approximate: the source is a rectangular extract, not city boundaries.
export const WALKING_BOUNDS = [126.75,37.40,127.32,37.75];
export function isWalkingCoverage(point) {
  if (!finiteCoordinate(point)) return false;
  const [w,s,e,n]=WALKING_BOUNDS, margin=.001;
  return point[0]>=w-margin && point[0]<=e+margin && point[1]>=s-margin && point[1]<=n+margin;
}
const radians = v => v * Math.PI / 180;
const finiteCoordinate = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 85;
export function distanceMeters(a, b) {
  const dlat = radians(b[1] - a[1]), dlon = radians(b[0] - a[0]);
  const v = Math.sin(dlat/2) ** 2 + Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(dlon/2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(v)));
}
export async function loadWalkingGraph() {
  const url = `${base}data/walking/seoul-hanam.json`;
  if (!graphCache.has(url)) graphCache.set(url, fetch(url).then(async response => {
    if (!response.ok) throw new Error('보행망 자료를 불러오지 못했습니다.');
    const graph = await response.json();
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('보행망 자료 형식이 올바르지 않습니다.');
    return graph;
  }).catch(error => { graphCache.delete(url); throw error; }));
  return graphCache.get(url);
}
// The nearest point can be in the middle of a long mapped segment. Nearest-node
// snapping alone can reject valid locations or connect an incorrect crossing.
const edgeIndexes = new WeakMap();
const EDGE_GRID = .002;
function spatialEdges(graph) {
  if (edgeIndexes.has(graph)) return edgeIndexes.get(graph);
  const cells = new Map(), longEdges=[];
  for (let i=0; i<graph.edges.length; i++) {
    const [a,b]=graph.edges[i], p=graph.nodes[a], q=graph.nodes[b];
    if (!finiteCoordinate(p) || !finiteCoordinate(q)) continue;
    const x0=Math.floor(Math.min(p[0],q[0])/EDGE_GRID), x1=Math.floor(Math.max(p[0],q[0])/EDGE_GRID);
    const y0=Math.floor(Math.min(p[1],q[1])/EDGE_GRID), y1=Math.floor(Math.max(p[1],q[1])/EDGE_GRID);
    if ((x1-x0+1)*(y1-y0+1)>128) { longEdges.push(i); continue; }
    for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++) {
      const key=`${x},${y}`; if(!cells.has(key)) cells.set(key,[]); cells.get(key).push(i);
    }
  }
  const result={cells,longEdges};edgeIndexes.set(graph,result);return result;
}
export function findNearestEdge(graph, point, limit = 50) {
  if (!finiteCoordinate(point) || !(limit > 0)) return null;
  let best = null, best2 = limit * limit;
  const cos = Math.cos(radians(point[1])), mx = 111320 * cos, my = 111320;
  const dx = limit / mx, dy = limit / my;
  const {cells,longEdges}=spatialEdges(graph), candidates=new Set(longEdges);
  for(let x=Math.floor((point[0]-dx)/EDGE_GRID);x<=Math.floor((point[0]+dx)/EDGE_GRID);x++)
    for(let y=Math.floor((point[1]-dy)/EDGE_GRID);y<=Math.floor((point[1]+dy)/EDGE_GRID);y++)
      for(const index of cells.get(`${x},${y}`)||[]) candidates.add(index);
  // Stable ordering preserves deterministic tie selection from the original scan.
  for (const index of [...candidates].sort((a,b)=>a-b)) {
    const [ai,bi] = graph.edges[index], a = graph.nodes[ai], b = graph.nodes[bi];
    if (!a || !b || point[0] < Math.min(a[0],b[0])-dx || point[0] > Math.max(a[0],b[0])+dx || point[1] < Math.min(a[1],b[1])-dy || point[1] > Math.max(a[1],b[1])+dy) continue;
    const ax = (a[0]-point[0])*mx, ay = (a[1]-point[1])*my, bx = (b[0]-point[0])*mx, by = (b[1]-point[1])*my;
    const x = bx-ax, y = by-ay, len2 = x*x+y*y; if (!len2) continue;
    const t = Math.max(0, Math.min(1, -(ax*x+ay*y)/len2)), qx = ax+x*t, qy = ay+y*t, d2 = qx*qx+qy*qy;
    if (d2 < best2) { best2 = d2; best = {edgeIndex:index, t, coordinate:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t], distanceMeters:Math.sqrt(d2)}; }
  }
  return best;
}
class MinHeap {
  constructor() { this.a = []; }
  push(node,score) { let i=this.a.length; this.a.push({node,score}); while(i>0) {const p=(i-1)>>1;if(this.a[p].score<=score)break;this.a[i]=this.a[p];i=p;}this.a[i]={node,score}; }
  pop() { const arr=this.a, top=arr[0], last=arr.pop(); if(arr.length) {let i=0;while(true){let l=i*2+1;if(l>=arr.length)break;let r=l+1,c=r<arr.length&&arr[r].score<arr[l].score?r:l;if(arr[c].score>=last.score)break;arr[i]=arr[c];i=c;}arr[i]=last;}return top; }
  get length() { return this.a.length; }
}
const adjacencyCache = new WeakMap();
function adjacency(graph) {
  if (adjacencyCache.has(graph)) return adjacencyCache.get(graph);
  const n=graph.nodes.length, max=graph.edges.length*2, head=new Int32Array(n);head.fill(-1);
  const to=new Int32Array(max), next=new Int32Array(max), weight=new Float32Array(max); let count=0;
  const add=(a,b,d)=>{to[count]=b;weight[count]=d;next[count]=head[a];head[a]=count++;};
  for (const [a,b,dir=0] of graph.edges) {
    if (!graph.nodes[a] || !graph.nodes[b] || a===b) continue;
    const d=distanceMeters(graph.nodes[a],graph.nodes[b]); if (!Number.isFinite(d) || d <= 0) continue;
    if (dir !== -1) add(a,b,d); if (dir !== 1) add(b,a,d);
  }
  const data={head,to,next,weight};adjacencyCache.set(graph,data);return data;
}
async function shortestPath(graph, start, end) {
  const n=graph.nodes.length, source=n, target=n+1, extra=new Map();
  const add=(a,b,d)=>{if(!extra.has(a))extra.set(a,[]);extra.get(a).push([b,d]);};
  const [sa,sb,sd=0]=graph.edges[start.edgeIndex], [ea,eb,ed=0]=graph.edges[end.edgeIndex];
  const sw=distanceMeters(graph.nodes[sa],graph.nodes[sb]), ew=distanceMeters(graph.nodes[ea],graph.nodes[eb]);
  // A source in the middle of a directed edge can only leave in legal directions.
  if (sd !== 1) add(source,sa,sw*start.t); if (sd !== -1) add(source,sb,sw*(1-start.t));
  if (ed !== -1) add(ea,target,ew*end.t); if (ed !== 1) add(eb,target,ew*(1-end.t));
  if (start.edgeIndex === end.edgeIndex && ((end.t >= start.t && sd !== -1) || (end.t <= start.t && sd !== 1))) add(source,target,sw*Math.abs(end.t-start.t));
  const {head,to,next,weight}=adjacency(graph), dist=new Float64Array(n+2);dist.fill(Infinity);dist[source]=0;
  const prev=new Int32Array(n+2);prev.fill(-1);const closed=new Uint8Array(n+2), heap=new MinHeap();heap.push(source,0);
  const pos=i=>i===source?start.coordinate:i===target?end.coordinate:graph.nodes[i];
  const relax=(a,b,w)=>{const d=dist[a]+w;if(d<dist[b]){dist[b]=d;prev[b]=a;heap.push(b,d+distanceMeters(pos(b),end.coordinate));}};
  let expansions=0;
  while(heap.length){if (++expansions % 20000 === 0) await new Promise(resolve => setTimeout(resolve, 0)); const u=heap.pop().node;if(closed[u])continue;closed[u]=1;if(u===target)break;
    if(u<n)for(let k=head[u];k!==-1;k=next[k])relax(u,to[k],weight[k]);
    for(const [v,w] of extra.get(u)||[])relax(u,v,w);
  }
  if (!Number.isFinite(dist[target])) return null;
  const path=[];for(let p=target;p!==-1;p=prev[p])path.push(pos(p));path.reverse();
  return {distanceMeters:dist[target],geometry:path.filter((p,i)=>i===0 || distanceMeters(p,path[i-1])>.01)};
}
function samplePath(path,distance) {
  if (!path.length) return [];
  const cumulative=[0];for(let i=1;i<path.length;i++)cumulative.push(cumulative[i-1]+distanceMeters(path[i-1],path[i]));
  const total=cumulative.at(-1), spacing=Math.max(30,total/999), out=[];let segment=1;
  for(let d=0;d<total;d+=spacing){while(segment<cumulative.length-1&&cumulative[segment]<d)segment++;const prev=segment-1, len=cumulative[segment]-cumulative[prev], f=len ? (d-cumulative[prev])/len : 0;const a=path[prev],b=path[segment];out.push({distanceMeters:d,coordinate:[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f]});}
  if(total>0)out.push({distanceMeters:total,coordinate:path.at(-1)});
  if (!out.length) out.push({distanceMeters:0,coordinate:path[0]});
  return out;
}
export async function computeWalkingRoute({graph,start,end,sampleElevations}) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return {status:'graph_unavailable',message:'이 지역의 보행망이 없습니다.'};
  if (!finiteCoordinate(start) || !finiteCoordinate(end)) return {status:'invalid_position',message:'출발점과 도착점을 선택해 주세요.'};
  const a=findNearestEdge(graph,start),b=findNearestEdge(graph,end);
  if(!a || !b)return {status:'snap_too_far',message:'출발점 또는 도착점이 보행망에서 50m 이상 떨어져 있습니다.',startSnapMeters:a?.distanceMeters??null,endSnapMeters:b?.distanceMeters??null};
  const path=await shortestPath(graph,a,b);if(!path)return {status:'no_route',message:'연결된 보행 경로를 찾지 못했습니다.',startSnapMeters:a.distanceMeters,endSnapMeters:b.distanceMeters};
  const result={status:'ok',geometry:path.geometry,coordinates:path.geometry,distanceMeters:path.distanceMeters,startSnapMeters:a.distanceMeters,endSnapMeters:b.distanceMeters,source:graph.source,profile:[],elevationGainMeters:null,elevationLossMeters:null};
  return enrichWalkingRoute(result,sampleElevations);
}
// Route search can run in a worker; terrain decoding remains on the browser thread.
export async function enrichWalkingRoute(result,sampleElevations) {
  if (!result || !Array.isArray(result.geometry) || !Number.isFinite(result.distanceMeters)) return result;
  const points=samplePath(result.geometry,result.distanceMeters);
  if(typeof sampleElevations!=='function')return {...result,status:'elevation_unavailable',message:'고도 자료를 사용할 수 없어 경사 계산을 표시하지 않습니다.'};
  let heights;
  try { heights=await sampleElevations(points.map(p=>p.coordinate)); } catch { heights=null; }
  if(!Array.isArray(heights) || heights.length!==points.length || heights.some(v=>v==null || !Number.isFinite(v)))return {...result,status:'elevation_unavailable',message:'일부 고도를 읽지 못해 경사 계산을 표시하지 않습니다.'};
  const smoothed=heights.map((v,i)=>{const a=Math.max(0,i-1),b=Math.min(heights.length-1,i+1);return heights.slice(a,b+1).reduce((sum,x)=>sum+x,0)/(b-a+1);});
  const gradients=smoothed.map((v,i)=>i ? (v-smoothed[i-1])/(points[i].distanceMeters-points[i-1].distanceMeters || 1)*100 : null);
  const meanSlopes=gradients.map((v,i)=>{if(i===0)return null;const arr=gradients.slice(Math.max(1,i-1),Math.min(gradients.length,i+2)).filter(Number.isFinite);return arr.reduce((a,b)=>a+b,0)/arr.length;});
  let gain=0,loss=0; for(let i=1;i<smoothed.length;i++){const delta=smoothed[i]-smoothed[i-1];if(delta>0)gain+=delta;else loss-=delta;}
  return {...result,status:'ok',message:undefined,profile:points.map((p,i)=>({...p,elevation:smoothed[i],slopePercent:meanSlopes[i]})),elevationGainMeters:gain,elevationLossMeters:loss};
}
