// Review evidence applies to the scoped public artifact, never to all local data.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=async file=>JSON.parse(await readFile(file,'utf8'));
try {
  const checklist=await read(path.join(root,'release-checklist.json'));
  if (checklist.profile!=='github-pages-public-v1') throw new Error('검토 대상 공개 프로필이 없습니다.');
  for (const id of ['geo_reuse','transaction_publication','data_licenses','map_provider']) {
    const item=checklist[id];
    if (item?.verified!==true || !item.evidence?.trim()) throw new Error(`미완료: ${id} — ${item?.reason || '근거 확인 필요'}`);
  }
  const pointer=await read(path.join(root,'work/pages-output.json'));
  const output=path.resolve(root,pointer.outputDir || '');
  if (!output.startsWith(path.join(root,'work')+path.sep) || pointer.profile!==checklist.profile) throw new Error('공개 산출물 경로를 확인하세요.');
  const profile=await read(path.join(output,'release-profile.json'));
  if (profile.profile!==checklist.profile || profile.transactionsWithheld!==true) throw new Error('공개 자료 제외 프로필이 아닙니다.');
  for (const name of ['transactions.json','transactions-other.json']) {
    const tx=await read(path.join(output,'data/real',name));
    if (tx.status!=='withheld' || tx.publicProfile!==profile.profile || tx.asOf!==null || tx.months?.length || Object.keys(tx.byRegion || {}).length || Object.keys(tx.commercialByRegion || {}).length) throw new Error(`공개판에 로컬 실거래 자료가 있습니다: ${name}`);
  }
  const geo=await read(path.join(output,'data/geo.json'));
  if (geo.source?.independentlyGenerated!==true || geo.source.repository!=='https://github.com/vuski/admdongkor' || !/^[a-f0-9]{40}$/.test(geo.source.revision || '') || !/^[a-f0-9]{64}$/.test(geo.source.sha256 || '') || geo.source.license!=='CC-BY-4.0' || geo.stations || geo.stationXY) throw new Error('독립 행정 경계의 출처·변환 기록을 확인하세요.');
  const gtx=await read(path.join(output,'data/gtx-public.json'));
  for (const route of gtx.routes || []) for (const station of route.stations || []) {
    if (station.coordinate && String(station.coordinateSource?.url || '').includes('kric.go.kr')) throw new Error('공개 조건 미확인 좌표가 포함되어 있습니다.');
  }
  const manifest=await read(path.join(output,'data/buildings/manifest.json'));
  if (!manifest.tiles?.length || manifest.source?.licenseTextUrl!=='https://opendatacommons.org/licenses/odbl/1-0/') throw new Error('OSM 건물 자료·라이선스가 없습니다.');
  const credits=await readFile(path.join(output,'DATA-LICENSES.md'),'utf8');
  if (!credits.includes('SGIS') && !(await readFile(path.join(output,'data/SOURCES.md'),'utf8')).includes('SGIS')) throw new Error('행정 경계 출처 표기가 없습니다.');
  console.log(`공개 프로필 검사 통과: ${profile.profile}; 실거래 제외, 독립 경계, OSM 건물·출처 확인`);
} catch(error) {
  console.error(`배포 점검 실패: ${error.message}`);
  process.exitCode=1;
}
