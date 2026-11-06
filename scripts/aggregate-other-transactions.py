import argparse, calendar, collections, csv, json, math, os, pathlib, re, statistics, sys, tempfile
from datetime import datetime, timezone, timedelta
from transaction_quality import month_error, district_drop_errors, sha256_file

PROJECT = pathlib.Path(__file__).resolve().parent.parent
PROJ = PROJECT / 'public' / 'data'
DEFAULT_OUT = PROJ / 'real' / 'transactions-other.json'
REGIONS = {'12000':'전남광주통합특별시', '26000':'부산광역시', '27000':'대구광역시', '28000':'인천광역시', '30000':'대전광역시', '31000':'울산광역시', '36000':'세종특별자치시', '43000':'충청북도', '44000':'충청남도', '47000':'경상북도', '48000':'경상남도', '50000':'제주특별자치도', '51000':'강원특별자치도', '52000':'전북특별자치도'}
parser = argparse.ArgumentParser(description='서울·경기 외 시도별 공식 아파트 매매·전월세 CSV를 정적 집계로 변환합니다.')
parser.add_argument('input_dir', nargs='?', type=pathlib.Path, default=PROJECT / 'work' / 'real-input')
parser.add_argument('--as-of', help='수집 기준 마지막 계약월 YYYY-MM. 생략 시 기존 결과의 기준월을 재사용하며 이후 월 데이터가 있으면 중단합니다.')
parser.add_argument('--output', type=pathlib.Path, default=DEFAULT_OUT, help='출력 JSON 경로')
args = parser.parse_args()
ROOT, OUTPUT = args.input_dir.resolve(), args.output.resolve()
if args.as_of:
 as_of = args.as_of
else:
 try:
  as_of = json.loads(OUTPUT.read_text(encoding='utf-8')).get('asOf', '')
 except (OSError, ValueError):
  parser.error('기존 결과에서 기준월을 읽을 수 없습니다. --as-of YYYY-MM을 지정하세요.')
match = re.fullmatch(r'(\d{4})-(0[1-9]|1[0-2])', str(as_of))
if not match:
 parser.error('기준월은 YYYY-MM 형식이어야 합니다.')
year, month = map(int, match.groups())
end_month = year * 12 + month - 1
months = [f'{(end_month - i) // 12:04d}{(end_month - i) % 12 + 1:02d}' for i in range(11, -1, -1)]
period = f'{months[-3][:4]}-{months[-3][4:]}~{as_of}'
updated_at = datetime.now(timezone(timedelta(hours=9))).date().isoformat()
files = []
for prefix in REGIONS:
 for kind in ('apt-sale','apt-rent'):
  candidates = [ROOT / f'{prefix}-{kind}{suffix}' for suffix in ('.tmp', '.csv') if (ROOT / f'{prefix}-{kind}{suffix}').is_file()]
  if len(candidates) != 1:
   parser.error(f'{prefix}-{kind}.tmp 또는 .csv 파일이 정확히 하나 필요합니다. 발견: {len(candidates)}개')
  files.append((candidates[0], kind))
try:
 with (PROJ / 'legal.json').open(encoding='utf-8') as f: legal=json.load(f)['regions']
except (OSError, ValueError, KeyError) as exc:
 parser.error(f'법정동 기준 자료를 읽을 수 없습니다: {exc}')
def norm(s): return re.sub(r'\s+',' ',s.strip())
byname=collections.defaultdict(list);gu=collections.defaultdict(set)
for x in legal:
 if x.get('area') in {prefix[:2] for prefix in REGIONS}:
  byname[norm(x['full'])].append((x['code'], x['guCode']));gu[norm(x['full'].rsplit(' ',1)[0])].add(x['guCode'])
rows={}; stats={}
def keys(address):
 a=norm(address); codes=byname.get(a,[])
 # The legally nested 리 is aggregated to its exact 읍/면 parent; never fuzzy-match names.
 if not codes and a.endswith('리'):
  parent=a.rsplit(' ',1)[0]
  if parent.endswith(('읍','면')): codes=byname.get(parent,[])
 result=[]
 if len(codes)==1:
  result.append('legal:'+codes[0][0]); result.append('gu:'+codes[0][1])
 else:
  gc=gu.get(a.rsplit(' ',1)[0],set())
  if len(gc)==1: result.append('gu:'+next(iter(gc)))
 return result
