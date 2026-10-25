// ============================================================
// lib/money.js — ARITMETIKA UANG YANG TIDAK "BERBISIK" (FN-TARGET70)
// ============================================================
// Temuan audit FN-TARGET70 (REVIEW-03, LOW) menyebut target 70% memakai
// `Math.round(revenue * 70) / 100` dan bisa menghasilkan
// 30309999.999999996.
//
// Reproduksi jujur (scripts/fn-repro/repro_target70.mjs):
//   - revenue 43.300.000 (rupiah bulat): round(rev*70)/100 = 30.310.000
//     TEPAT. Angka 30309999.999999996 berasal dari `revenue * 0.7`
//     (perkalian 0,7), BUKAN dari formula yang dipakai kode.
//   - Jadi klaim "revenue bulat menghasilkan 30309999,999999996" TIDAK
//     ter-reproduksi pada kode saat itu.
//   - Yang BENAR-BENAR cacat: pembagian /100 menyisakan pecahan sen
//     untuk revenue DESIMAL (99.999.999,99 -> 69.999.999,99). Nilai
//     pecahan itu ikut dipakai membandingkan HEMAT/OVER-BUDGET dan bisa
//     tersimpan ke snapshot project_closings.target_budget (NUMERIC),
//     sementara layar menampilkan rupiah bulat — layar dan keputusan
//     memakai angka berbeda.
//
// Perbaikan: hitung 70% sebagai 7/10 lalu bulatkan SEKALI ke rupiah
// utuh. Hasilnya selalu bilangan bulat rupiah, sama dengan yang
// ditampilkan, dan tidak ada artefak float yang tersisa di perbandingan
// maupun di snapshot.
// ============================================================

// Persentase target biaya standar Noir Living (SOP Budgeting 4-Pilar:
// biaya maksimum 70% dari nilai kontrak).
export const TARGET_COST_RATIO = 0.7

// Target biaya = 70% x revenue, dibulatkan ke rupiah utuh.
//
// `revenue * 7 / 10` dipakai (bukan `revenue * 0.7`) karena 0,7 tidak
// bisa direpresentasikan tepat di biner: 43.300.000 * 0.7 =
// 30309999.999999996, sedangkan 43.300.000 * 7 = 303.100.000 (eksak)
// lalu / 10 = 30.310.000 (eksak).
export function targetBudget70(revenue) {
  const r = Number(revenue)
  if (!isFinite(r) || r <= 0) return 0
  return Math.round(r * 7 / 10)
}

// Pembulatan rupiah utuh untuk nilai uang lain (material, upah, margin).
// Dipakai supaya perbandingan HEMAT/OVER selalu membandingkan angka yang
// sama dengan yang dicetak di layar/dokumen.
export function toRupiah(value) {
  const n = Number(value)
  if (!isFinite(n)) return 0
  return Math.round(n)
}

// Perbandingan terhadap pagu: memakai angka rupiah utuh di kedua sisi.
// `null` dikembalikan bila revenue belum ada — "belum bisa dinilai",
// bukan "hemat".
export function costVsTarget70({ revenue, cost }) {
  const rev = Number(revenue)
  if (!isFinite(rev) || rev <= 0) return null
  const target = targetBudget70(rev)
  const spent = toRupiah(cost)
  return {
    target,
    spent,
    underBudget: spent <= target,
    remaining: target - spent
  }
}
