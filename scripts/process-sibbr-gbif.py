#!/usr/bin/env python3
"""HerpetoHelp SiBBr/GBIF deterministic QC pipeline (stdlib only)."""
import argparse,csv,gzip,hashlib,io,json,math,re,shutil,sys,zipfile
from collections import Counter,defaultdict
from datetime import datetime,timezone
from pathlib import Path

BBOX=(-73.99,-33.76,-34.73,5.28)
INAT=re.compile(r'\binaturalist\b|i\.naturalist|inaturalist\.org',re.I)
YES={'1','true','yes','sim','s'}

def s(v): return '' if v is None else str(v).strip()
def k(v): return re.sub(r'\s+',' ',s(v)).casefold()
def sha(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  for b in iter(lambda:f.read(1<<20),b''): h.update(b)
 return h.hexdigest()
def delim(sample,default='\t'):
 try:return csv.Sniffer().sniff(sample,delimiters='\t,;').delimiter
 except csv.Error:return default
def table(p):
 op=gzip.open if p.suffix.lower()=='.gz' else open
 with op(p,'rt',encoding='utf-8-sig',newline='') as f:
  x=f.read(8192);f.seek(0);yield from csv.DictReader(f,delimiter=delim(x,'\t'))
def col(fields,*aliases):
 d={k(x):x for x in fields}
 return next((d[k(a)] for a in aliases if k(a) in d),None)

def taxonomy(p):
 rows=list(table(p));
 if not rows: raise ValueError('taxonomy map is empty')
 f=list(rows[0]); ci=col(f,'input_name','nome_original','nome_consulta','synonym','sinonimo','sinônimo','scientificName','name'); ca=col(f,'accepted_name','nome_aceito','nome_aceito_sbh','acceptedScientificName','valid_name')
 if not ci or not ca: raise ValueError('taxonomy map needs input_name and accepted_name')
 cf=col(f,'family','familia','família');cg=col(f,'group','grupo','class','classe');cr=col(f,'relation','relacao','relação','tipo_relacao','tipo_relação');cm=col(f,'merge_allowed','allow_auto_merge','fusao_automatica','fusão_automática','pode_fundir')
 out={}
 for r in rows:
  a,b=s(r.get(ci)),s(r.get(ca))
  if not a or not b: continue
  rule={'accepted':b,'family':s(r.get(cf)) if cf else '','group':s(r.get(cg)) if cg else '','relation':s(r.get(cr)) if cr else ('ACCEPTED_NAME' if k(a)==k(b) else 'SYNONYM'),'merge':(k(a)==k(b)) if not cm else k(r.get(cm)) in YES}
  if k(a) in out and out[k(a)]!=rule: raise ValueError('ambiguous taxonomy map: '+a)
  out[k(a)]=rule
 return out,{'path':str(p),'sha256':sha(p),'rows':len(rows),'mapped_names':len(out)}

def provenance(p):
 if not p:return {},{'path':None,'rows':0,'sha256':None}
 rows=list(table(p));
 if not rows:return {},{'path':str(p),'rows':0,'sha256':sha(p)}
 f=list(rows[0]);ci=col(f,'datasetKey','dataset_key','dataset_id','datasetName','dataset_name');cs=col(f,'status','provenance_status','procedencia_status','procedência_status');cn=col(f,'note','notes','observacao','observação')
 if not ci or not cs: raise ValueError('provenance map needs dataset identifier and status')
 d={k(r.get(ci)):(s(r.get(cs)).upper(),s(r.get(cn)) if cn else '') for r in rows if s(r.get(ci))}
 return d,{'path':str(p),'sha256':sha(p),'rows':len(rows),'mapped_datasets':len(d)}

def polygons(p):
 if not p:return None,None
 o=json.loads(p.read_text(encoding='utf-8')); gs=[]
 if o.get('type')=='FeatureCollection':gs=[x.get('geometry') for x in o.get('features',[]) if x.get('geometry')]
 elif o.get('type')=='Feature':gs=[o.get('geometry')]
 else:gs=[o]
 ps=[]
 for g in gs:
  if g and g.get('type')=='Polygon':ps.append(g['coordinates'])
  elif g and g.get('type')=='MultiPolygon':ps+=g['coordinates']
 if not ps:raise ValueError('no polygon in Brazil GeoJSON')
 return ps,{'path':str(p),'sha256':sha(p),'polygons':len(ps)}
def ring(x,y,r):
 z=False;j=len(r)-1
 for i in range(len(r)):
  xi,yi=r[i][:2];xj,yj=r[j][:2]
  if (yi>y)!=(yj>y) and x<(xj-xi)*(y-yi)/((yj-yi) or 1e-300)+xi:z=not z
  j=i
 return z
def inside(x,y,ps): return any(p and ring(x,y,p[0]) and not any(ring(x,y,h) for h in p[1:]) for p in ps)
def coord(v):
 try:
  x=float(s(v).replace(',','.'));return x if math.isfinite(x) else None
 except:return None

def occurrences(p):
 if p.is_dir():
  q=next(iter(p.rglob('occurrence.txt')),None)
  if not q:raise ValueError('occurrence.txt not found in '+str(p))
  def gen():
   with q.open('r',encoding='utf-8-sig',newline='') as f:
    x=f.read(8192);f.seek(0);yield from csv.DictReader(f,delimiter=delim(x))
  return gen(),False,[]
 z=zipfile.ZipFile(p);bad=z.testzip()
 if bad:z.close();raise ValueError(f'CRC error {p.name}: {bad}')
 names=z.namelist();occ=next((n for n in names if Path(n).name.lower()=='occurrence.txt'),None)
 if not occ:z.close();raise ValueError('occurrence.txt not found in '+p.name)
 hits=[]
 for n in names:
  if n.lower().endswith('.xml') and INAT.search(z.read(n).decode('utf-8','ignore')):hits.append(n)
 def gen():
  try:
   with z.open(occ) as b:
    f=io.TextIOWrapper(b,encoding='utf-8-sig',newline='');x=f.read(8192);f.seek(0);yield from csv.DictReader(f,delimiter=delim(x))
  finally:z.close()
 return gen(),bool(hits),hits

def pstatus(r,pmap):
 for x in (r.get('datasetKey'),r.get('datasetName')):
  if k(x) in pmap:return pmap[k(x)]
 return 'PENDING','Dataset/provenance not audited'
def trule(r,tmap):
 for x in (r.get('scientificName'),r.get('acceptedScientificName')):
  if k(x) in tmap:
   q=tmap[k(x)]
   return (q,'') if k(x)==k(q['accepted']) or q['merge'] else (None,'TAXON_RELATION_REQUIRES_REVIEW:'+q['relation'])
 return None,'TAXON_NOT_RESOLVED'
def rid(r):
 if s(r.get('gbifID')):return 'g:'+s(r['gbifID'])
 if s(r.get('occurrenceID')):return 'o:'+s(r['occurrenceID'])
 return 'f:'+hashlib.sha1('|'.join(s(r.get(x)) for x in ('scientificName','catalogNumber','decimalLatitude','decimalLongitude','eventDate','datasetKey')).encode()).hexdigest()
def outrow(r,fields,q,ps,decision,reason,name):
 d={x:s(r.get(x)) for x in fields if not x.startswith('herpetohelp')};d.update({'herpetohelpAcceptedName':q['accepted'] if q else '','herpetohelpFamily':q['family'] if q else '','herpetohelpGroup':q['group'] if q else '','herpetohelpTaxonRelation':q['relation'] if q else '','herpetohelpProvenanceStatus':ps,'herpetohelpDecision':decision,'herpetohelpReason':reason,'herpetohelpInputFile':name});return d

def main():
 a=argparse.ArgumentParser();a.add_argument('inputs',nargs='+',type=Path);a.add_argument('--taxonomy-map',required=True,type=Path);a.add_argument('--provenance-map',type=Path);a.add_argument('--brazil-geojson',type=Path);a.add_argument('--out-dir',required=True,type=Path);a.add_argument('--raw-archive-dir',type=Path);a.add_argument('--expected-sha256',action='append',default=[]);a.add_argument('--allow-unreviewed-provenance',action='store_true');a.add_argument('--allow-bbox-only',action='store_true');A=a.parse_args()
 A.out_dir.mkdir(parents=True,exist_ok=True);exp=dict(x.split('=',1) for x in A.expected_sha256);raw=[]
 if A.raw_archive_dir:A.raw_archive_dir.mkdir(parents=True,exist_ok=True)
 for p in A.inputs:
  if not p.exists():raise ValueError('missing input '+str(p))
  h=sha(p) if p.is_file() else None
  if p.name in exp and h.lower()!=exp[p.name].lower():raise ValueError('SHA-256 mismatch '+p.name)
  e={'name':p.name,'sha256':h,'size':p.stat().st_size if p.is_file() else None}
  if A.raw_archive_dir and p.is_file():
   t=A.raw_archive_dir/p.name
   if t.exists() and sha(t)!=h:raise ValueError('raw archive collision '+p.name)
   if not t.exists():shutil.copy2(p,t)
   if sha(t)!=h:raise ValueError('raw copy SHA mismatch '+p.name)
   e['preserved_copy']=str(t)
  raw.append(e)
 tm,tmmeta=taxonomy(A.taxonomy_map);pm,pmmeta=provenance(A.provenance_map);ps,geometa=polygons(A.brazil_geojson)
 counts=Counter();reasons=Counter();by=defaultdict(Counter);seen=set();datasets={};xmlhits=[];W={};F=[];fields=None
 def writers(srcfields):
  nonlocal fields
  if W:return
  fields=list(dict.fromkeys(list(srcfields)+['gbifID','occurrenceID','scientificName','acceptedScientificName','class','family','basisOfRecord','occurrenceStatus','decimalLatitude','decimalLongitude','countryCode','datasetKey','datasetName','institutionCode','collectionCode','catalogNumber','references','source','license']))+['herpetohelpAcceptedName','herpetohelpFamily','herpetohelpGroup','herpetohelpTaxonRelation','herpetohelpProvenanceStatus','herpetohelpDecision','herpetohelpReason','herpetohelpInputFile']
  for key,fn in {'v':'SiBBr_VALIDADO.tsv.gz','e':'SiBBr_EXCLUIDOS.tsv.gz','m':'SiBBr_REVISAO_MANUAL.tsv.gz','a':'SiBBr_AUDITORIA.tsv.gz'}.items():
   f=gzip.open(A.out_dir/fn,'wt',encoding='utf-8',newline='');w=csv.DictWriter(f,fieldnames=fields,delimiter='\t',extrasaction='ignore');w.writeheader();F.append(f);W[key]=w
 for p in A.inputs:
  rows,xi,xh=occurrences(p)
  if xi:xmlhits.append({'input':p.name,'xml_hits':xh})
  for r in rows:
   writers(r.keys());counts['raw']+=1;by[p.name]['raw']+=1;dk=s(r.get('datasetKey')) or s(r.get('datasetName')) or 'UNKNOWN';pst,pnote=pstatus(r,pm);datasets.setdefault(dk,{'datasetKey':s(r.get('datasetKey')),'datasetName':s(r.get('datasetName')),'institutionCode':s(r.get('institutionCode')),'publishingOrgKey':s(r.get('publishingOrgKey')),'references':s(r.get('references')),'source':s(r.get('source'))});datasets[dk].update(status=pst,note=pnote)
   D,R='VALIDATED','OK';q=None
   if any(INAT.search(s(v)) for v in r.values() if v is not None):D,R='EXCLUDED','SOURCE_INATURALIST'
   elif s(r.get('basisOfRecord')).upper() in {'FOSSIL_SPECIMEN','FOSSIL'}:D,R='EXCLUDED','FOSSIL_SPECIMEN'
   elif s(r.get('occurrenceStatus')).upper() not in {'','PRESENT'}:D,R='EXCLUDED','OCCURRENCE_NOT_PRESENT'
   else:
    y,x=coord(r.get('decimalLatitude')),coord(r.get('decimalLongitude'))
    if y is None or x is None:D,R='EXCLUDED','COORDINATE_MISSING_OR_INVALID'
    elif not(-90<=y<=90 and -180<=x<=180) or (x==0 and y==0):D,R='EXCLUDED','COORDINATE_OUT_OF_RANGE'
    elif s(r.get('countryCode')).upper() not in {'BR','BRA'}:D,R='EXCLUDED','COUNTRY_NOT_BRAZIL'
    elif not(BBOX[0]<=x<=BBOX[2] and BBOX[1]<=y<=BBOX[3]):D,R='EXCLUDED','COORDINATE_OUTSIDE_BRAZIL_BBOX'
    elif ps and not inside(x,y,ps):D,R='EXCLUDED','COORDINATE_OUTSIDE_BRAZIL_POLYGON'
   if D=='VALIDATED':
    q,tr=trule(r,tm)
    if not q:D,R='MANUAL_REVIEW',tr
    elif q['group'] and q['group'].upper() not in {'AMPHIBIA','REPTILIA'}:D,R='MANUAL_REVIEW','TAXON_GROUP_NOT_AMPHIBIA_REPTILIA'
    elif s(r.get('class')).upper() and s(r.get('class')).upper() not in {'AMPHIBIA','REPTILIA'}:D,R='EXCLUDED','SOURCE_CLASS_NOT_AMPHIBIA_REPTILIA'
   if D=='VALIDATED':
    if pst in {'REJECTED','DENIED','EXCLUDE','EXCLUDED'}:D,R='EXCLUDED','PROVENANCE_REJECTED'
    elif pst not in {'APPROVED','VALIDATED','VERIFIED'} and not A.allow_unreviewed_provenance:D,R='MANUAL_REVIEW','PROVENANCE_PENDING'
   z=rid(r)
   if D=='VALIDATED' and z in seen:D,R='EXCLUDED','DUPLICATE_EXACT'
   seen.add(z);o=outrow(r,fields,q,pst,D,R,p.name);W['a'].writerow(o);W[{'VALIDATED':'v','EXCLUDED':'e','MANUAL_REVIEW':'m'}[D]].writerow(o);counts[D.lower()]+=1;reasons[R]+=1;by[p.name][D.lower()]+=1
 for f in F:f.close()
 if fields is None:raise ValueError('no occurrence rows')
 pf=A.out_dir/'SiBBr_PROVENIENCIA_DATASETS.tsv'
 with pf.open('w',encoding='utf-8',newline='') as f:
  fs=['datasetKey','datasetName','institutionCode','publishingOrgKey','references','source','status','note'];w=csv.DictWriter(f,fieldnames=fs,delimiter='\t');w.writeheader();w.writerows(sorted(datasets.values(),key=lambda x:(x['datasetName'],x['datasetKey'])))
 blockers=[]
 if xmlhits:blockers.append('INATURALIST_REFERENCE_FOUND_IN_DATASET_XML')
 if not(ps or A.allow_bbox_only):blockers.append('BRAZIL_POLYGON_NOT_PROVIDED')
 if A.allow_unreviewed_provenance:blockers.append('UNREVIEWED_PROVENANCE_ALLOWED')
 status='VALIDATED' if not blockers else 'BLOCKED';summary={'generated_at':datetime.now(timezone.utc).isoformat(),'release_status':status,'publication_allowed':False,'blockers':blockers,'counts':dict(counts),'reasons':dict(reasons),'by_input':{x:dict(y) for x,y in by.items()},'datasets':len(datasets),'xml_inaturalist_inputs':xmlhits,'taxonomy':tmmeta,'provenance':pmmeta,'spatial_boundary':geometa or {'mode':'countryCode+Brazil bbox','bbox':BBOX},'policy':{'exclude_inaturalist':True,'exclude_fossils':True,'preserve_raw':bool(A.raw_archive_dir),'no_automatic_publication':True}}
 (A.out_dir/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8');outs=[]
 for p in sorted(A.out_dir.iterdir()):
  if p.is_file() and p.name not in {'manifest.json'}:outs.append({'name':p.name,'sha256':sha(p),'size':p.stat().st_size})
 manifest={'schema_version':'1.0.0','pipeline':'HerpetoHelp SiBBr/GBIF QC','generated_at':summary['generated_at'],'release_status':status,'publication_allowed':False,'inputs':raw,'outputs':outs,'manual_review_required':counts.get('manual_review',0)>0 or bool(blockers),'next_step':'Review only manual/provenance exceptions, rerun, then request explicit approval before publication.'}
 (A.out_dir/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({'release_status':status,'counts':dict(counts),'blockers':blockers},ensure_ascii=False))
if __name__=='__main__':
 try:main()
 except Exception as e:print('ERROR:',e,file=sys.stderr);sys.exit(2)
