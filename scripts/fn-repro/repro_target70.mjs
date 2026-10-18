// Reproduksi klaim audit FN-TARGET70 sebelum memperbaiki apa pun.
// Dijalankan: node scripts/fn-repro/repro_target70.mjs
const cases = [43300000, 99999999.99, 1, 0, 250000, 1234567.89]

function old(revenue) { return Math.round(revenue * 70) / 100 }
function proposed(revenue) { return Math.round(revenue * 0.7) }
function twoDec(revenue) { return Math.round(revenue * 0.7 * 100) / 100 }

console.log('rev'.padEnd(16), 'lama round(rev*70)/100'.padEnd(26), 'usul round(rev*0.7)'.padEnd(22), '2desimal')
for (const r of cases) {
  console.log(String(r).padEnd(16), String(old(r)).padEnd(26), String(proposed(r)).padEnd(22), String(twoDec(r)))
}
console.log('\nKlaim REVIEW-03: rev=43.300.000 -> 30309999.999999996 ?', old(43300000), old(43300000) === 30309999.999999996 ? 'REPRODUCE' : 'TIDAK REPRODUCE')
console.log('raw rev*0.7 untuk 43.300.000 =', 43300000 * 0.7)
console.log('raw rev*70/100 untuk 43.300.000 =', 43300000 * 70 / 100)
console.log('rev*0.7 desimal 99.999.999,99 =', 99999999.99 * 0.7)
