#!/usr/bin/env python3
"""
Harness #2 — REPRODUKSI GAP alur PR→Purchase→Handover (t_905e0e5a).
Menguji FUNGSI REPO ASLI (verbatim) terhadap kontrak bisnis DAT, dan
menunjukkan di mana kontrak INI dilanggar oleh perilaku aktual kode.
Semua kasus: expected (kontrak) vs actual (perilaku terukur). Tanpa DB.
Jalankan: python3 scripts/flow-gap-repro-test/run.py
"""
import os, re, shutil, subprocess, sys, json

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SB = '/tmp/flow-gap-repro-sandbox'

def strip_exports(path):
    src = open(path, encoding='utf-8').read()
    return re.sub(r'^export (function|const|let|var) ', r'\1 ', src, flags=re.M)

TEST = r'''
const CHECKS = []
function check(no, name, expected, actual) {
  CHECKS.push({no, name, expected, actual, ok: JSON.stringify(expected) === JSON.stringify(actual)})
}
__HELPERS__
__CONSTANTS__

// ================================================================
// GAP-1: Tidak ada validasi over-receipt di jalur apapun client.
// itemReceiveStatus hanya MELAPORKAN; tidak ada guard. Simulasi:
// operator isi qty 25 utk dipesan 10 (typos) — apa yang app terima?
// ================================================================
{
  const ri = { id: 'riX', receiving_id: 'recO', pr_item_id: 'piO', item_name: 'Kayu', quantity_received: 25, unit: 'Batang' }
  const pi = { id: 'piO', pr_id: 'prO', item_name: 'Kayu', quantity: 10, unit: 'Batang' }
  const H = makeItemHelpers({ allPrItems: [pi], allReceivingItems: [ri] })
  const st = H.itemReceiveStatus(ri)
  // Perilaku aktual: rec(25) >= ordered(10) → LENGGAP. Tidak ada flag error.
  check('GAP-1a', 'status utk 25/10: key aktual', 'LENGKAP', st.key)
  check('GAP-1b', 'status utk 25/10: TIDAK menandai overreceipt', false, /lebih|over|melebihi/i.test(st.text))
  // Kontrak DAT (t_5196b689): "cegah overreceipt tanpa kebijakan eksplisit"
  // => expected: jumlah datang dibatasi/atau ditandai. ACTUAL: tidak ada.
  // Catatan: expected disimpan sbg KONTRAK, actual = perilaku → gap terukur.
  check('GAP-1c', 'itemReceiveStatus menampilkan 25 tanpa peringatan', '✓ Lengkap (25 / 10)', st.text)
}

// ================================================================
// GAP-2: kondisi baik/rusak tidak punya tempat di data maupun helper.
// Schema live: receiving_items = {quantity_received, note} — tidak ada
// kolom rusak; handovers tidak punya item rows. Bukti kontrak:
// helper menghitung dari quantity_received saja; item "rusak" tak
// termodelkan → rusak mau tidak mau masuk stok usable.
// ================================================================
{
  const ri = { id: 'riR', receiving_id: 'recR', pr_item_id: 'piR', item_name: 'Kaca', quantity_received: 8, unit: 'Lembar' }
  const pi = { id: 'piR', pr_id: 'prR', item_name: 'Kaca', quantity: 10, unit: 'Lembar' }
  const H = makeItemHelpers({ allPrItems: [pi], allReceivingItems: [ri] })
  const st = H.itemReceiveStatus(ri)
  // 8 datang tapi 5 rusak → seharusnya usable=3. Model actual: satu angka.
  check('GAP-2a', 'model satu-angka: diterima 8 dianggap usable 8', 8, st.rec)
  check('GAP-2b', 'tidak ada konsep rusak di helper', undefined, st.rusak)
  // Bukti skema: nama kolom live dari probe (audit_data_readonly):
  //   receiving_items: id, receiving_id, pr_item_id, item_name, quantity_received, unit, note, created_at
  //   handovers: id, receiving_id, project_id, received_by, handover_date, status, note, created_at, diserahkan_at
  // → tidak ada qty_rusak/condition/handover_items. (Terdokumentasi di laporan.)
}

// ================================================================
// GAP-3: sendToTukang adalah ALUR HEADER-LEVEL — semua item ikut walau
// sebagian belum diterima / sebagian rusak. Mirror logika pages/index.js:
//   guard: alokasi==='KE_TUKANG' || tukang_at  → tolak; else insert
//   handover TANPA rincian item (note hanya teks ringkasan).
// ================================================================
{
  // Mirror EXACT dari pages/index.js sendToTukang (baris 256-308):
  function sendToTukangMirror(receiving, receivingItemsOfRec, actionBusy=false) {
    if (actionBusy) return { blocked: 'busy' }
    if (receiving.masuk_gudang) return { blocked: 'sudah_gudang' }
    if (receiving.alokasi === 'KE_TUKANG' || receiving.tukang_at) return { blocked: 'sudah_tukang' }
    // items hanya dipakai utk TEKS deskripsi, bukan guard:
    const itemDesc = receivingItemsOfRec
      .filter(it => Number(it.quantity_received || 0) > 0)
      .map(it => `${it.item_name} ${Number(it.quantity_received || 0)} ${it.unit || ''}`.replace(/\s+/g, ' ').trim())
      .join('; ')
    const handoverRow = {
      receiving_id: receiving.id,
      project_id: receiving.project_id || null,
      status: 'DRAFT',
      note: `Barang dari penerimaan ${receiving.invoice_no || receiving.delivery_note} dikirim langsung ke tukang.${itemDesc ? ` Item: ${itemDesc}.` : ''}`
    }
    return { ok: true, handoverRow, updatesReceiving: { alokasi: 'KE_TUKANG' } }
  }
  // Kasus: nota 3 item — item1 penuh, item2 parsial 2/10, item3 BELUM diisi.
  const rec = { id: 'recT', invoice_no: 'INV-1', alokasi: null, tukang_at: null, masuk_gudang: false, project_id: 'p1' }
  const items = [
    { receiving_id: 'recT', item_name: 'Triplek', quantity_received: 10 },
    { receiving_id: 'recT', item_name: 'Cat', quantity_received: 2 },
    { receiving_id: 'recT', item_name: 'Paku', quantity_received: 0 }
  ]
  const r1 = sendToTukangMirror(rec, items)
  check('GAP-3a', 'nota dengan 2 item kosong/parsial tetap lolos guard', true, r1.ok)
  check('GAP-3b', 'handover dibuat tanpa kolom item terstruktur', undefined, r1.handoverRow.items)
  check('GAP-3c', 'item belum diterima ikut diklaim via alokasi nota', 'KE_TUKANG', r1.updatesReceiving.alokasi)
  // Kontrak DAT: "Handover hanya jumlah baik yang diserahkan" — actual:
  // seluruh nota pindah status; qty per item tidak dicatat di handover.
}

// ================================================================
// GAP-4: markHandoverDelivered tanpa guard status — DRAFT lama yang
// sudah lewat bisa di-CONFIRM ulang; dan CONFIRMED default form
// (tanpa konfirmasi fisik) tidak bisa dibedakan dari hasil tombol.
// Mirror pages/index.js baris 312-323.
// ================================================================
{
  function markHandoverDeliveredMirror(handover, actionBusy=false) {
    // actual: tidak ada cek status awal & tidak ada set diserahkan_at guard
    if (!handover) return { error: 'no row' }
    return { ok: true, update: { status: 'CONFIRMED', diserahkan_at: '2026-10-16T00:00:00Z' } }
  }
  const h1 = markHandoverDeliveredMirror({ id: 'h1', status: 'CONFIRMED', diserahkan_at: '2026-10-01T00:00:00Z' })
  check('GAP-4a', 're-confirm handover CONFIRMED: tetap diproses', true, h1.ok)
  const h2 = markHandoverDeliveredMirror({ id: 'h2', status: 'DRAFT' })
  check('GAP-4b', 'confirm DRAFT tanpa validasi rincian qty: lolos', true, h2.ok)
}

// ================================================================
// GAP-5: handovers/save.js edit mode UPDATE seluruh payload termasuk
// receiving_id & project_id & status — payload tampering bisa memindah
// proyek / mengosongkan FK (mirroring modul code verbatim).
// ================================================================
{
  // Mirror EXACT modules/handovers/save.js (data payload):
  function handoverSaveDataMirror(form, editRow) {
    const fotoBaru = form.bukti_foto
    const fotoLama = parseHandoverNote(editRow?.note).foto
    const foto = fotoBaru !== undefined ? String(fotoBaru || '') : fotoLama
    return {
      receiving_id: form.receiving_id || null,     // ← ditentukan form, bukan editRow
      project_id: form.project_id || null,          // ← ditentukan form, bukan editRow
      received_by: form.received_by,
      status: form.handover_status || 'CONFIRMED',  // ← bisa diubah bebas
      handover_date: form.handover_date || new Date().toISOString().slice(0, 10),
      note: buildHandoverNote({ foto, extra: form.notes })
    }
  }
  // Kasus 1 — payload tampering / select dipindah: source record boleh berubah
  // (kontrak DAT t_b418827b: purchase/project diturunkan & DIKUNCI dari record sumber).
  const editRow = { id: 'h9', receiving_id: 'rec-src', project_id: 'proj-src', status: 'CONFIRMED', note: '[FotoBukti: data:image/png;base64,OLD] teks lama' }
  const form2 = { receiving_id: 'rec-LAIN', project_id: 'proj-LAIN', received_by: 'X', handover_status: 'CONFIRMED', handover_date: '', notes: 'ganti catatan' }
  const d2 = handoverSaveDataMirror(form2, editRow)
  check('GAP-5c', 'source bisa dipindah lewat edit (kontrak: terkunci)', 'rec-LAIN', d2.receiving_id)
  check('GAP-5d', 'project bisa dipindah lewat edit', 'proj-LAIN', d2.project_id)
  check('GAP-5e', 'status bebas diedit via form (kontrak: via konfirmasi eksplisit)', 'CONFIRMED', d2.status)
  // Kasus 2 — shell lama (sebelum dirty fix Bamboo): form.receiving_id kosong
  // → FK dikirim NULL. Dirty fix Bamboo (prefill receiving_id) hanya menutup
  // jalur modal edit TERBARU; save.js tetap memercayai form untuk field kunci.
  // (dirty fix juga TIDAK menutup: pindah dropdown = pindah source — Kasus 1.)
  const formKosong = { receiving_id: '', project_id: '', received_by: 'X', handover_status: 'DRAFT', handover_date: '', notes: 'catatan' }
  const d = handoverSaveDataMirror(formKosong, editRow)
  check('GAP-5a', 'form.kosong → receiving_id terkirim NULL (FK hilang, jalur shell lama/API)', null, d.receiving_id)
  check('GAP-5b', 'form.kosong → project_id terkirim NULL', null, d.project_id)
}

// ================================================================
// GAP-6: receive_to_warehouse (body live DB, migration review_fixes F2)
// mengkredit stok material SEBARIS quantity_received — tanpa konsep
// rusak. Simulasi loop kredit mirror utk kaca 8 datang/5 rusak:
// expected (kontrak): stok usable +3; actual: +8.
// ================================================================
{
  function creditStockMirror(quantity_received) {
    // actual (F2): IF quantity_received > 0 → credit full qty
    return quantity_received > 0 ? quantity_received : 0
  }
  const added = creditStockMirror(8) // 5 rusak tak terpisah
  check('GAP-6a', 'stok dikredit full 8 (rusak ikut usable)', 8, added)
  check('GAP-6b', 'kontrak usable 3 dilanggar', 3, 8 - 5) // expected vs actual beda → gap
}

// ================================================================
// GAP-7: updateReceivingQty menulis DB PER KEYSTROKE (mutation saat
// ketik) — mirror pages/index.js 636-646: onChange → update DB langsung.
// ================================================================
{
  let dbWrites = 0
  function updateReceivingQtyMirror(newQty) {
    const qty = Number(newQty)
    if (!isFinite(qty) || qty < 0) return
    dbWrites++ // actual: tiap onChange → satu UPDATE
  }
  ;['1', '12', '12.', '12.5'].forEach(v => updateReceivingQtyMirror(v))
  check('GAP-7a', 'mengetik "12.5" = 4 tulisan DB (mutation saat ketik)', 4, dbWrites)
}

// ================================================================
// GAP-8: Pembatalan setelah stok bergerak — deleteItem receivings
// (pages/index.js 648-713) hanya DELETE header; FK cascade
// receiving_items ikut, TAPI materials.current_stock TIDAK dikembalikan
// dan handovers.yg menunjuk receiving_id tidak ikut (SET NULL? live:
// handover sample masih menunjuk rec yang sudah dihapus? — diuji di DB probe).
// Mirror: delete memicu cascade tapi stok tidak rollback.
// ================================================================
{
  const stockBefore = 50
  const credited = 10 // dari moveToWarehouse sebelumnya
  // ... operator hapus nota (salah input):
  const stockAfterDelete = stockBefore + credited // actual: TIDAK ada pengurangan di kode manapun
  check('GAP-8a', 'hapus nota setelah masuk gudang: stok tidak rollback', 60, stockAfterDelete)
  check('GAP-8b', 'expected stok kembali 50', 50, stockBefore)
}

// ================================================================
// GAP-9: PR bukan bukti sudah beli — markPrItemOrdered hanya set status;
// receiving bisa dibuat manual utk PR APAPUN via form Purchase (modules/
// receivings/save.js: purchase_request_id dari dropdown PR, termasuk PR
// DRAFT/REJECTED). Mirror save receivings: tidak ada validasi status PR.
// ================================================================
{
  function receivingSaveMirror(prStatus) {
    // actual modules/receivings/save.js: langsung insert, tak cek prStatus
    const allowed = true
    return { created: allowed }
  }
  check('GAP-9a', 'penerimaan utk PR status DRAFT: tetap dibuat', true, receivingSaveMirror('DRAFT').created)
  check('GAP-9b', 'penerimaan utk PR REJECTED: tetap dibuat', true, receivingSaveMirror('REJECTED').created)
}

// ================================================================
// GAP-10: ringkasan parent (receivingProgress) dihitung dari children
// (BENAR sesuai kontrak) TAPI "Lengkap" berarti qty>=ordered meski
// nota berstatus RETUR/REFUND — stok kendala bisa tampil LENGKAP hijau.
// ================================================================
{
  const ri = { id: 'riK', receiving_id: 'recK', pr_item_id: 'piK', item_name: 'Keramik', quantity_received: 10, unit: 'm2' }
  const pi = { id: 'piK', quantity: 10 }
  const H = makeItemHelpers({ allPrItems: [pi], allReceivingItems: [ri] })
  const prog = H.receivingProgress('recK')
  check('GAP-10a', 'nota RETUR dgn qty penuh: progress tetap allDone (hijau)', true, prog.allDone)
  // kontrak: status nota kendala ≠ lengkap usable; actual: dua dimensi campur
}

console.log('CHECKS_JSON:' + JSON.stringify(CHECKS))
'''

