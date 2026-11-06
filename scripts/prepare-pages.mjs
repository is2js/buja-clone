// Produce a deliberately scoped public artifact without changing local datasets.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLIC_PROFILE = 'github-pages-public-v1';
export const WITHHELD_TRANSACTIONS = ['data/real/transactions.json','data/real/transactions-other.json'];
const FILES = ['index.html','data/geo.json','data/legal.json','data/gtx-public.json','data/gtx-coordinates.json','data/sample-3d.json','data/SOURCES.md','data/real/businesses.json'];
const DIRECTORIES = ['assets','data/buildings','data/walking','data/real/apartments'];
const METRIC_FIELDS = new Set(['price','score','transactions','jeonse','change1','change3','change6','monthlyCounts','commercialByRegion','deals','series','history','rentMedian','monthlyRentMedian']);

export function transactionPlaceholder() {
  return {
    status:'withheld',publicProfile:PUBLIC_PROFILE,asOf:null,updatedAt:null,
    source:'공개판 실거래 자료 미제공',months:[],byRegion:{},commercialByRegion:{},businessesByRegion:{},coverage:[],
    notice:'공개판에는 계약일 기준 로컬 실거래 집계와 그 점수를 포함하지 않습니다. 제공기관의 외부 공개 기준을 확인하고 독립 수집 자료로 교체할 예정입니다.',
    sourceUrl:'https://rt.molit.go.kr/pt/xls/xls.do',
    publicationGuidanceUrl:'https://rt.molit.go.kr/pt/info/info.do',
    alternativeSourceUrl:'https://www.data.go.kr/data/3050988/fileData.do',
  };
}

function assertNoMetricPayload(value, source) {
  if (!value || typeof value!=='object') return;
  for (const [key,child] of Object.entries(value)) {
    if (METRIC_FIELDS.has(key) && child!=null && (typeof child!=='object' || Object.keys(child).length)) throw new Error(`공개판 허용 자료에 실거래 지표가 있습니다: ${source} (${key})`);
    if (child && typeof child==='object') assertNoMetricPayload(child,source);
  }
}
async function exists(file) { try {await fs.access(file);return true;} catch {return false;} }
async function renameArtifact(from,to) {
  for (let attempt=0;;attempt++) {
    try {await fs.rename(from,to);return;}
    catch(error) {
      if (!['EPERM','EBUSY','EACCES'].includes(error.code) || attempt>=3) throw error;
      // Windows virus scanners and indexers may briefly hold newly written files.
      await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
    }
  }
}
async function copyPublicTree(from,to,relative='') {
  const stat=await fs.lstat(from);
  if (stat.isSymbolicLink()) throw new Error(`심볼릭 링크는 배포하지 않습니다: ${relative}`);
  if (stat.isDirectory()) {
    await fs.mkdir(to,{recursive:true});
    const names=await fs.readdir(from);
    for (const name of names) {
      if (name.startsWith('.') || /^(?:node_modules|work)$/i.test(name)) throw new Error(`배포 허용 목록 밖의 항목입니다: ${relative}/${name}`);
    }
    let index=0;
    await Promise.all(Array.from({length:Math.min(8,names.length)},async()=>{
      while (index<names.length) {const name=names[index++];await copyPublicTree(path.join(from,name),path.join(to,name),`${relative}/${name}`);}
    }));
    return;
  }
  if (!stat.isFile()) throw new Error(`일반 파일이 아닙니다: ${relative}`);
  if (relative.startsWith('data/')) {
    if (!/\.(?:json|md)$/i.test(relative)) throw new Error(`공개 데이터 파일 형식을 확인하세요: ${relative}`);
    if (relative.endsWith('.json')) assertNoMetricPayload(JSON.parse(await fs.readFile(from,'utf8')),relative);
  } else if (relative.startsWith('assets/') && !/\.(?:js|css|woff2?|ttf|png|jpe?g|svg|webp|avif|gif|ico)$/i.test(relative)) {
    throw new Error(`허용하지 않은 빌드 자산 형식입니다: ${relative}`);
  }
  await fs.mkdir(path.dirname(to),{recursive:true});
  await fs.copyFile(from,to);
}

