"""Create static OSM building footprint tiles with recorded heights or levels.

Build-only dependency: pyosmium. Only OSM building outlines with a defensible
height are included; the source's coverage, age and accuracy vary. "height"
is an OSM tag, not necessarily a survey. Generated files are ODbL-derived.
"""
import argparse
import json
import math
import os
import pathlib
import re
import shutil
import tempfile
from collections import Counter, defaultdict
import osmium
from building_publish import publish_buildings

PROJECT = pathlib.Path(__file__).resolve().parents[1]
# Keep the existing Seoul tile origin stable so existing tile IDs remain valid.
ORIGIN_WEST, ORIGIN_SOUTH = 126.75, 37.40
WEST, SOUTH, EAST, NORTH = 124.0, 32.0, 132.0, 39.0
TILE = 0.02
POSITIVE_METRES = re.compile(r'^\s*(\d+(?:\.\d+)?)\s*(?:m|metres?|meters?)?\s*$', re.I)
POSITIVE_LEVELS = re.compile(r'^\s*(\d+(?:\.\d+)?)\s*$')
SKIP = {'no', 'construction', 'proposed', 'demolished', 'ruins', 'roof'}


def metres(value):
    match = POSITIVE_METRES.fullmatch(value or '')
    if not match:
        return None
    n = float(match.group(1))
    return n if 1 <= n <= 650 else None


def levels_value(value):
    match = POSITIVE_LEVELS.fullmatch(value or '')
    if not match:
        return None
    n = float(match.group(1))
    return n if 1 <= n <= 200 else None


def ring_coords(ring):
    coords = []
    for node in ring:
        if not node.location.valid():
            return []
        point = [round(node.lon, 7), round(node.lat, 7)]
        if not coords or coords[-1] != point:
            coords.append(point)
    if len(coords) < 3:
        return []
    if coords[0] != coords[-1]:
        coords.append(coords[0])
    return coords if len(coords) >= 4 else []


class Handler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.tiles = defaultdict(list)
        self.stats = Counter()
        self.seen = set()

    def area(self, area):
        tags = dict(area.tags)
        kind = tags.get('building', '').strip().lower()
        if not kind or kind in SKIP or tags.get('building:part') not in (None, '', 'no'):
            return
        self.stats['nationwideInputBuildingAreas'] += 1
        levels = levels_value(tags.get('building:levels'))
        height = metres(tags.get('height'))
        if height is not None:
            height_source = 'height'
        elif levels is not None:
            height, height_source = round(levels * 3, 1), 'levels'
        else:
            self.stats['nationwideOmittedHeight'] += 1
            return
        polygons = []
        for outer in area.outer_rings():
            shell = ring_coords(outer)
            if not shell:
                continue
            holes = [ring_coords(hole) for hole in area.inner_rings(outer)]
            polygons.append([shell] + [h for h in holes if h])
        if not polygons:
            self.stats['nationwideOmittedGeometry'] += 1
            return
        points = [p for poly in polygons for p in poly[0]]
        x0, x1 = min(p[0] for p in points), max(p[0] for p in points)
        y0, y1 = min(p[1] for p in points), max(p[1] for p in points)
        cx, cy = (x0+x1)/2, (y0+y1)/2
        if not (WEST <= cx < EAST and SOUTH <= cy < NORTH):
            return
        if x1-x0 > TILE or y1-y0 > TILE:
            self.stats['omittedOversized'] += 1
            return
        # Parent ways and multipolygon relations can describe the same outline.
        # Compare rings independent of their starting point and direction.
        def canonical(ring):
            pts = [tuple(p) for p in ring[:-1]]
            i = min(range(len(pts)), key=pts.__getitem__)
            forward = pts[i:] + pts[:i]
            reverse = list(reversed(pts)); j = min(range(len(reverse)), key=reverse.__getitem__)
            reverse = reverse[j:] + reverse[:j]
            return tuple(min(forward, reverse))
        signature = tuple(sorted(canonical(poly[0]) for poly in polygons))
        if signature in self.seen:
            self.stats['omittedDuplicate'] += 1
            return
        self.seen.add(signature)
        ix, iy = math.floor((cx-ORIGIN_WEST)/TILE), math.floor((cy-ORIGIN_SOUTH)/TILE)
        osm_type = 'way' if area.from_way() else 'relation'
        prop = {'id': f'{osm_type}/{area.orig_id()}', 'name': tags.get('name', ''), 'kind': kind,
                'height': height, 'heightSource': height_source, 'levels': levels, 'source': 'OpenStreetMap'}
        base = metres(tags.get('min_height'))
        if base is not None and base < height:
            prop['minHeight'] = base
        geo = {'type': 'Polygon', 'coordinates': polygons[0]} if len(polygons)==1 else {'type': 'MultiPolygon', 'coordinates': polygons}
        self.tiles[(ix,iy)].append({'type':'Feature', 'geometry':geo, 'properties':prop})
        self.stats['included'] += 1
        self.stats['heightTagged' if height_source == 'height' else 'heightFromLevels'] += 1
        if osm_type == 'relation':
            self.stats['relations'] += 1


