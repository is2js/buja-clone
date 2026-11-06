// Source-specific snapshots are optional; a missing file never becomes sample data.
const base = import.meta.env.BASE_URL;
async function readSnapshot(path) {
  try {
    const response = await fetch(`${base}data/real/${path}`);
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return await response.json();
  } catch (error) { console.warn('공식 데이터 스냅샷을 불러오지 못했습니다.', error); return null; }
}
export async function loadRealData() {
  const [transactions, otherTransactions, businesses] = await Promise.all([readSnapshot('transactions.json'), readSnapshot('transactions-other.json'), readSnapshot('businesses.json')]);
  const businessRegions = businesses?.businessesByRegion || {};
  const legalTotals = {};
  for (const [key, value] of Object.entries(businessRegions)) if (key.startsWith('legal:')) {
    const district = key.slice(6, 11); legalTotals[district] = (legalTotals[district] || 0) + Number(value.count || 0);
  }
  const businessCoverageByGu = {};
  for (const [key, value] of Object.entries(businessRegions)) if (key.startsWith('gu:')) {
    const district = key.slice(3); const difference = Number(value.count || 0) - (legalTotals[district] || 0);
    if (difference !== 0) businessCoverageByGu[district] = { difference };
  }
  return {
    businessCoverageByGu,
    status: transactions || otherTransactions || businesses ? 'available' : 'unavailable',
    asOf: transactions?.asOf ?? null,
    updatedAt: transactions?.updatedAt ?? null,
    // Every region keeps its own source, period and snapshot; primary data wins on collisions.
    byRegion: { ...(otherTransactions?.byRegion || {}), ...(transactions?.byRegion || {}) },
    commercialByRegion: transactions?.commercialByRegion ?? {},
    businessesByRegion: businesses?.businessesByRegion ?? {},
    sources: {
      transactions: transactions ? {status:transactions.status, source: transactions.source, asOf: transactions.asOf, updatedAt: transactions.updatedAt, notice: transactions.notice, months: transactions.months} : null,
      otherTransactions: otherTransactions ? {status:otherTransactions.status, source: otherTransactions.source, asOf: otherTransactions.asOf, updatedAt: otherTransactions.updatedAt, notice: otherTransactions.notice, months: otherTransactions.months, coverage: otherTransactions.coverage} : null,
      businesses: businesses ? {source: businesses.source, sourceUrl: businesses.sourceUrl, asOf: businesses.asOf, updatedAt: businesses.updatedAt, notice: businesses.notice} : null,
    },
  };
}
