import json, sys
p='/home/ubuntu/dev-workspaces/purchasing-review-prep-20261018/docs/integration-evidence-20261018-153342.json'
d = json.load(open(p))
print('stamp', d['stamp'], 'commit', d['commit'][:8], 'branch', d['branch'])
reds = [r for r in d['results'] if r.get('exit') not in (0, None)]
greens = [r for r in d['results'] if r.get('exit') == 0]
tot_p = sum(r.get('passed') or 0 for r in d['results'])
tot_f = sum(r.get('failed') or 0 for r in d['results'])
print('green', len(greens), 'red', len(reds), 'entries', len(d['results']))
print('sum passed', tot_p, 'sum failed', tot_f)
for r in reds:
    print('RED:', r['suite'], 'exit', r['exit'], 'passed', r.get('passed'), 'failed', r.get('failed'), '| note:', (r.get('note') or '')[:200])
