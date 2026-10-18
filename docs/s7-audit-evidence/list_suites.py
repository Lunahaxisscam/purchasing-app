import json, os, re
base='/home/ubuntu/dev-workspaces/purchasing-review-prep-20261018/docs/integration-evidence-20261018-153342.json'
d=json.load(open(base))
for r in d['results']:
    print(f"{r['suite']:34s} exit={r.get('exit')} passed={r.get('passed')} failed={r.get('failed')} secs={r.get('seconds')}")
