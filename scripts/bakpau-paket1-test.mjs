import assert from "node:assert"
import {
  buildItemPriceNoteLoose, markItemVoid, isItemVoided,
  effectiveLineTotal, rebuildHeaderNominal
} from "../lib/bakpau/itemVoid.js"

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log("ok   " + name) }

// 1) harga normal
t("harga 282000 -> [Harga: 282000]", () =>
  assert.strictEqual(buildItemPriceNoteLoose(282000), "[Harga: 282000]"))

// 2) harga 0 non-void = nol disengaja (bukan null)
t("harga 0 -> [Harga: 0] (no lebih lama bikin null)", () =>
  assert.strictEqual(buildItemPriceNoteLoose(0), "[Harga: 0]"))

// 3) void menandai baris
t("markItemVoid -> [Void: 1] + alasan", () => {
  const out = markItemVoid("[Harga: 282000]", "duplikat INV/2026/000602")
  assert.match(out, /\[Harga: 282000\]/)
  assert.match(out, /\[Void: 1\]/)
  assert.match(out, /\[AlasanVoid: duplikat INV\/2026\/000602\]/)
})

// 4) void idempoten (tidak menumpuk penanda)
t("markItemVoid dua kali tidak menumpuk", () => {
  const once = markItemVoid("[Harga: 282000]", "duplikat")
  const twice = markItemVoid(once, "duplikat")
  assert.strictEqual((twice.match(/\[Void:/g) || []).length, 1)
  assert.strictEqual((twice.match(/\[AlasanVoid:/g) || []).length, 1)
})

// 5) baris void = 0 ke total (kasus nyata Bakpau)
t("void 2x282000 -> total 0 (dulu 564000)", () => {
  const note = markItemVoid("[Harga: 141000]", "duplikat")
  assert.strictEqual(effectiveLineTotal(2, 141000, note), 0)
})

// 6) baris normal tetap dihitung
t("baris normal 2x141000 = 282000", () =>
  assert.strictEqual(effectiveLineTotal(2, 141000, "[Harga: 141000]"), 282000))

// 7) rebuild nominal dari baris
t("rebuild: 282000 -> 0", () => {
  const h = "[Nominal: Rp 282.000] [Tahap: DIBELI] catatan"
  const out = rebuildHeaderNominal(h, 0)
  assert.match(out, /\[Nominal: Rp 0\]/)
  assert.match(out, /\[Tahap: DIBELI\]/)
  assert.match(out, /catatan/)
})

// 8) rebuild tidak menghapus penanda lain (BuktiNota dsb)
t("rebuild pertahankan BuktiNota + BakpauEvent", () => {
  const h = "[Nominal: Rp 444.000] [BuktiNota: data:x] [BakpauEvent: telegram:1:2]"
  const out = rebuildHeaderNominal(h, 234000)
  assert.match(out, /\[Nominal: Rp 234.000\]/)
  assert.match(out, /\[BuktiNota: data:x\]/)
  assert.match(out, /\[BakpauEvent: telegram:1:2\]/)
})

// 9) rebuild menambah penanda bila belum ada
t("rebuild menambah [Nominal] bila hilang", () => {
  const out = rebuildHeaderNominal("catatan saja", 100000)
  assert.match(out, /\[Nominal: Rp 100.000\]/)
  assert.match(out, /catatan saja/)
})

// 10) void terdeteksi
t("isItemVoided", () => {
  assert.strictEqual(isItemVoided(markItemVoid("[Harga: 0]", "x")), true)
  assert.strictEqual(isItemVoided("[Harga: 1000]"), false)
})

console.log("\nPASS " + pass + "/10")
