/* Display adapter only. Never writes, finalizes, or changes a totalan snapshot. */
(function (root) {
  'use strict';
  const number = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
  const present = (v) => v !== null && v !== undefined && v !== '';
  function summary(t) {
    const opening = number(t.openingAdjustment);
    const carriedAmount = number(t.carriedResidual);
    const carried = t.final === true && carriedAmount !== 0;
    const ending = carried
      ? (present(t.residualBeforeCarry) ? number(t.residualBeforeCarry) : carriedAmount)
      : number(t.saldoAkhir);
    return { opening, ending, carried, net: number(t.hakBersih),
      status: carried && ending !== 0 ? 'Selesai / Ditutup' : (t.status || 'Perlu cek') };
  }
  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render(t, d, helpers) {
    const { money, date, projectTotal } = helpers;
    const v = summary(t);
    const amount = n => escape(money(number(n)));
    const projects = (t.projectIds || []).map(id => {
      const p = (d.projects || []).find(p => p.id === id);
      return '<tr><td>' + escape(p ? p.name : 'Proyek tidak ditemukan') + '</td><td class="num">' + amount(projectTotal(id)) + '</td></tr>';
    });
    const kasbon = [...(t.potonganDetail || [])].sort((a,b) => String(a.tanggal || '').localeCompare(String(b.tanggal || ''))).map(k => '<tr><td>' + escape(k.tanggal ? date(k.tanggal) : '—') + '</td><td>' + escape(k.deskripsi || 'Kasbon') + '</td><td class="num">' + amount(k.nominal) + '</td></tr>');
    const period = t.periode || t.period || (t.periodeMulai && t.periodeSelesai ? date(t.periodeMulai) + ' — ' + date(t.periodeSelesai) : 'Tidak tercatat');
    const row = (label, n, strong) => '<div class="history-amount' + (strong ? ' emphasis' : '') + '"><span>' + label + '</span><b>' + amount(n) + '</b></div>';
    return '<article class="history-document" data-history-id="' + escape(t.id) + '">' +
      '<div class="history-header"><div><h3>' + escape(t.no) + ' <span>/</span> ' + escape(d.name) + '</h3><p>Dicatat ' + escape(date(t.tanggal)) + ' · Periode: ' + escape(period) + '</p></div>' +
      '<div class="history-actions"><span class="badge ' + (v.carried ? 'grey' : t.status === 'Lunas' ? 'lunas' : 'cek') + '">' + escape(v.status) + '</span>' + (t.final ? '<span class="badge grey">Final · Dikunci</span>' : '') +
      '<button type="button" class="small" data-slip="' + escape(t.id) + '">Lihat / cetak slip</button></div></div>' +
      '<div class="history-columns"><div class="history-panel"><h4>Upah / Pekerjaan</h4><p class="note">' + projects.length + ' proyek · nilai per proyek</p>' +
      '<div class="history-scroll" tabindex="0" role="region" aria-label="Rincian upah per proyek"><table><thead><tr><th>Proyek</th><th class="num">Upah bruto</th></tr></thead><tbody>' + (projects.join('') || '<tr><td colspan="2">Tidak ada proyek.</td></tr>') + '</tbody></table></div>' +
      row('Total upah bruto', t.totalUpah, true) + '</div>' +
      '<div class="history-panel"><h4>Kasbon dipotong</h4><p class="note">' + kasbon.length + ' transaksi · gulir untuk seluruh rincian</p>' +
      '<div class="history-scroll" tabindex="0" role="region" aria-label="Rincian kasbon dipotong"><table><thead><tr><th>Tanggal</th><th>Uraian</th><th class="num">Nominal</th></tr></thead><tbody>' + (kasbon.join('') || '<tr><td colspan="3">Tidak ada kasbon dipotong.</td></tr>') + '</tbody></table></div>' +
      row('Total kasbon', t.kasbonDipotong, true) + '</div></div>' +
      '<div class="history-settlement"><h4>Ringkasan penyelesaian</h4><div class="history-equation">' + row('Upah bruto', t.totalUpah) + row('Saldo awal (+ / −)', v.opening) + row('− Kasbon dipotong', t.kasbonDipotong) + row('= Hak bersih', v.net, true) + row('− Pembayaran aktual (tunai / transfer)', t.pembayaranAktual) + row('= Saldo akhir', v.ending, true) + '</div>' +
      (v.carried ? '<p class="history-carry">Dibawa ke totalan berikutnya: <b>' + amount(t.carriedResidual) + '</b></p>' : '') +
      '<p class="note">Saldo awal positif menambah hak; negatif mengurangi hak. Angka mengikuti dokumen tersimpan.</p></div></article>';
  }
  const api = { summary, render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.UpahTotalanHistory = api;
})(typeof window !== 'undefined' ? window : globalThis);
