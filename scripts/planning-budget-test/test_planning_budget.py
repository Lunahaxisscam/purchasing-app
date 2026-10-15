#!/usr/bin/env python3
"""
Test Suite: Kalkulasi Budgeting & Deteksi Anomali Upah WBS (Noir Living)
========================================================================
Path: /home/ubuntu/purchasing-app/scripts/planning-budget-test/test_planning_budget.py
Format Log: [TIMESTAMP] [LEVEL] [MODULE] - PESAN

Kebutuhan Bisnis DAT:
- Budgeting patokan historis:
    * Material    = 50% max
    * Manpower    = 25% max
    * Operasional = 10%
    * Margin      = 15%
- Formula: Revenue dikalikan persentase di atas.
- Anomali: jika estimasi upah WBS melebihi 25% dari revenue proyek.
- Pagu Total: 50% + 25% + 10% + 15% = 100%.

Skenario Pengujian:
  a) Normal: Revenue Rp 100.000.000, Labor WBS Rp 20.000.000 (20%) -> Status OK / On-Track.
  b) Anomali: Revenue Rp 100.000.000, Labor WBS Rp 30.000.000 (30%) -> Anomali terdeteksi (+Rp 5.000.000 over-budget).
  c) Zero Revenue: Proyek baru tanpa revenue -> Tampilkan fallback aman tanpa NaN / ZeroDivisionError.
  d) Pagu Total: 50% + 25% + 10% + 15% = 100%.
"""

import math
import sys
from datetime import datetime

# ============================================================================
# 1. KONFIGURASI DAN PATOKAN HISTORIS BUDGETING (NOIR LIVING)
# ============================================================================

HISTORICAL_BUDGET_RATIOS = {
    "material": 0.50,      # 50% max
    "manpower": 0.25,      # 25% max (Pagu maksimal upah tukang / WBS)
    "operasional": 0.10,   # 10%
    "margin": 0.15,        # 15% target profit margin
}

MODULE_NAME = "PLANNING_BUDGET"


# ============================================================================
# 2. LOGGING TERSTRUKTUR & MUDAH DI-TRACE
#    Format: [TIMESTAMP] [LEVEL] [MODULE] - PESAN
# ============================================================================

