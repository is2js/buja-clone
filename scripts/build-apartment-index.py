"""Convert Korean Real Estate Board public CSVs into regional apartment JSON.

Source files are downloaded separately; no geocoding or map geometry is inferred.
The source reports public-price DB matching can be incomplete. Its date is the
publication date, not necessarily the age of every underlying building record.
"""
import argparse
import csv
import json
import os
import re
import tempfile
from collections import Counter, defaultdict
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('input_dir', type=Path, help='Folder containing basic.csv and buildings.csv')
parser.add_argument('--as-of', required=True, help='Official file publication date YYYY-MM-DD')
parser.add_argument('--output-dir', type=Path, default=PROJECT / 'public/data/real/apartments')
args = parser.parse_args()
if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', args.as_of):
    parser.error('--as-of must have the form YYYY-MM-DD')

def source_csv(filename, required):
    f = (args.input_dir / filename).open('r', encoding='cp949', newline='')
    reader = csv.DictReader(f)
    if not reader.fieldnames or not set(required).issubset(reader.fieldnames):
        f.close()
        raise ValueError(f'{filename}: missing required columns')
    return f, reader

def integer(value):
    value = (value or '').strip().replace(',', '')
    return int(value) if value.isdecimal() and int(value) > 0 else None

source = {
    'label': '한국부동산원 공동주택 단지 식별정보',
    'asOf': args.as_of,
    'basicUrl': 'https://www.data.go.kr/data/15106861/fileData.do',
    'buildingUrl': 'https://www.data.go.kr/data/15106866/fileData.do',
    'license': '이용허락범위 제한 없음',
    'notice': '공시가격 DB 기반 공개 자료로, 기준시점 차이와 다른 DB 미연결로 일부 항목이 비어 있을 수 있습니다.',
}

regions = defaultdict(list)
by_id = {}
counts = Counter()
basic_file, basic_reader = source_csv('basic.csv', ['단지고유번호','필지고유번호','주소','단지명_공시가격','단지명_건축물대장','단지명_도로명주소','단지종류','동수','세대수','사용승인일','도로명주소'])
with basic_file:
    for row in basic_reader:
        if row['단지종류'].strip() != '1':
            continue
        identifier, pnu = row['단지고유번호'].strip(), row['필지고유번호'].strip()
        if not identifier or identifier in by_id:
            raise ValueError(f'Empty or duplicate apartment ID: {identifier}')
        # Current UI groups the former Gwangju and Jeonnam region into code 12.
        # Keep the PNU code as supplied; it is not proof of a current legal boundary.
        old_area = pnu[:2]
        area = '12' if old_area in ('29', '46') else old_area
        if not re.fullmatch(r'\d{19}', pnu) or not re.fullmatch(r'\d{2}', area):
            counts['invalidPnu'] += 1
            continue
        names = [(row[k] or '').strip() for k in ('단지명_공시가격','단지명_건축물대장','단지명_도로명주소')]
        item = {
            'id': identifier,
            'name': next((name for name in names if name), '단지명 없음'),
            'address': (row['주소'] or '').strip(),
            'roadAddress': (row['도로명주소'] or '').strip() or None,
            'kind': 'apartment', 'area': area,
            'sourceLegalCode': pnu[:10], 'sourceParcelCode': pnu,
            'households': integer(row['세대수']), 'dongCount': integer(row['동수']),
            'approvedOn': row['사용승인일'].strip() or None,
            'buildings': [], 'coordinate': None, 'geometry': None, 'demo': False,
        }
        regions[area].append(item)
        by_id[identifier] = item

building_file, building_reader = source_csv('buildings.csv', ['단지고유번호','동명_공시가격','동명_건축물대장','동명_도로명주소','지상층수'])
with building_file:
    for row in building_reader:
        apt = by_id.get(row['단지고유번호'].strip())
        if not apt:
            continue
        name = next(((row[k] or '').strip() for k in ('동명_건축물대장','동명_도로명주소','동명_공시가격') if (row[k] or '').strip()), None)
        floors = integer(row['지상층수'])
        if name or floors:
            apt['buildings'].append({'name': name, 'floors': floors})
            counts['buildingRows'] += 1

if len(by_id) < 1000 or len(regions) < 10:
    raise ValueError('Unexpectedly small input; existing JSON has been preserved')

args.output_dir.mkdir(parents=True, exist_ok=True)
def write_json(filename, payload):
    destination = args.output_dir / filename
    with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=args.output_dir, delete=False, suffix='.tmp') as f:
        temporary = Path(f.name)
        try:
            json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
            f.flush()
            os.fsync(f.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)

index = []
for area, items in sorted(regions.items()):
    write_json(f'{area}.json', {'source': source, 'area': area, 'items': items})
    index.extend({'id': x['id'], 'name': x['name'], 'address': x['address'], 'area': area} for x in items)
write_json('index.json', {'source': source, 'items': index})
print(json.dumps({'apartments': len(index), 'areas': {a: len(v) for a,v in sorted(regions.items())}, **counts}, ensure_ascii=False))
