// Read-only data health check; exits nonzero only on invalid required snapshots.
import fs from 'node:fs';
import { applyPartialScores } from '../src/scoring.js';

const read = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
try {
  const tx = read('../public/data/real/transactions.json');
  const other = read('../public/data/real/transactions-other.json');
  const shop = read('../public/data/real/businesses.json');
  const legal = read('../public/data/legal.json');
  const geo = read('../public/data/geo.json');
  if (!tx.asOf || !Object.keys(tx.byRegion || {}).length || !other.asOf || !Object.keys(other.byRegion || {}).length || !shop.asOf || !Object.keys(shop.businessesByRegion || {}).length) throw new Error('거래 또는 상권 스냅샷이 비어 있습니다.');
  const legalCodes = new Set(legal.regions.map(r => r.code));
  const regions = Object.entries({ ...other.byRegion, ...tx.byRegion }).map(([key, r]) => {
    const [kind, code] = key.split(':');
    return { ...r, kind, code, area: code.slice(0,2) };
  });
  const invalidRegion = regions.filter(r => r.kind === 'legal' ? !legalCodes.has(r.code) : r.kind === 'gu' ? !geo.gu[r.code] : true);
  if (invalidRegion.length) throw new Error(`거래 지역 코드 불일치: ${invalidRegion.length}개`);
  const result = applyPartialScores(regions);
  const scores = {};
  for (const r of regions) if (r.scoreInfo) { const key = `${r.area}:${r.kind}`; scores[key] = (scores[key] || 0) + 1; }
  const sums = new Map();
  for (const [key, value] of Object.entries(shop.businessesByRegion)) if (key.startsWith('legal:')) {
    const gu = key.slice(6,11); sums.set(gu, (sums.get(gu) || 0) + value.count);
  }
  const discrepancies = Object.entries(shop.businessesByRegion).filter(([key]) => key.startsWith('gu:')).map(([key, v]) => ({ gu: key.slice(3), district: v.count, legalSum: sums.get(key.slice(3)) || 0, difference: v.count - (sums.get(key.slice(3)) || 0) })).filter(r => r.difference !== 0);
  const now = new Date(), [year, month] = String(tx.asOf).split('-').map(Number);
  const ageMonths = now.getFullYear() * 12 + now.getMonth() + 1 - (year * 12 + month);
  console.log(JSON.stringify({transactionsAsOf:tx.asOf, otherTransactionsAsOf:other.asOf, businessesAsOf:shop.asOf, dataAgeMonths:ageMonths,
    refresh:'수동', legalCodes:legal.regions.length, legalGeometryAsOf:legal.source.geometryBasis,
    scores:result, scoredByAreaAndType:scores, businessMatchDiagnostics:shop.diagnostics,
    businessDistrictVsLegalDifferences:discrepancies}, null, 2));
} catch (error) { console.error('데이터 점검 실패:', error.message); process.exitCode = 1; }