def log(level: str, module: str, message: str) -> None:
    """Format log standar: [TIMESTAMP] [LEVEL] [MODULE] - PESAN"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] [{level.upper():<5}] [{module}] - {message}")


# ============================================================================
# 3. HELPER FORMULA BISNIS & FORMATTING
# ============================================================================

def format_rupiah(value: float | int | None) -> str:
    """Format nominal angka ke representasi Rupiah Indonesia yang rapi."""
    if value is None:
        return "Rp 0"
    val_int = int(round(value))
    is_neg = val_int < 0
    formatted = f"{abs(val_int):,}".replace(",", ".")
    return f"-Rp {formatted}" if is_neg else f"Rp {formatted}"


def calculate_budget_allocation(revenue: float | int | None) -> dict:
    """
    Menghitung alokasi pagu anggaran berdasarkan patokan historis:
    - Material = 50%
    - Manpower = 25%
    - Operasional = 10%
    - Margin = 15%
    Total pagu = 100% dari revenue.
    """
    rev = float(revenue) if revenue is not None else 0.0
    if rev < 0:
        rev = 0.0

    allocations = {}
    for cat, ratio in HISTORICAL_BUDGET_RATIOS.items():
        nominal = rev * ratio
        allocations[cat] = {
            "ratio": ratio,
            "percentage_str": f"{ratio * 100:.1f}%",
            "nominal": nominal,
            "nominal_str": format_rupiah(nominal)
        }

    total_ratio = sum(HISTORICAL_BUDGET_RATIOS.values())
    total_pagu = rev * total_ratio

    return {
        "revenue": rev,
        "revenue_str": format_rupiah(rev),
        "allocations": allocations,
        "total_ratio": total_ratio,
        "total_pagu": total_pagu,
        "total_pagu_str": format_rupiah(total_pagu)
    }


def analyze_labor_budget(revenue: float | int | None, labor_wbs: float | int | None) -> dict:
    """
    Evaluasi estimasi upah WBS terhadap batas maksimal manpower (25% dari revenue).
    Menghindari NaN atau ZeroDivisionError jika revenue adalah 0 (proyek baru).
    """
    rev = float(revenue) if revenue is not None else 0.0
    if rev < 0:
        rev = 0.0

    labor = float(labor_wbs) if labor_wbs is not None else 0.0
    if labor < 0:
        labor = 0.0

    max_labor_budget = rev * HISTORICAL_BUDGET_RATIOS["manpower"]

    # Penanganan safe ratio: hindari ZeroDivisionError dan float('nan')
    if rev > 0:
        ratio = labor / rev
        ratio_pct = ratio * 100.0
        ratio_str = f"{ratio_pct:.1f}%"
    else:
        ratio = 0.0
        ratio_pct = 0.0
        ratio_str = "0.0% (N/A - Zero Revenue)"

    diff = labor - max_labor_budget
    is_over_budget = labor > max_labor_budget if rev > 0 else (labor > 0)

    # Penentuan status bisnis
    if rev <= 0:
        if labor > 0:
            status = "ANOMALY_NO_REVENUE"
            status_label = f"Anomali: Proyek tanpa revenue memiliki estimasi upah {format_rupiah(labor)}"
        else:
            status = "ZERO_REVENUE_FALLBACK"
            status_label = "Status OK: Proyek baru tanpa revenue (Fallback aman tanpa NaN)"
    elif is_over_budget:
        status = "ANOMALY_OVER_BUDGET"
        status_label = f"Anomali terdeteksi (+{format_rupiah(diff)} over-budget)"
    else:
        status = "ON_TRACK"
        status_label = "Status OK / On-Track"

    return {
        "revenue": rev,
        "revenue_str": format_rupiah(rev),
        "labor_wbs": labor,
        "labor_wbs_str": format_rupiah(labor),
        "max_labor_budget": max_labor_budget,
        "max_labor_budget_str": format_rupiah(max_labor_budget),
        "ratio": ratio,
        "ratio_pct": ratio_pct,
        "ratio_str": ratio_str,
        "diff": diff,
        "diff_str": f"+{format_rupiah(diff)}" if diff > 0 else format_rupiah(diff),
        "is_over_budget": is_over_budget,
        "status": status,
        "status_label": status_label
    }


# ============================================================================
# 4. SKENARIO PENGUJIAN TERSTRUKTUR
# ============================================================================

def test_scenario_a_normal() -> bool:
    """
    Skenario a) Normal:
    Revenue Rp 100.000.000, Labor WBS Rp 20.000.000 (20%) -> Status OK / On-Track.
    """
    mod = f"{MODULE_NAME}_A"
    log("INFO", mod, "Menjalankan Skenario a) Normal (Revenue Rp 100jt, Labor Rp 20jt)...")

    revenue = 100_000_000
    labor_wbs = 20_000_000

    result = analyze_labor_budget(revenue, labor_wbs)

    log("INFO", mod, f"Input  : Revenue = {result['revenue_str']}, Labor WBS = {result['labor_wbs_str']}")
    log("INFO", mod, f"Target : Pagu Manpower (25%) = {result['max_labor_budget_str']}")
    log("INFO", mod, f"Rasio  : {result['ratio_str']} dari revenue")
    log("INFO", mod, f"Status : {result['status_label']}")

    # Verifikasi assertions
    assert result["revenue"] == 100_000_000, "Revenue harus 100.000.000"
    assert result["labor_wbs"] == 20_000_000, "Labor WBS harus 20.000.000"
    assert result["max_labor_budget"] == 25_000_000, "Pagu 25% harus 25.000.000"
    assert math.isclose(result["ratio_pct"], 20.0, abs_tol=1e-5), "Rasio harus tepat 20.0%"
    assert result["is_over_budget"] is False, "Tidak boleh over-budget"
    assert result["status"] == "ON_TRACK", "Status harus ON_TRACK"
    assert "Status OK / On-Track" in result["status_label"], "Label harus memuat 'Status OK / On-Track'"

    log("INFO", mod, "✓ Skenario a) LULUS: Kalkulasi normal tepat 20% dan berstatus OK / On-Track.")
    return True


def test_scenario_b_anomaly() -> bool:
    """
    Skenario b) Anomali:
    Revenue Rp 100.000.000, Labor WBS Rp 30.000.000 (30%) -> Anomali terdeteksi (+Rp 5.000.000 over-budget).
    """
    mod = f"{MODULE_NAME}_B"
    log("INFO", mod, "Menjalankan Skenario b) Anomali (Revenue Rp 100jt, Labor Rp 30jt)...")

    revenue = 100_000_000
    labor_wbs = 30_000_000

    result = analyze_labor_budget(revenue, labor_wbs)

    log("WARN", mod, f"Input  : Revenue = {result['revenue_str']}, Labor WBS = {result['labor_wbs_str']}")
    log("WARN", mod, f"Target : Pagu Manpower (25%) = {result['max_labor_budget_str']}")
    log("WARN", mod, f"Rasio  : {result['ratio_str']} (Melebihi batas 25.0%)")
    log("WARN", mod, f"Selisih: {result['diff_str']}")
    log("WARN", mod, f"Status : {result['status_label']}")

    # Verifikasi assertions
    assert result["revenue"] == 100_000_000, "Revenue harus 100.000.000"
    assert result["labor_wbs"] == 30_000_000, "Labor WBS harus 30.000.000"
    assert result["max_labor_budget"] == 25_000_000, "Pagu 25% harus 25.000.000"
    assert math.isclose(result["ratio_pct"], 30.0, abs_tol=1e-5), "Rasio harus tepat 30.0%"
    assert result["is_over_budget"] is True, "Harus terdeteksi over-budget"
    assert result["diff"] == 5_000_000, "Selisih over-budget harus tepat Rp 5.000.000"
    assert result["status"] == "ANOMALY_OVER_BUDGET", "Status harus ANOMALY_OVER_BUDGET"
    assert "+Rp 5.000.000 over-budget" in result["status_label"], "Label harus memuat '+Rp 5.000.000 over-budget'"

    log("INFO", mod, "✓ Skenario b) LULUS: Anomali terdeteksi akurat (+Rp 5.000.000 over-budget).")
    return True


def test_scenario_c_zero_revenue() -> bool:
    """
    Skenario c) Zero Revenue:
    Proyek baru tanpa revenue -> Tampilkan fallback aman tanpa NaN / ZeroDivisionError.
    """
    mod = f"{MODULE_NAME}_C"
    log("INFO", mod, "Menjalankan Skenario c) Zero Revenue (Proyek baru tanpa revenue)...")

    # Uji proyek baru awal: revenue = 0, labor = 0
    revenue_zero = 0
    labor_zero = 0

    result = analyze_labor_budget(revenue_zero, labor_zero)

    log("INFO", mod, f"Kasus 1: Revenue = {result['revenue_str']}, Labor WBS = {result['labor_wbs_str']}")
    log("INFO", mod, f"Rasio  : {result['ratio_str']}")
    log("INFO", mod, f"Status : {result['status_label']}")

    # Verifikasi assertions pencegahan NaN & crash
    assert not math.isnan(result["ratio"]), "Ratio numerik tidak boleh bernilai NaN"
    assert not math.isnan(result["ratio_pct"]), "Ratio percentage tidak boleh bernilai NaN"
    assert "NaN" not in result["ratio_str"], "Representasi string ratio tidak boleh memuat 'NaN'"
    assert "nan" not in result["ratio_str"].lower(), "Representasi string ratio tidak boleh memuat 'nan'"
    assert result["status"] == "ZERO_REVENUE_FALLBACK", "Status proyek baru harus ZERO_REVENUE_FALLBACK"

    # Uji proyek dengan None revenue
    result_none = analyze_labor_budget(None, None)
    assert not math.isnan(result_none["ratio"]), "Input None tidak boleh menghasilkan NaN"
    assert result_none["revenue"] == 0.0, "Revenue None harus di-fallback ke 0.0"

    # Uji proyek baru belum ada revenue tapi ada estimasi upah awal Rp 5jt (harus ditangani aman)
    result_with_labor = analyze_labor_budget(0, 5_000_000)
    log("WARN", mod, f"Kasus 2: Revenue = Rp 0, Labor WBS = {result_with_labor['labor_wbs_str']} -> {result_with_labor['status_label']}")
    assert not math.isnan(result_with_labor["ratio"]), "Tidak boleh NaN meski labor > 0 pada zero revenue"
    assert result_with_labor["status"] == "ANOMALY_NO_REVENUE", "Harus terdeteksi anomali jika ada upah tanpa revenue"

    log("INFO", mod, "✓ Skenario c) LULUS: Fallback zero revenue aman, tidak ada NaN atau exception.")
    return True


def test_scenario_d_pagu_total() -> bool:
    """
    Skenario d) Pagu Total:
    50% + 25% + 10% + 15% = 100%.
    Verifikasi integritas alokasi pagu historis DAT.
    """
    mod = f"{MODULE_NAME}_D"
    log("INFO", mod, "Menjalankan Skenario d) Pagu Total (50% + 25% + 10% + 15% = 100%)...")

    material_pct = HISTORICAL_BUDGET_RATIOS["material"]
    manpower_pct = HISTORICAL_BUDGET_RATIOS["manpower"]
    operasional_pct = HISTORICAL_BUDGET_RATIOS["operasional"]
    margin_pct = HISTORICAL_BUDGET_RATIOS["margin"]

    total_pct = material_pct + manpower_pct + operasional_pct + margin_pct
    log("INFO", mod, f"Komposisi: Material={material_pct*100:.0f}%, Manpower={manpower_pct*100:.0f}%, Operasional={operasional_pct*100:.0f}%, Margin={margin_pct*100:.0f}%")
    log("INFO", mod, f"Total Persentase: {total_pct * 100:.1f}%")

    assert math.isclose(total_pct, 1.0, abs_tol=1e-7), f"Total persentase harus 1.0 (100%), hasil: {total_pct}"

    # Verifikasi kalkulasi nominal pada proyek Rp 100.000.000
    rev = 100_000_000
    budget = calculate_budget_allocation(rev)

    mat_nom = budget["allocations"]["material"]["nominal"]
    man_nom = budget["allocations"]["manpower"]["nominal"]
    ops_nom = budget["allocations"]["operasional"]["nominal"]
    mar_nom = budget["allocations"]["margin"]["nominal"]

    log("INFO", mod, f"Nominal pada Revenue {budget['revenue_str']}:")
    log("INFO", mod, f"  * Material    (50%) : {budget['allocations']['material']['nominal_str']}")
    log("INFO", mod, f"  * Manpower    (25%) : {budget['allocations']['manpower']['nominal_str']}")
    log("INFO", mod, f"  * Operasional (10%) : {budget['allocations']['operasional']['nominal_str']}")
    log("INFO", mod, f"  * Margin      (15%) : {budget['allocations']['margin']['nominal_str']}")
    log("INFO", mod, f"  * Total Pagu (100%) : {budget['total_pagu_str']}")

    assert mat_nom == 50_000_000, "Material 50% dari 100jt harus Rp 50jt"
    assert man_nom == 25_000_000, "Manpower 25% dari 100jt harus Rp 25jt"
    assert ops_nom == 10_000_000, "Operasional 10% dari 100jt harus Rp 10jt"
    assert mar_nom == 15_000_000, "Margin 15% dari 100jt harus Rp 15jt"
    assert (mat_nom + man_nom + ops_nom + mar_nom) == rev, "Jumlah nominal harus sama dengan revenue 100jt"
    assert budget["total_pagu"] == rev, "Total pagu harus sama dengan revenue"

    log("INFO", mod, "✓ Skenario d) LULUS: Total pagu tepat 100% dan teralokasi sempurna.")
    return True


# ============================================================================
# 5. ENTRY POINT & EXECUTION RUNNER
# ============================================================================

def main():
    log("INFO", MODULE_NAME, "================================================================")
    log("INFO", MODULE_NAME, "MEMULAI TEST SUITE: KALKULASI BUDGETING & DETEKSI ANOMALI WBS")
    log("INFO", MODULE_NAME, "Standar Bisnis: Noir Living (DAT)")
    log("INFO", MODULE_NAME, "================================================================")

    scenarios = [
        ("Skenario a) Normal", test_scenario_a_normal),
        ("Skenario b) Anomali", test_scenario_b_anomaly),
        ("Skenario c) Zero Revenue", test_scenario_c_zero_revenue),
        ("Skenario d) Pagu Total 100%", test_scenario_d_pagu_total),
    ]

    passed = 0
    failed = 0

    for name, test_fn in scenarios:
        try:
            success = test_fn()
            if success:
                passed += 1
            else:
                failed += 1
                log("ERROR", MODULE_NAME, f"✗ {name} GAGAL (Return False)")
        except AssertionError as err:
            failed += 1
            log("ERROR", MODULE_NAME, f"✗ {name} GAGAL Assertion: {err}")
        except Exception as err:
            failed += 1
            log("ERROR", MODULE_NAME, f"✗ {name} ERROR Tidak Terduga: {err}")

    log("INFO", MODULE_NAME, "================================================================")
    log("INFO", MODULE_NAME, f"RINGKASAN HASIL TEST: {passed} LULUS, {failed} GAGAL (Total {len(scenarios)})")

    if failed == 0:
        log("INFO", MODULE_NAME, "STATUS AKHIR: SEMUA SKENARIO LULUS (EXIT CODE 0)")
        log("INFO", MODULE_NAME, "================================================================")
        sys.exit(0)
    else:
        log("ERROR", MODULE_NAME, "STATUS AKHIR: TERDAPAT SKENARIO GAGAL (EXIT CODE 1)")
        log("INFO", MODULE_NAME, "================================================================")
        sys.exit(1)


if __name__ == "__main__":
    main()
