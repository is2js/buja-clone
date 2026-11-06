"""Build a local Seoul/Hanam walking graph from a public Geofabrik PBF.

Requires ``pip install osmium`` in a build-only Python environment. Only mapped
OSM node connections become graph junctions; no geometric crossings are invented.
This is a research estimate, not a guarantee that a route is currently walkable.
"""
import argparse, json, os, pathlib, tempfile
import osmium

PROJECT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser()
p.add_argument('pbf',type=pathlib.Path)
p.add_argument('--as-of',required=True,help='source extract date, YYYY-MM-DD')
p.add_argument('--output',type=pathlib.Path,default=PROJECT/'public/data/walking/seoul-hanam.json')
args=p.parse_args()
# Coverage is this bounding box, not a claim of complete administrative coverage.
WEST,SOUTH,EAST,NORTH=126.75,37.40,127.32,37.75
excluded_highways={'motorway','motorway_link','trunk','trunk_link','construction','proposed','abandoned','raceway','razed','demolished','platform','bus_guideway','escape'}
restricted={'no','private','customers','delivery','agricultural','forestry','use_sidepath'}
foot_allowed={'yes','designated','permissive','official'}
class WalkHandler(osmium.SimpleHandler):
 def __init__(self):
  super().__init__();self.ids={};self.nodes=[];self.edges=[];self.seen=set();self.counters={'ways':0,'segments':0,'restricted':0}
 def way(self,w):
  tags=dict(w.tags); highway=tags.get('highway','')
  if not highway or highway in excluded_highways or tags.get('area')=='yes':return
  foot=tags.get('foot','').lower();access=tags.get('access','').lower()
  if foot in restricted or (access in restricted and foot not in foot_allowed):self.counters['restricted']+=1;return
  if tags.get('foot:conditional') or tags.get('access:conditional'):self.counters['restricted']+=1;return
  direction=tags.get('oneway:foot','').lower(); direction=1 if direction in ('yes','1','true') else -1 if direction=='-1' else 0
  self.counters['ways']+=1
  refs=list(w.nodes)
  for a,b in zip(refs,refs[1:]):
   if not a.location.valid() or not b.location.valid():continue
   try: ax,ay,bx,by=a.lon,a.lat,b.lon,b.lat
   except (ValueError,RuntimeError):continue
   if not ((WEST<=ax<=EAST and SOUTH<=ay<=NORTH) or (WEST<=bx<=EAST and SOUTH<=by<=NORTH)):continue
   if a.ref==b.ref:continue
   def idx(node,x,y):
    if node.ref not in self.ids:self.ids[node.ref]=len(self.nodes);self.nodes.append([round(x,7),round(y,7)])
    return self.ids[node.ref]
   i,j=idx(a,ax,ay),idx(b,bx,by);key=(i,j,direction)
   if key in self.seen:continue
   self.seen.add(key);self.edges.append([i,j,direction]);self.counters['segments']+=1
if not args.pbf.is_file():p.error('원본 PBF 파일이 없습니다.')
h=WalkHandler();h.apply_file(str(args.pbf),locations=True,idx='flex_mem')
if len(h.nodes)<10000 or len(h.edges)<10000:p.error('예상보다 보행망이 작아 기존 결과를 보존합니다.')
result={'format':'walking-graph-v1','source':{'label':'OpenStreetMap 보행 가능 도로 (Geofabrik 대한민국 추출)','url':'https://download.geofabrik.de/asia/south-korea.html','license':'ODbL-1.0','licenseUrl':'https://www.openstreetmap.org/copyright','asOf':args.as_of,'coverage':'서울·하남 포함 경계 상자, 126.75~127.32E / 37.40~37.75N','notice':'OSM 입력 정보이며 실제 출입구·계단·통행 가능 여부를 보증하지 않습니다.'},'bounds':[WEST,SOUTH,EAST,NORTH],'nodes':h.nodes,'edges':h.edges,'statistics':h.counters}
args.output.parent.mkdir(parents=True,exist_ok=True)
with tempfile.NamedTemporaryFile('w',encoding='utf-8',dir=args.output.parent,delete=False,suffix='.tmp') as f:
 name=f.name
 try:json.dump(result,f,ensure_ascii=False,separators=(',',':'));f.flush();os.fsync(f.fileno())
 except BaseException:pathlib.Path(name).unlink(missing_ok=True);raise
try:os.replace(name,args.output)
finally:pathlib.Path(name).unlink(missing_ok=True)
print(json.dumps({'nodes':len(h.nodes),'edges':len(h.edges),'bytes':args.output.stat().st_size,'sourceDate':args.as_of,**h.counters},ensure_ascii=False))
