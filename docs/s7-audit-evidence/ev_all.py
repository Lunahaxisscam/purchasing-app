import json
base='/home/ubuntu/dev-workspaces/purchasing-review-prep-20261018/docs/integration-evidence-'
for stamp in ['20261018-153342','20261018-151039','20261018-150518','20261018-050817']:
    try:
        d=json.load(open(base+stamp+'.json'))
    except Exception as e:
        print(stamp,'ERR',e); continue
    res=d.get('results',[])
    names=[r.get('suite') for r in res]
    red=[r.get('suite') for r in res if r.get('exit') not in (0,None)]
    print('===',stamp,'commit',d.get('commit','')[:8],'entries',len(res))
    print('  red:',red)
    print('  approval-item present:', 'approval-item-action-test' in names)
    print('  names:', ', '.join(names))
