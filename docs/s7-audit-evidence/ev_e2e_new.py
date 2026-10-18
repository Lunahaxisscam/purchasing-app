import json
p='/home/ubuntu/dev-workspaces/purchasing-review-prep-20261018/docs/integration-evidence-20261018-190647.json'
d=json.load(open(p))
print('e2e_base:', repr(d.get('e2e_base')))
print('e2e entries:', [r['suite'] for r in d['results'] if str(r.get('suite','')).startswith('e2e:')])
