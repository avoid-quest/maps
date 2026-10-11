#!/usr/bin/env python3
"""Prepare compact official GTT lookup and Overture place package; run with --help."""
import argparse,csv,hashlib,io,json,pathlib,zipfile,collections,datetime
p=argparse.ArgumentParser();p.add_argument('--gtfs',required=True);p.add_argument('--places',required=True);p.add_argument('--output',default='src/data');a=p.parse_args()
out=pathlib.Path(a.output);out.mkdir(parents=True,exist_ok=True)
def write(name,data):
 (out/name).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
z=zipfile.ZipFile(a.gtfs)
def rows(name):return csv.DictReader(io.TextIOWrapper(z.open(name),encoding='utf-8-sig'))
routes={r['route_id']:r['route_short_name'] for r in rows('routes.txt')}
trips={r['trip_id']:[routes.get(r['route_id'],r['route_id']),r['trip_headsign'],r['route_id']] for r in rows('trips.txt')}
# Intern identical stop sequences; no timetable is claimed by this realtime-only index.
trip_stops=collections.defaultdict(list);stop_lines=collections.defaultdict(set)
for r in rows('stop_times.txt'):
 trip_stops[r['trip_id']].append((int(r['stop_sequence']),r['stop_id']))
 if r['trip_id'] in trips:stop_lines[r['stop_id']].add(trips[r['trip_id']][0])
patterns=[];intern={};lookup={}
for tid,sequence in trip_stops.items():
 key=tuple(sorted(sequence))
 if key not in intern:intern[key]=len(patterns);patterns.append(dict(key))
 lookup[tid]=[*trips[tid],intern[key]]
stops=[{'id':r['stop_id'],'code':r['stop_code'],'name':r['stop_name'],'coordinate':{'latitude':float(r['stop_lat']),'longitude':float(r['stop_lon'])},'lines':sorted(stop_lines[r['stop_id']])} for r in rows('stops.txt')]
info=list(rows('feed_info.txt'))[0]
write('gtt-stops.json',stops);write('gtt-trips.json',{'patterns':patterns,'trips':lookup})
places=[];licences=set()
for r in json.load(open(a.places)):
 if r.get('operating_status')=='permanently_closed':continue
 if not r.get('name'):continue
 sources=r.get('sources') or []
 for s in sources:licences.add((s.get('dataset',''),s.get('license','')))
 addresses=r.get('addresses') or []
 x={'id':'overture:'+r['id'],'name':r['name'],'coordinate':{'latitude':r['bbox']['ymin'],'longitude':r['bbox']['xmin']},'category':r.get('category'),'hierarchy':r.get('hierarchy') or [],'source':'Overture Places','attributions':[f"{s.get('dataset','Overture')} · {s.get('license','see notices')}" for s in sources],'provenance':sources,'confidence':r.get('confidence'),'operatingStatus':r.get('operating_status'),'dataUpdatedAt':max((s.get('update_time') or '' for s in sources),default='')}
 if addresses:x['address']=', '.join(filter(None,[addresses[0].get('freeform'),addresses[0].get('locality')]))
 if r.get('websites'):x['website']=r['websites'][0]
 if r.get('phones'):x['phone']=r['phones'][0]
 places.append(x)
write('places.json',places)
write('manifest.json',{'preparedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'gtt':{'version':info.get('feed_version'),'validFrom':info.get('feed_start_date'),'validTo':info.get('feed_end_date'),'sha256':hashlib.sha256(pathlib.Path(a.gtfs).read_bytes()).hexdigest(),'url':'https://www.gtt.to.it/open_data/gtt_gtfs.zip','license':'https://www.gtt.to.it/gtt_gtfs_license.html','attribution':'Data source: GTT S.p.A. – Gruppo Torinese Trasporti','stops':len(stops),'trips':len(lookup),'patterns':len(patterns)},'places':{'release':'2026-09-23.1','url':'https://docs.overturemaps.org/attribution/','bounds':[7.674,45.087,7.704,45.103],'count':len(places),'licenses':sorted(licences),'coverage':'Food and shops in Docks Dora / part of Barriera di Milano; not citywide'}})
print(f'{len(stops)} stops, {len(lookup)} trips / {len(patterns)} stop patterns, {len(places)} places')
