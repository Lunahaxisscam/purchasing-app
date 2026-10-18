import json
for p in ['/home/ubuntu/dev-workspaces/purchasing-review-prep-20261018/docs/integration-evidence-20261018-151039.json',
          '/home/ubuntu/dev-workspaces/purchasing-review-prep-20261018/docs/integration-evidence-20261018-150518/../integration-evidence-20261018-150518.json']:
    try:
        d=json.load(open(p))
    except Exception as e:
        print(p,'ERR',e); continue
    names=[r['suite'] for r in d['results']]
    print(p.split('/')[-1], d['stamp'], d['commit'][:8], 'entries', len(names))
    print('  approval-item present:', any('approval-item' in n for n in names))
    reds=[r for r in d['results'] if r.get('exit') not in (0,None)]
    print('  red:', [r['suite'] for r in reds])
