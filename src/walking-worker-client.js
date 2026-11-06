let worker=null, sequence=0;
const pending=new Map();
function failWorker(message) {
  worker?.terminate(); worker=null;
  for (const {reject} of pending.values()) reject(new Error(message));
  pending.clear();
}
export function cancelWalkingPath() {
  if (pending.size) failWorker('보행 경로 계산이 취소되었습니다.');
}
export function calculateWalkingPath(start,end) {
  if (typeof Worker==='undefined') return Promise.reject(new Error('이 브라우저에서는 보행 경로 작업을 지원하지 않습니다.'));
  if (!worker) {
    worker=new Worker(new URL('./walking-worker.js',import.meta.url),{type:'module'});
    worker.addEventListener('message',event=>{
      const {id,result,error}=event.data || {}, job=pending.get(id);
      if (!job) return;
      pending.delete(id); if(error) job.reject(new Error(error)); else job.resolve(result);
    });
    worker.addEventListener('error',()=>failWorker('보행 경로 작업을 실행하지 못했습니다. 다시 시도해 주세요.'));
    worker.addEventListener('messageerror',()=>failWorker('보행 경로 결과를 읽지 못했습니다. 다시 시도해 주세요.'));
  }
  const id=++sequence;
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});try{worker.postMessage({id,start,end});}catch{pending.delete(id);reject(new Error('보행 경로 작업을 시작하지 못했습니다.'));}});
}
