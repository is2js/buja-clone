// Parsing, indexing and searching the large graph stay off the UI thread.
import { loadWalkingGraph, computeWalkingRoute } from './walking.js';
self.addEventListener('message', async event => {
  const {id,start,end}=event.data || {};
  try {
    const graph=await loadWalkingGraph();
    const result=await computeWalkingRoute({graph,start,end});
    self.postMessage({id,result});
  } catch {
    self.postMessage({id,error:'보행망을 불러오거나 경로를 계산하지 못했습니다.'});
  }
});