def main():
    p = argparse.ArgumentParser()
    p.add_argument('pbf', type=pathlib.Path)
    p.add_argument('--as-of', required=True, help='PBF source extract date YYYY-MM-DD')
    p.add_argument('--output', type=pathlib.Path, default=PROJECT/'public/data/buildings')
    args = p.parse_args()
    if not args.pbf.is_file():
        p.error('원본 PBF 파일이 없습니다.')
    if not re.fullmatch(r'\d{4}-\d\d-\d\d', args.as_of):
        p.error('기준일은 YYYY-MM-DD 형식이어야 합니다.')
    h=Handler()
    h.apply_file(str(args.pbf), locations=True, idx='flex_mem')
    if h.stats['included'] < 50:
        p.error('예상보다 적은 건물이 추출되어 기존 결과를 보존합니다.')
    args.output.mkdir(parents=True,exist_ok=True)
    stage = pathlib.Path(tempfile.mkdtemp(prefix='buildings-', dir=args.output))
    try:
        tile_dir=stage/'tiles'
        tile_dir.mkdir()
        entries=[]
        for (ix,iy), features in sorted(h.tiles.items()):
            name=f'{ix}_{iy}'
            tile_file=tile_dir/f'{name}.json'
            tile_file.write_text(json.dumps({'type':'FeatureCollection','features':features},ensure_ascii=False,separators=(',',':')), encoding='utf-8')
            entries.append({'id':name,'tileSet':stage.name,'bounds':[round(ORIGIN_WEST+ix*TILE,5), round(ORIGIN_SOUTH+iy*TILE,5),round(ORIGIN_WEST+(ix+1)*TILE,5),round(ORIGIN_SOUTH+(iy+1)*TILE,5)], 'count':len(features)})
        manifest={'format':'osm-building-tiles-v2','source':{'label':'OpenStreetMap 건물 외곽·높이 (Geofabrik 대한민국 추출)','url':'https://download.geofabrik.de/asia/south-korea.html','license':'ODbL-1.0','licenseUrl':'https://www.openstreetmap.org/copyright','asOf':args.as_of,'notice':'OSM 기여자가 입력한 도형과 높이로 정확도·최신성·완전성을 보장하지 않습니다. 층수×3m는 추정치입니다.'},'bounds':[WEST,SOUTH,EAST,NORTH],'tileSize':TILE,'tiles':entries,'statistics':dict(h.stats)}
        (stage/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        target = publish_buildings(stage, args.output)
        print(json.dumps({'tiles':len(entries), 'bytes':sum(p.stat().st_size for p in (target/'tiles').glob('*.json')), **h.stats},ensure_ascii=False))
    finally:
        shutil.rmtree(stage,ignore_errors=True)

if __name__ == '__main__':
    main()