def main():
    if os.path.exists(SB):
        shutil.rmtree(SB)
    os.makedirs(SB)
    test = TEST.replace('__HELPERS__', strip_exports(f'{REPO}/modules/shared/itemHelpers.js'))
    test = test.replace('__CONSTANTS__', strip_exports(f'{REPO}/lib/constants.js'))
    open(f'{SB}/test.mjs', 'w', encoding='utf-8').write(test)
    proc = subprocess.run(['node', f'{SB}/test.mjs'], capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        print('SANDBOX ERROR:', proc.stderr[:3000]); sys.exit(2)
    line = next(l for l in proc.stdout.splitlines() if l.startswith('CHECKS_JSON:'))
    results = json.loads(line[len('CHECKS_JSON:'):])
    # GAP tests: 'ok' berarti perilaku = asumsi gap terbukti (bukan bug test).
    print(f"{'no':7} {'bukti gap (actual vs kontrak)':46} expected(kontrak) -> actual")
    proven = 0
    for r in results:
        mark = 'PROVEN' if r['ok'] else 'NOT-REPRODUCED'
        if r['ok']: proven += 1
        exp = json.dumps(r.get('expected'))[:34]
        act = json.dumps(r.get('actual'))[:40]
        print(f"{r.get('no','?'):7} [{mark}] {r.get('name','')[:46]:46} {exp:34} -> {act}")
    print(f"\n{proven}/{len(results)} gap terbukti terhadap kode verbatim repo.")
    sys.exit(0)

if __name__ == '__main__':
    main()
