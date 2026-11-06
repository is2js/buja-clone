import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {preparePages,PUBLIC_PROFILE} from '../scripts/prepare-pages.mjs';

async function fixture(t) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'buja-pages-test-')));
  t.after(async()=>{
    const actual=await fs.realpath(root);
    assert.equal(actual,path.resolve(root));
    assert.ok(path.basename(actual).startsWith('buja-pages-test-'));
    assert.equal(path.dirname(actual),await fs.realpath(os.tmpdir()));
    await fs.rm(actual,{recursive:true,force:true});
  });
  const files={
    'index.html':'<html>public application</html>',
    'assets/app.js':'console.log("public");',
    'data/geo.json':'{}','data/legal.json':'{}','data/gtx-public.json':'{}','data/gtx-coordinates.json':'{}','data/sample-3d.json':'{}',
    'data/SOURCES.md':'Independent source notices','data/real/businesses.json':'{"businessesByRegion":{}}',
    'data/buildings/manifest.json':'{"source":{"license":"ODbL-1.0"}}',
    'data/walking/seoul-hanam.json':'{"source":{"license":"ODbL-1.0"}}',
    'data/real/apartments/index.json':'{}',
    'data/real/transactions.json':'{"byRegion":{"legal:123":{"price":987654321}}}',
    'data/real/transactions-other.json':'{"byRegion":{"legal:456":{"price":123456789}}}',
    'data/demo.json':'{"price":333333333}',
    '.env.local':'PRIVATE_VALUE_MUST_NOT_PUBLISH',
  };
  for (const [name,body]of Object.entries(files)) {const file=path.join(root,'dist',name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,body);}
  await fs.mkdir(path.join(root,'scripts'));
  for(const name of ['build-osm-buildings.py','build-walking-graph.py','building_publish.py'])await fs.writeFile(path.join(root,'scripts',name),'# published OSM transformation\n');
  return root;
}

test('public artifact withholds local transactions and excludes unknown/private files',async t=>{
  const root=await fixture(t),result=await preparePages({projectRoot:root}),out=result.outputDir;
  for(const name of ['transactions.json','transactions-other.json']) {
    const value=JSON.parse(await fs.readFile(path.join(out,'data/real',name),'utf8'));
    assert.equal(value.status,'withheld');assert.equal(value.publicProfile,PUBLIC_PROFILE);assert.equal(value.asOf,null);assert.deepEqual(value.byRegion,{});assert.deepEqual(value.months,[]);
  }
  assert.match(await fs.readFile(path.join(root,'dist/data/real/transactions.json'),'utf8'),/987654321/);
  await assert.rejects(fs.access(path.join(out,'.env.local')));
  await assert.rejects(fs.access(path.join(out,'data/demo.json')));
  assert.match(await fs.readFile(path.join(out,'DATA-LICENSES.md'),'utf8'),/opendatacommons\.org\/licenses\/odbl\/1-0/);
  assert.equal(JSON.parse(await fs.readFile(path.join(out,'release-profile.json'),'utf8')).transactionsWithheld,true);
  const pointer=JSON.parse(await fs.readFile(path.join(root,'work/pages-output.json'),'utf8'));
  assert.equal(path.resolve(root,pointer.outputDir),out);assert.equal(pointer.profile,PUBLIC_PROFILE);
});

test('unreviewed output and arbitrary output paths are preserved and rejected',async t=>{
  const root=await fixture(t),out=path.join(root,'work/pages-dist');
  await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'user-file.txt'),'keep');
  await assert.rejects(preparePages({projectRoot:root}),/보존/);
  assert.equal(await fs.readFile(path.join(out,'user-file.txt'),'utf8'),'keep');
  await assert.rejects(preparePages({projectRoot:root,outputDir:root}),/제한/);
});

test('known artifacts are replaced reversibly and stray metrics fail before replacement',async t=>{
  const root=await fixture(t),first=await preparePages({projectRoot:root});
  await fs.writeFile(path.join(first.outputDir,'keep-evidence.txt'),'previous version');
  const second=await preparePages({projectRoot:root});
  assert.equal(await fs.readFile(path.join(second.previousDir,'pages-dist/keep-evidence.txt'),'utf8'),'previous version');
  await fs.writeFile(path.join(root,'dist/data/legal.json'),'{"regions":[{"price":123}]}');
  await assert.rejects(preparePages({projectRoot:root}),/실거래 지표/);
  assert.equal(JSON.parse(await fs.readFile(path.join(second.outputDir,'release-profile.json'),'utf8')).profile,PUBLIC_PROFILE);
});
