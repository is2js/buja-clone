import argparse, collections, csv, io, json, os, pathlib, re, sys, tempfile, zipfile
from datetime import datetime, timedelta, timezone

PROJECT = pathlib.Path(__file__).resolve().parent.parent
DATA = PROJECT / 'public' / 'data'
DEFAULT_OUT = DATA / 'real' / 'businesses.json'
parser = argparse.ArgumentParser(description='공식 상가·상권 ZIP을 서울·경기 지역별로 집계합니다.')
parser.add_argument('zip_path', nargs='?', type=pathlib.Path, default=PROJECT / 'work' / 'real-input' / 'shops.zip')
parser.add_argument('--as-of', help='원본 데이터 기준일 YYYY-MM-DD. 미지정 시 ZIP 파일명에 적힌 날짜가 기존 결과 기준일과 같을 때만 사용합니다.')
parser.add_argument('--output', type=pathlib.Path, default=DEFAULT_OUT)
args = parser.parse_args()
zip_path, output = args.zip_path.resolve(), args.output.resolve()
if not zip_path.is_file(): parser.error(f'ZIP 파일이 없습니다: {zip_path}')
as_of = args.as_of
if not as_of:
 try: previous = json.loads(output.read_text(encoding='utf8'))['asOf']
 except (OSError, ValueError, KeyError): parser.error('기준일을 확인할 수 없습니다. --as-of YYYY-MM-DD를 지정하세요.')
 # Reusing previous metadata is safe only if the source filename itself bears the exact same day.
 compact = previous.replace('-', '')
 if compact not in zip_path.name and previous not in zip_path.name:
  parser.error('ZIP 파일명에 기존 기준일이 없어 날짜를 추정할 수 없습니다. --as-of YYYY-MM-DD를 지정하세요.')
 as_of = previous
try:
 if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', as_of): raise ValueError()
 datetime.strptime(as_of, '%Y-%m-%d')
except (TypeError, ValueError): parser.error('기준일은 실제 날짜 YYYY-MM-DD 형식이어야 합니다.')
updated_at = datetime.now(timezone(timedelta(hours=9))).date().isoformat()
try:
 geo = json.loads((DATA / 'geo.json').read_text(encoding='utf8'))
 legal_items = json.loads((DATA / 'legal.json').read_text(encoding='utf8'))['regions']
 legal = {x['code'] for x in legal_items}
 eupmyeon = {x['code'] for x in legal_items if x['name'].endswith(('읍', '면'))}
except (OSError, ValueError, KeyError) as exc: parser.error(f'지역 경계·코드 자료를 읽을 수 없습니다: {exc}')
out = {}; stats = {}
try:
 with zipfile.ZipFile(zip_path) as z:
  for location, prefix in (('서울','11'), ('경기','41')):
   names = [n for n in z.namelist() if f'_{location}_' in n and n.lower().endswith('.csv')]
   if len(names) != 1: parser.error(f'{location}: ZIP 안의 지역 CSV가 정확히 하나여야 합니다. 발견: {len(names)}개')
   counts = collections.Counter()
   with z.open(names[0]) as raw:
    reader = csv.DictReader(io.TextIOWrapper(raw, encoding='utf-8-sig', newline=''))
    required = {'시군구코드', '행정동코드', '법정동코드', '상권업종대분류명'}
    if not reader.fieldnames or not required.issubset(reader.fieldnames):
     parser.error(f'{location}: CSV 필수 열이 없습니다: {sorted(required - set(reader.fieldnames or []))}')
    for row in reader:
     counts['total'] += 1
     gu = (row.get('시군구코드') or '').strip()
     admin = (row.get('행정동코드') or '').strip()
     legal_code = (row.get('법정동코드') or '').strip()
     if not re.fullmatch(prefix + r'\d{3}', gu):
      counts['invalid_gu'] += 1; continue
     codes = ['gu:' + gu]
     counts['gu'] += 1
     admin = admin + '00' if re.fullmatch(r'\d{8}', admin) else admin
     if admin in geo.get('dong', {}) and admin[:5] == gu:
      codes.append('dong:' + admin); counts['admin_exact'] += 1
     else: counts['admin_unmatched'] += 1
     if legal_code in legal and legal_code[:5] == gu:
      codes.append('legal:' + legal_code); counts['legal_exact'] += 1
     elif re.fullmatch(r'\d{10}', legal_code) and legal_code[:5] == gu and legal_code[-2:] != '00' and legal_code[:8] + '00' in eupmyeon:
      codes.append('legal:' + legal_code[:8] + '00'); counts['legal_ri_parent'] += 1
     else: counts['legal_unmatched'] += 1
     for code in codes:
      record = out.setdefault(code, {'count': 0, 'categories': {}}); record['count'] += 1
      category = (row.get('상권업종대분류명') or '').strip() or '기타'
      record['categories'][category] = record['categories'].get(category, 0) + 1
   if not counts['total'] or not counts['gu']:
    parser.error(f'{location}: 유효한 업소가 없어 기존 결과를 보존합니다.')
   stats[location] = dict(counts)
   print(location, json.dumps(stats[location], ensure_ascii=False), flush=True)
except (OSError, zipfile.BadZipFile, UnicodeError, csv.Error) as exc:
 parser.error(f'ZIP/CSV 처리 실패: {exc}')
if not out: parser.error('결과가 비어 있어 기존 결과를 보존합니다.')
obj = {'status':'available', 'asOf':as_of, 'updatedAt':updated_at, 'source':'소상공인시장진흥공단 상가(상권)정보', 'sourceUrl':'https://www.data.go.kr/data/15083033/fileData.do', 'businessesByRegion':out, 'diagnostics':stats, 'notice':'업소와 업종 현황으로 상업용 부동산 거래나 임대료 통계가 아닙니다.'}
output.parent.mkdir(parents=True, exist_ok=True)
with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=output.parent, delete=False, suffix='.tmp') as f:
 temporary = pathlib.Path(f.name)
 try:
  json.dump(obj, f, ensure_ascii=False, separators=(',',':')); f.flush(); os.fsync(f.fileno())
 except BaseException:
  temporary.unlink(missing_ok=True); raise
try: os.replace(temporary, output)
finally: temporary.unlink(missing_ok=True)
print('asOf',as_of,'regions',len(out),'bytes',output.stat().st_size,flush=True)