const LICENSE_NOTICE = `# 공개판 데이터 출처와 이용 조건\n\n이 배포물은 전국 지도·3D 건물·공개 단지 목록을 확인하는 학습용 공개판입니다. 로컬 계약일 실거래 집계와 원본 사이트의 가공 시세·뉴스는 포함하지 않습니다.\n\n- 건물과 시범 보행망: © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). [Geofabrik 대한민국 추출본](https://download.geofabrik.de/asia/south-korea.html)을 건물 타일/보행 그래프로 가공했습니다. 가공 데이터 자체와 처리 스크립트를 이 배포물의 data/buildings, data/walking, data/processing에서 제공합니다. OSM 파생 데이터베이스는 ODbL 1.0으로 제공합니다. 앱 코드 전체의 라이선스를 의미하지 않습니다.\n- 배경 타일: © [OpenStreetMap 기여자](https://www.openstreetmap.org/copyright). 현재 화면의 대화형 조회만 사용하며 [타일 이용 정책](https://operations.osmfoundation.org/policies/tiles/)의 캐시·Referer·출처표시를 유지합니다. 사전 일괄 다운로드·오프라인 타일 배포는 제공하지 않습니다. 서비스 보장은 없습니다.\n- 고도: Terrain Tiles / Mapzen; SRTM 및 GMTED2010 data courtesy of the U.S. Geological Survey. [자료 목록](https://registry.opendata.aws/terrain-tiles/), [원자료별 출처와 조건](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). 저해상도 고도이며 현장 측량이나 세부 보행 가능성을 보증하지 않습니다.\n- 전국 단지: 한국부동산원 [기본정보](https://www.data.go.kr/data/15106861/fileData.do)·[동정보](https://www.data.go.kr/data/15106866/fileData.do), 이용허락범위 제한 없음.\n- 단지 대표 좌표: [서울시 공동주택](https://data.seoul.go.kr/dataList/OA-15818/S/1/datasetView.do), 공공누리 제1유형(출처표시); [하남시](https://www.data.go.kr/data/3047304/fileData.do), [달서구](https://www.data.go.kr/data/15054183/fileData.do), [광산구](https://www.data.go.kr/data/15100132/fileData.do)는 이용허락범위 제한 없음. 실제 출입구를 뜻하지 않습니다.\n- 상권 집계: 소상공인시장진흥공단 [상가(상권)정보](https://www.data.go.kr/data/15083033/fileData.do), 이용허락범위 제한 없음. 업소·업종 집계이며 거래가격·임대료·매출 통계가 아닙니다.\n- 행정/법정 경계와 GTX: 이 배포물의 [data/SOURCES.md](data/SOURCES.md)와 각 파일의 출처·기준일을 확인하세요. 별도 공개 프로필 점검을 통과한 파일만 게시합니다.\n\n브이월드 키와 로컬 프록시는 포함하지 않습니다. 공개판은 OSM 정적 건물을 사용하므로 로컬 브이월드가 보완한 건물과 표시 범위가 다를 수 있습니다.\n`;

