"""Validation gates for a candidate snapshot before replacing the previous one."""
import hashlib


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def month_error(months, month_stats):
    for month in months:
        c = month_stats.get(month, {})
        accepted, unmatched = c.get('accepted', 0), c.get('unmatched', 0)
        candidates = accepted + unmatched
        if not accepted or not c.get('validValue', 0):
            return f'{month}: 매칭된 유효 거래가 없습니다'
        # A partially mapped district-only row is not a valid legal-dong match.
        legal_missing = unmatched + c.get('unmatchedLegal', 0)
        if candidates >= 20 and legal_missing / candidates > .10:
            return f'{month}: 법정동 미연계 {legal_missing}/{candidates}건이 10%를 넘습니다'
        if candidates >= 20 and c.get('validValue', 0) / candidates < .5:
            return f'{month}: 유효 금액·면적 거래가 절반 미만입니다'
    return None


def district_drop_errors(previous, candidate, months):
    """Compare overlapping actual calendar months, not different rolling windows."""
    if not isinstance(previous, dict) or not isinstance(previous.get('months'), list):
        return []
    old_months = previous['months']
    common = set(old_months).intersection(months)
    failures = []
    for key, old in (previous.get('byRegion') or {}).items():
        if not key.startswith('gu:') or not isinstance(old, dict):
            continue
        old_counts = old.get('monthlyCounts') or []
        current_counts = (candidate.get(key) or {}).get('monthlyCounts')
        if current_counts is None:
            current_counts = [0] * len(months)
        if len(old_counts) != len(old_months) or len(current_counts) != len(months):
            continue
        for month in common:
            before, after = old_counts[old_months.index(month)], current_counts[months.index(month)]
            if isinstance(before, (int, float)) and isinstance(after, (int, float)) and before >= 30 and after < before * .1:
                failures.append(f'{key} {month}: {before} → {after}건')
    return sorted(failures)
