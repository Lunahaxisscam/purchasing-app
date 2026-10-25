import json
p='/home/ubuntu/dev-workspaces/purchasing-review-prep-20261018/docs/integration-evidence-20261018-153342.json'
d=json.load(open(p))
print('top keys:', list(d.keys()))
for k,v in d.items():
    if isinstance(v,list):
        print(k,'len',len(v))
        for it in v[:3]:
            print('  ',json.dumps(it)[:160])
    elif isinstance(v,dict):
        print(k,'dict keys',list(v.keys())[:12])
    else:
        print(k,'=',str(v)[:120])
