import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createVWorldMiddleware,parseBounds,parseTilePath,isAllowedLocalRequest,vworldExpiryStatus} from '../scripts/vworld-dev-proxy.mjs';

const dummySecret = 'test_credential_only_in_memory';
const headers = () => ({host:'127.0.0.1:5189'});
test('expiry warning uses Korean calendar dates and includes the displayed expiry day', () => {
  const check = time => vworldExpiryStatus('2027-05-05', new Date(time));
  assert.deepEqual(check('2027-04-04T15:00:00Z'), {state:'expiring',expiresOn:'2027-05-05',daysRemaining:30});
  assert.equal(check('2027-04-04T14:59:59Z').state,'valid');
  assert.equal(check('2027-05-05T14:59:59Z').daysRemaining,0);
  assert.equal(check('2027-05-05T15:00:00Z').state,'expired');
  assert.equal(vworldExpiryStatus('2027-02-30').state,'invalid');
  assert.equal(vworldExpiryStatus('').state,'unknown');
});
test('proxy accepts only same-origin requests from loopback', () => {
  const req={socket:{remoteAddress:'127.0.0.1'},headers:headers()};
  assert.equal(isAllowedLocalRequest(req),true);
  assert.equal(isAllowedLocalRequest({...req,headers:{...headers(),origin:'https://untrusted.example'}}),false);
  assert.equal(isAllowedLocalRequest({...req,headers:{...headers(),'sec-fetch-site':'cross-site'}}),false);
  assert.equal(isAllowedLocalRequest({...req,headers:{host:'attacker.example'}}),false);
  assert.equal(isAllowedLocalRequest({...req,socket:{remoteAddress:'192.168.0.3'}}),false);
});
test('tile and building bounds reject overbroad or arbitrary requests', () => {
  assert.deepEqual(parseTilePath('/api/vworld/tiles/15/1/1.png'),null); // invalid Korean envelope
  assert.equal(parseTilePath('/api/vworld/tiles/20/0/0.png'),null);
  assert.equal(parseTilePath('/api/vworld/tiles/15/../../other.png'),null);
  assert.ok(parseBounds(new URLSearchParams('west=127.126&south=37.406&east=127.128&north=37.408')));
  assert.equal(parseBounds(new URLSearchParams('west=127&south=37&east=128&north=38')),null);
  assert.equal(parseBounds(new URLSearchParams('west=NaN&south=37&east=128&north=38')),null);
});
test('proxy validates results and never returns its credential', async () => {
  const geometry={type:'Polygon',coordinates:[[[127.126,37.406],[127.127,37.406],[127.127,37.407],[127.126,37.406]]]};
  const source={type:'FeatureCollection',totalFeatures:3,features:[
    {type:'Feature',geometry,properties:{pk:'id-1',buld_nm:'sample',gro_flo_co:15,unwanted:dummySecret}},
    {type:'Feature',geometry,properties:{pk:'id-2',gro_flo_co:null}},
  ]};
  const proxy=createVWorldMiddleware({key:dummySecret,upstreamFetch:async()=>new Response(JSON.stringify(source),{status:200,headers:{'content-type':'application/json'}})});
  const server=createServer((req,res)=>proxy(req,res,()=>{res.statusCode=404;res.end();}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const origin=`http://127.0.0.1:${server.address().port}`;
    const status=await fetch(`${origin}/api/vworld/status`); const statusText=await status.text();
    assert.equal(status.status,200); assert.equal(statusText.includes(dummySecret),false);
    const response=await fetch(`${origin}/api/vworld/buildings?west=127.126&south=37.406&east=127.128&north=37.408`);
    const text=await response.text(), data=JSON.parse(text);
    assert.equal(response.status,200); assert.equal(text.includes(dummySecret),false);
    assert.equal(data.features.length,2); assert.equal(data.features[0].properties.height,45);
    assert.equal(data.features[0].properties.heightSource,'levels');
    assert.equal(data.features[1].properties.height,null); assert.equal(data.features[1].properties.heightSource,'unknown');
    assert.equal(data.metadata.received,2); assert.equal(data.metadata.missingHeight,1); assert.equal(data.metadata.truncated,true);
    const cross=await fetch(`${origin}/api/vworld/status`,{headers:{origin:'https://untrusted.example'}});
    assert.equal(cross.status,403);
    const malformed=await fetch(`${origin}/api/vworld/buildings?west=127&south=37&east=128&north=38`);
    assert.equal(malformed.status,400);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
