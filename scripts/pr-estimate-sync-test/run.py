#!/usr/bin/env python3
"""
HARNESS VERIFIKASI SINKRONISASI ESTIMASI PR (t_d0cc2c16 — arahan DAT)
- Fixture PR-002: qty1:55500, qty1:unknown, qty1:75000 -> total 130.500, unknown 1
- Qty > 1: unit * qty
- Negative/nonnumeric/null price & qty -> unknown, not 0
- Unified effective price policy between item rows and estimate footer
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/pr-estimate-sync-verify'

REL_FILES = [
    'components/ModuleView.js', 'components/CreateModal.js', 'components/Common.js',
    'lib/constants.js', 'lib/purchaseNote.js'
]
for root, dirs, files in os.walk(os.path.join(REPO, 'modules')):
    dirs.sort()
    for f in sorted(files):
        if f.endswith(('.js', '.jsx')):
            REL_FILES.append(os.path.relpath(os.path.join(root, f), REPO))

def sb_rel(rel):
    base, _ = os.path.splitext(rel)
    return base + '.mjs'

def resolve(rel_dir, spec):
    for cand in (spec, spec + '.js', spec + '.jsx'):
        p = os.path.normpath(os.path.join(rel_dir, cand))
        if os.path.isfile(os.path.join(REPO, p)):
            return p
    return None

if os.path.exists(SB):
    shutil.rmtree(SB)

for rel in REL_FILES:
    src = open(os.path.join(REPO, rel), encoding='utf-8').read()

    def _repl(m):
        pre, spec, post = m.group(1), m.group(2), m.group(3)
        if spec.endswith('.css'):
            css_stub = os.path.join(SB, os.path.normpath(os.path.join(os.path.dirname(sb_rel(rel)), spec + '.mjs')))
            os.makedirs(os.path.dirname(css_stub), exist_ok=True)
            open(css_stub, 'w', encoding='utf-8').write('export default {};\n')
            new_spec = spec + '.mjs'
            return f'{pre}{new_spec}{post}'
        resolved = resolve(os.path.dirname(rel), spec)
        if resolved is None:
            return m.group(0)
        target = sb_rel(resolved)
        new_spec = os.path.relpath(target, os.path.dirname(sb_rel(rel))).replace(os.sep, '/')
        if not new_spec.startswith('.'):
            new_spec = './' + new_spec
        return f'{pre}{new_spec}{post}'

    src = re.sub(r"(\bfrom\s+['\"])(\.[^'\"]+)(['\"])", _repl, src)
    out = os.path.join(SB, sb_rel(rel))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w', encoding='utf-8').write(src)

# copy test_sync.mjs and test_viewports.mjs into sandbox
test_src = open(os.path.join(HERE, 'test_sync.mjs'), encoding='utf-8').read()
test_src = re.sub(r"\.\./\.\./modules/requests/view\.jsx", "./dist/modules/requests/view.mjs", test_src)
test_src = re.sub(r"\.\./\.\./modules/shared/itemHelpers\.js", "./dist/modules/shared/itemHelpers.mjs", test_src)
open(os.path.join(SB, 'test_sync.mjs'), 'w', encoding='utf-8').write(test_src)

vp_src = open(os.path.join(HERE, 'test_viewports.mjs'), encoding='utf-8').read()
open(os.path.join(SB, 'test_viewports.mjs'), 'w', encoding='utf-8').write(vp_src)

shutil.copy(os.path.join(REPO, 'scripts/pr-group-test/mock-supabaseClient.mjs'), os.path.join(SB, 'lib', 'supabaseClient.mjs'))
os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')
shutil.copy(os.path.join(REPO, 'scripts/pr-group-test/compile_sandbox.mjs'), SB)

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)

r1 = subprocess.run(['node', 'test_sync.mjs'], cwd=SB)
if r1.returncode:
    sys.exit(r1.returncode)

r2 = subprocess.run(['node', 'test_viewports.mjs'], cwd=SB)
sys.exit(r2.returncode)
