"""Verify exact served build bytes, including lazy-loaded PDF/font assets."""
from pathlib import Path
import hashlib,json,urllib.request
root=Path(__file__).resolve().parents[1]
base='http://100.91.244.41:3091/noir-invoice/'
results=[]
for p in sorted((root/'public/noir-invoice').rglob('*')):
    if not p.is_file(): continue
    rel=p.relative_to(root/'public/noir-invoice').as_posix()
    with urllib.request.urlopen(base+rel,timeout=10) as res:
        data=res.read();status=res.status
    digest=hashlib.sha256(data).hexdigest()
    assert data==p.read_bytes(),rel
    results.append({'path':rel,'http':status,'bytes':len(data),'sha256':digest})
print(json.dumps({'url':base,'files':results,'all_match':True},indent=2))
