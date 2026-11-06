"""Validate a user-supplied WFS/GeoJSON sample without publishing it.

No API call is made. Field names must be selected after inspecting the actual
licensed source. The output is a local candidate; the app does not load it.
"""
import argparse
import datetime
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANDIDATES = ROOT / 'work' / 'vworld-candidate'


def number(value, limit):
    if isinstance(value, bool) or value is None:
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) and 0 < n <= limit else None


def normalize_geometry(geometry):
    if not isinstance(geometry, dict):
        return None
    kind = geometry.get('type')
    if kind not in ('Polygon', 'MultiPolygon'):
        return None
    polys = [geometry.get('coordinates')] if kind == 'Polygon' else geometry.get('coordinates')
    if not isinstance(polys, list) or not polys:
        return None
    out = []
    for polygon in polys:
        if not isinstance(polygon, list) or not polygon:
            return None
        rings = []
        for ring in polygon:
            if not isinstance(ring, list) or len(ring) < 4:
                return None
            points = []
            for point in ring:
                if not isinstance(point, list) or len(point) < 2:
                    return None
                x, y = point[:2]
                if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (x, y)):
                    return None
                if not (124 <= x <= 132 and 32 <= y <= 39):
                    return None
                points.append([x, y])
            if points[0] != points[-1]:
                return None
            rings.append(points)
        out.append(rings)
    return {'type': kind, 'coordinates': out[0] if kind == 'Polygon' else out}


def normalize_collection(data, *, id_field, name_field, height_field, levels_field, as_of):
    if not isinstance(data, dict) or data.get('type') != 'FeatureCollection' or not isinstance(data.get('features'), list):
        raise ValueError('입력은 WGS84 GeoJSON FeatureCollection이어야 합니다.')
    if data.get('crs'):
        crs_name = str(data['crs'].get('properties', {}).get('name', '')).upper()
        if not (crs_name.endswith(':4326') or crs_name.endswith('/4326') or crs_name.endswith(':CRS84')):
            raise ValueError('입력의 좌표계가 WGS84가 아닙니다. 먼저 변환하세요.')
    if datetime.date.fromisoformat(as_of).isoformat() != as_of:
        raise ValueError('기준일은 YYYY-MM-DD 형식이어야 합니다.')
    features, ids = [], set()
    stats = {'input': len(data['features']), 'included': 0, 'invalidGeometry': 0, 'missingHeight': 0}
    for feature in data['features']:
        if not isinstance(feature, dict) or feature.get('type') != 'Feature':
            stats['invalidGeometry'] += 1
            continue
        geometry = normalize_geometry(feature.get('geometry'))
        if geometry is None:
            stats['invalidGeometry'] += 1
            continue
        props = feature.get('properties') or {}
        if not isinstance(props, dict):
            raise ValueError('속성이 객체가 아닙니다.')
        raw_id = props.get(id_field) if id_field else feature.get('id')
        if raw_id is None or str(raw_id).strip() == '':
            raise ValueError('유효한 원천 ID가 없습니다. ID 필드 매핑을 확인하세요.')
        source_id = str(raw_id).strip()
        if source_id in ids:
            raise ValueError('원천 ID가 중복됩니다. 병합하지 않고 중단합니다.')
        ids.add(source_id)
        height = number(props.get(height_field), 650) if height_field else None
        levels = number(props.get(levels_field), 200) if levels_field else None
        if height is not None:
            height_source = 'height'
        elif levels is not None:
            height, height_source = levels * 3, 'levels'
        else:
            stats['missingHeight'] += 1
            continue
        name = props.get(name_field) if name_field else None
        if name is not None and not isinstance(name, str):
            name = str(name)
        # Never copy unknown source fields, request URLs or keys.
        features.append({'type': 'Feature', 'geometry': geometry,
                         'properties': {'sourceId': source_id, 'name': name or '',
                                        'height': height, 'levels': levels,
                                        'heightSource': height_source}})
        stats['included'] += 1
    if not features:
        raise ValueError('유효한 건물이 없습니다. 좌표계와 높이·층수 필드를 확인하세요.')
    return {'type': 'FeatureCollection', 'features': features,
            'metadata': {'source': 'VWorld user-supplied candidate; verification pending',
                         'asOf': as_of, 'crs': 'WGS84 / longitude, latitude',
                         'license': '확인 필요', 'automaticallyPublished': False,
                         'statistics': stats}}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('input', type=Path, help='사용자가 확보한 GeoJSON 파일')
    p.add_argument('--output', required=True, help='work/vworld-candidate 안에 생성할 새 .geojson 파일명')
    p.add_argument('--as-of', required=True, help='자료 기준일 YYYY-MM-DD')
    p.add_argument('--confirm-wgs84', action='store_true', required=True, help='입력 좌표가 WGS84 경도·위도인지 직접 확인')
    p.add_argument('--id-field', help='원천 ID 속성명; 미지정 시 GeoJSON feature.id 사용')
    p.add_argument('--name-field', help='건물명 속성명')
    p.add_argument('--height-field', help='높이(m) 속성명')
    p.add_argument('--levels-field', help='지상 층수 속성명; 높이 누락 시 3m 곱함')
    args = p.parse_args()
    if not (args.height_field or args.levels_field):
        p.error('실제 높이 또는 층수 필드를 지정해야 합니다.')
    if Path(args.output).name != args.output or not args.output.endswith('.geojson'):
        p.error('출력은 확장자가 .geojson인 파일명만 지정하세요.')
    try:
        data = json.loads(args.input.read_text(encoding='utf-8-sig'))
        result = normalize_collection(data, id_field=args.id_field, name_field=args.name_field,
                                      height_field=args.height_field, levels_field=args.levels_field,
                                      as_of=args.as_of)
        CANDIDATES.mkdir(parents=True, exist_ok=True)
        with (CANDIDATES / args.output).open('x', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, separators=(',', ':'))
        print(json.dumps(result['metadata']['statistics'], ensure_ascii=False))
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
        p.error(str(error))


if __name__ == '__main__':
    main()