def number(s):
 try:
  value = float(s.replace(',','').strip())
  return value if math.isfinite(value) else None
 except (ValueError, TypeError, AttributeError):return None
for path, kind in files:
 counts=collections.Counter(); seen_months=set(); month_stats=collections.defaultdict(collections.Counter)
 expected_region = REGIONS[path.name.split('-')[0]]
 with path.open('r',encoding='cp949',newline='') as f:
  reader=csv.reader(f)
  hdr = None
  for candidate in reader:
   if candidate and candidate[0].strip().lstrip('\ufeff') == 'NO':
    hdr = candidate; break
  required = {'시군구','계약년월', '전용면적(㎡)' if kind != 'commercial-sale' else '전용/연면적(㎡)', '보증금(만원)' if kind == 'apt-rent' else '거래금액(만원)'}
  if kind == 'apt-rent': required |= {'전월세구분','월세금(만원)'}
  if not hdr or not required.issubset(set(hdr)):
   parser.error(f'{path.name}: 공식 CSV 헤더를 찾을 수 없거나 필수 열이 없습니다: {sorted(required - set(hdr or []))}')
  dr=csv.DictReader(f,fieldnames=hdr)
  for row in dr:
   counts['total']+=1
   month=(row.get('계약년월') or '').strip();
   if month not in months:
    counts['outside']+=1
    if not args.as_of and re.fullmatch(r'\d{6}', month) and month > months[-1]: counts['newer_than_baseline']+=1
    continue
   seen_months.add(month)
   if not norm(row.get('시군구','')).startswith(expected_region + ' '): counts['wrong_region']+=1; continue
   if (row.get('해제사유발생일') or '').strip() not in ('','-'): counts['canceled']+=1;continue
   targets=keys(row.get('시군구','')); 
   if not targets: counts['unmatched']+=1; month_stats[month]['unmatched']+=1; continue
   if not any(x.startswith('legal:') for x in targets): counts['unmatched_legal']+=1; month_stats[month]['unmatchedLegal']+=1
   area=number(row.get('전용면적(㎡)',row.get('전용/연면적(㎡)','')))
   amount=number(row.get('보증금(만원)' if kind=='apt-rent' else '거래금액(만원)',''))
   bucket=kind
   if kind=='apt-rent' and row.get('전월세구분')!='전세':
    bucket='apt-monthly-rent'; amount=number(row.get('월세금(만원)',''))
    value=amount if amount is not None and amount>=0 else None
   else: value=(amount*3.3058/area if area and area>0 and amount and amount>0 else None)
   for key in targets:
    store=rows.setdefault(key,{}).setdefault(bucket,collections.defaultdict(list));store[month].append(value)
   counts['accepted']+=1; month_stats[month]['accepted']+=1
   if value is not None: month_stats[month]['validValue']+=1
 stats[path.name]={**dict(counts), 'monthsSeen':sorted(seen_months), 'byMonth':{m:dict(month_stats[m]) for m in months}, 'inputSha256':sha256_file(path)}
 if counts['wrong_region']:
  parser.error(f"{path.name}: {expected_region} 외 지역이 {counts['wrong_region']}건 있어 기존 결과를 보존합니다.")
 missing = sorted(set(months) - seen_months)
 if missing:
  parser.error(f'{path.name}: 기준 12개월 중 누락된 계약월이 있습니다: {missing}. 기존 결과를 보존합니다.')
 problem = month_error(months, month_stats)
 if problem:
  parser.error(f'{path.name}: {problem}. 기존 결과를 보존합니다.')
 if not counts['accepted']:
  parser.error(f'{path.name}: 기준 기간에 연결된 거래가 없어 기존 결과를 보존합니다. 기준월·주소·자료를 확인하세요.')
 if counts['newer_than_baseline']:
  parser.error(f'{path.name}: 기존 기준월 {as_of}보다 최신 거래가 있습니다. --as-of YYYY-MM을 명시하세요.')
def med(v):
 v=[x for x in v if x is not None]
 return round(statistics.median(v)) if v else None
def periods(m, selected):return [v for k in selected for v in m.get(k,[]) if v is not None]
def pct_samples(current, previous):
 return round((statistics.median(current)/statistics.median(previous)-1)*100,1) if len(current)>=30 and len(previous)>=30 and statistics.median(previous)>0 else None
