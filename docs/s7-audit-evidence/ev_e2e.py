import json
p='/home/ubuntu/dev-workspaces/purchasing-review-prep-20261018/docs/integration-evidence-20261018-050817.json'
d=json.load(open(p))
for r in d['results']:
    if str(r.get('suite','')).startswith('e2e:'):
        print(r['suite'], 'exit=',r.get('exit'), 'passed=',r.get('passed'), 'note=',(r.get('note') or '')[:60])