export async function preparePages({projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),inputDir,outputDir,githubOutput}={}) {
  projectRoot=path.resolve(projectRoot);
  inputDir=path.resolve(inputDir || path.join(projectRoot,'dist'));
  const work=path.join(projectRoot,'work');
  outputDir=path.resolve(outputDir || path.join(work,'pages-dist'));
  // No caller-supplied filesystem path is ever recursively deleted or moved.
  if (outputDir!==path.join(work,'pages-dist')) throw new Error('출력은 프로젝트 work/pages-dist로 제한합니다.');
  if (inputDir===outputDir || !inputDir.startsWith(projectRoot+path.sep)) throw new Error('빌드 입력 경로를 확인하세요.');
  for (const entry of [...FILES,...DIRECTORIES]) if (!await exists(path.join(inputDir,entry))) throw new Error(`필수 빌드 입력이 없습니다: ${entry}`);
  await fs.mkdir(work,{recursive:true});
  const realProject=await fs.realpath(projectRoot), realWork=await fs.realpath(work);
  if (realWork!==path.join(realProject,'work') || (await fs.lstat(inputDir)).isSymbolicLink()) throw new Error('입력·출력의 실제 경로를 확인하세요.');
  if (await exists(outputDir)) {
    let previous;
    try {previous=JSON.parse(await fs.readFile(path.join(outputDir,'release-profile.json'),'utf8'));} catch {throw new Error('기존 pages-dist가 이 스크립트 산출물인지 확인할 수 없습니다. 보존합니다.');}
    if (previous.profile!==PUBLIC_PROFILE || previous.generatedBy!=='scripts/prepare-pages.mjs') throw new Error('기존 pages-dist가 확인된 산출물이 아니므로 보존합니다.');
    if ((await fs.lstat(outputDir)).isSymbolicLink()) throw new Error('출력 경로가 심볼릭 링크입니다.');
  }
  const stage=await fs.mkdtemp(path.join(work,'pages-candidate-'));
  for (const entry of [...FILES,...DIRECTORIES]) await copyPublicTree(path.join(inputDir,entry),path.join(stage,entry),entry);
  for (const entry of WITHHELD_TRANSACTIONS) {
    await fs.mkdir(path.dirname(path.join(stage,entry)),{recursive:true});
    await fs.writeFile(path.join(stage,entry),JSON.stringify(transactionPlaceholder()));
  }
  for (const entry of ['data/buildings/manifest.json','data/walking/seoul-hanam.json']) {
    const file=path.join(stage,entry),data=JSON.parse(await fs.readFile(file,'utf8'));
    data.source={...data.source,license:'ODbL-1.0',licenseTextUrl:'https://opendatacommons.org/licenses/odbl/1-0/'};
    await fs.writeFile(file,JSON.stringify(data));
  }
  await fs.mkdir(path.join(stage,'data/processing'),{recursive:true});
  for (const name of ['build-osm-buildings.py','build-walking-graph.py','building_publish.py']) await fs.copyFile(path.join(projectRoot,'scripts',name),path.join(stage,'data/processing',name));
  const profile={profile:PUBLIC_PROFILE,generatedBy:'scripts/prepare-pages.mjs',generatedAt:new Date().toISOString(),publicProfile:true,transactionsWithheld:true,withheldFiles:WITHHELD_TRANSACTIONS,reason:transactionPlaceholder().notice,localDataChanged:false,vworldCredentialsIncluded:false};
  await fs.writeFile(path.join(stage,'release-profile.json'),JSON.stringify(profile,null,2)+'\n');
  await fs.writeFile(path.join(stage,'DATA-LICENSES.md'),LICENSE_NOTICE);
  await fs.writeFile(path.join(stage,'.nojekyll'),'');
  // Preserve an old verified artifact as a reversible sibling before replacing it.
  // Windows may keep a complete directory locked; use the complete unique
  // candidate in that case, never merge it into an old or unreviewed directory.
  let previousDir=null, actualOutput=stage, canPromote=true;
  if (await exists(outputDir)) {
    previousDir=await fs.mkdtemp(path.join(work,'pages-previous-'));
    try {await renameArtifact(outputDir,path.join(previousDir,'pages-dist'));}
    catch(error) {if(!['EPERM','EBUSY','EACCES'].includes(error.code))throw error;previousDir=null;canPromote=false;}
  }
  if (canPromote) {
    try {await renameArtifact(stage,outputDir);actualOutput=outputDir;}
    catch(error) {
      if (!['EPERM','EBUSY','EACCES'].includes(error.code)) {
        if(previousDir && !await exists(outputDir)) await renameArtifact(path.join(previousDir,'pages-dist'),outputDir);
        throw error;
      }
    }
  }
  const relativeOutput=path.relative(projectRoot,actualOutput).split(path.sep).join('/');
  await fs.writeFile(path.join(work,'pages-output.json'),JSON.stringify({outputDir:relativeOutput,profile:PUBLIC_PROFILE},null,2)+'\n');
  if (githubOutput) await fs.appendFile(githubOutput,`pages_dir=${relativeOutput}\n`);
  return {outputDir:actualOutput,requestedOutputDir:outputDir,relativeOutput,profile:PUBLIC_PROFILE,transactionsWithheld:true,previousDir};
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  preparePages({githubOutput:process.env.GITHUB_OUTPUT}).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
