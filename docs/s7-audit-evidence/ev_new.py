import json
p='/home/ubuntu/dev-workspaces/purchasing-review-prep-20261018/docs/integration-evidence-20261018-190647.json'
d=json.load(open(p))
res=d['results']
red=[(r['suite'],r.get('note','')[:80]) for r in res if r.get('exit') not in (0,None)]
print('stamp',d['stamp'],'commit',d['commit'][:8],'entries',len(res))
print('approval-item present:', any('approval-item' in (r.get('suite') or '') for r in res))
print('red:',red)
for r in res:
    if 'approval-item' in (r.get('suite') or ''):
        print('approval-item:', json.dumps(r))
tot_p=sum(r.get('passed') or 0 for r in res)
tot_f=sum(r.get('failed') or 0 for r in res)
print('totals passed',tot_p,'failed',tot_f)