def report(dat):
 sale=dat.get('apt-sale',{});rent=dat.get('apt-rent',{});monthly=dat.get('apt-monthly-rent',{});comm=dat.get('commercial-sale',{})
 def summ(m):
  x=periods(m,months[-3:]); prev3=periods(m,months[-6:-3]); last=periods(m,months[-1:]); prev=periods(m,months[-2:-1]); v=periods(m,months[-6:]); prv6=periods(m,months[:6]);
  return {'price':med(x),'transactions':sum(len(m.get(k,[])) for k in months[-3:]),'sampleCount':len(x),
    'change1':pct_samples(last,prev),'change3':pct_samples(x,prev3), 'change6':pct_samples(v,prv6),
    'change1Samples':{'current':len(last),'previous':len(prev)}, 'change3Samples':{'current':len(x),'previous':len(prev3)}, 'change6Samples':{'current':len(v),'previous':len(prv6)},
    'yoy':None,'peak':None,'series':[med(m.get(k,[])) for k in months],
    'monthlyCounts':[len([v for v in m.get(k,[]) if v is not None]) for k in months]}
 s=summ(sale);rv=periods(rent,months[-6:]);sale6=periods(sale,months[-6:]);m6=med(sale6);r6=med(rv)
 s.update({'jeonse':round(100*r6/m6,1) if m6 and r6 and len(rv)>=30 and len(sale6)>=30 else None,'rentSampleCount':len(rv), 'jeonseSaleSampleCount':len(sale6), 'monthlyRentMedian':med(periods(monthly,months[-3:])), 'monthlyRentSampleCount':len(periods(monthly,months[-3:])),
  'rentMedian':r6,'asOf':as_of,'source':'국토교통부 실거래가 공개시스템','priceUnit':'만원/3.3㎡','scope':'아파트 매매','period':period,'method':'전용면적 3.3㎡당 거래금액 중앙값, 해제 거래 제외','seriesUnit':'만원/3.3㎡'})
 c=summ(comm);c.update({'asOf':as_of,'source':'국토교통부 실거래가 공개시스템','priceUnit':'만원/3.3㎡','scope':'상업·업무용 매매','period':period,'method':'전용/연면적 3.3㎡당 거래금액 중앙값, 해제 거래 제외. 상가 외 업무용 포함.'})
 return s,c
apt,comm={},{}
for key,dat in rows.items():
 a,c=report(dat)
 if 'apt-sale' in dat or 'apt-rent' in dat or 'apt-monthly-rent' in dat:apt[key]=a
 if 'commercial-sale' in dat:comm[key]=c
try:
 previous = json.loads(OUTPUT.read_text(encoding='utf-8'))
except (OSError, ValueError):
 previous = None
drops = district_drop_errors(previous, apt, months)
if drops:
 parser.error('기존 동일 계약월 대비 시군구 유효 거래가 90% 이상 감소했습니다: ' + ', '.join(drops[:5]) + '. 기존 결과를 보존합니다.')
out={'status':'available','asOf':as_of,'updatedAt':updated_at,'source':'국토교통부 실거래가 공개시스템','months':months,'byRegion':apt,'commercialByRegion':comm,'businessesByRegion':{},'coverage':list(REGIONS.values()),'diagnostics':stats,'notice':'계약일 기준 자료. 해제·정정 및 신고 지연으로 변경될 수 있으며 참고용입니다. 외부 공개 통계는 제공기관 안내에 따라 신고일 기준 공식통계를 이용하세요.'}
if not apt:
 parser.error('아파트 결과가 비어 있어 기존 결과를 보존합니다.')
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
raw = json.dumps(out,ensure_ascii=False,separators=(',',':'))
with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=OUTPUT.parent, delete=False, suffix='.tmp') as f:
 temporary = pathlib.Path(f.name)
 try:
  f.write(raw); f.flush(); os.fsync(f.fileno())
 except BaseException:
  temporary.unlink(missing_ok=True); raise
try:
 os.replace(temporary, OUTPUT)
finally:
 temporary.unlink(missing_ok=True)
print('asOf',as_of,'months',months[0],months[-1], 'regions',len(apt),len(comm),'bytes',OUTPUT.stat().st_size,flush=True)
print('diagnostics',json.dumps(stats,ensure_ascii=False),flush=True)

