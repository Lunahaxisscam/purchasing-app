#!/usr/bin/env python3
"""
Test Suite: Kalkulasi 4-Pilar Budgeting & Deteksi Anomali Multi-Pos (Noir Living)
================================================================================
Path: /home/ubuntu/purchasing-app/scripts/planning-budget-test/test_planning_budget.py
Format Log: [TIMESTAMP] [LEVEL] [MODULE] - PESAN

Kebutuhan Bisnis DAT (Noir Living):
- Patokan Historis 4-Pilar Anggaran:
    * Material    = 50% max (Pagu maksimal belanja material)
    * Manpower    = 25% max (Pagu maksimal upah tukang / WBS)
    * Operasional = 10% max (Pagu maksimal petty cash & overhead lapangan)
    * Target Margin = 15% min (Target profit margin riil perusahaan)
- Total Pagu: 50% + 25% + 10% + 15% = 100% dari Revenue Kontrak.
- Formula & Deteksi Anomali Multi-Pos:
    * Anomali Material    : Belanja material > 50% revenue
    * Anomali Manpower    : Upah WBS > 25% revenue
    * Anomali Operasional : Petty cash > 10% revenue
    * Margin Tergerus     : Margin riil < 15% revenue
                            (Margin riil = Revenue - Total Biaya riil)
    * Proyek Sehat        : Semua pos pengeluaran on-track dan margin riil >= 15%
    * Zero Revenue        : Penanganan fallback aman tanpa NaN / ZeroDivisionError

Skenario Pengujian:
  1) Skenario Anomali Material: Belanja material > 50% revenue.
  2) Skenario Anomali Manpower: Upah WBS > 25% revenue.
  3) Skenario Anomali Operasional: Petty cash > 10% revenue.
  4) Skenario Margin Tergerus: Margin riil < 15% revenue.
  5) Skenario Proyek Sehat: Semua pos on-track dalam batas pagu.
  6) Skenario Multi-Pos Anomali: Kombinasi anomali multi-pos simultan.
  7) Skenario Zero Revenue Fallback: Proyek baru tanpa revenue aman dari NaN.
  8) Skenario Integritas Pagu Total: 50% + 25% + 10% + 15% = 100%.
"""

import math
import sys
from datetime import datetime

# ============================================================================
# 1. KONFIGURASI DAN PATOKAN HISTORIS BUDGETING (NOIR LIVING)
# ============================================================================

HISTORICAL_BUDGET_RATIOS = {
    "material": 0.50,      # 50% max (Pagu belanja material pengadaan)
    "manpower": 0.25,      # 25% max (Pagu upah tenaga kerja / WBS)
    "operasional": 0.10,   # 10% max (Pagu petty cash & overhead)
    "margin": 0.15,        # 15% min (Target profit margin riil)
}

MODULE_NAME = "PLANNING_BUDGET"


# ============================================================================
# 2. LOGGING TERSTRUKTUR & AUDIT-READY
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
    Menghitung alokasi pagu anggaran berdasarkan patokan historis DAT:
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


def evaluate_4pillar_budget(
    revenue: float | int | None,
    material: float | int | None = 0,
    manpower: float | int | None = 0,
    operasional: float | int | None = 0
) -> dict:
    """
    Evaluasi komprehensif 4-Pilar Anggaran & Deteksi Anomali Multi-Pos:
    1. Material: Max 50% dari revenue. Anomali jika actual material > 50% revenue.
    2. Manpower: Max 25% dari revenue. Anomali jika actual labor WBS > 25% revenue.
    3. Operasional: Max 10% dari revenue. Anomali jika actual petty cash > 10% revenue.
    4. Margin Riil: Min 15% dari revenue. Anomali jika margin riil < 15% revenue.
       Formula Margin Riil = Revenue - (Material + Manpower + Operasional).
    
    Penanganan Zero Revenue:
    - Menghindari NaN dan ZeroDivisionError jika revenue == 0.
    """
    rev = float(revenue) if revenue is not None else 0.0
    if rev < 0:
        rev = 0.0

    mat = float(material) if material is not None else 0.0
    if mat < 0:
        mat = 0.0

    man = float(manpower) if manpower is not None else 0.0
    if man < 0:
        man = 0.0

    ops = float(operasional) if operasional is not None else 0.0
    if ops < 0:
        ops = 0.0

    # Plafon nominal berdasarkan rasio patokan historis
    cap_material = rev * HISTORICAL_BUDGET_RATIOS["material"]
    cap_manpower = rev * HISTORICAL_BUDGET_RATIOS["manpower"]
    cap_operasional = rev * HISTORICAL_BUDGET_RATIOS["operasional"]
    target_margin = rev * HISTORICAL_BUDGET_RATIOS["margin"]

    # Total pengeluaran aktual & margin riil
    total_cost = mat + man + ops
    real_margin = rev - total_cost

    anomalies = []

    # Penanganan safe ratio (hindari ZeroDivisionError / NaN)
    if rev > 0:
        ratio_mat = mat / rev
        ratio_man = man / rev
        ratio_ops = ops / rev
        ratio_margin = real_margin / rev
        ratio_total_cost = total_cost / rev

        # Deteksi anomali per pos
        is_mat_anomaly = mat > cap_material
        is_man_anomaly = man > cap_manpower
        is_ops_anomaly = ops > cap_operasional
        is_margin_eroded = real_margin < target_margin

        mat_over = max(0.0, mat - cap_material)
        man_over = max(0.0, man - cap_manpower)
        ops_over = max(0.0, ops - cap_operasional)
        margin_deficit = max(0.0, target_margin - real_margin)

        if is_mat_anomaly:
            anomalies.append({
                "pos": "MATERIAL",
                "label": "Anomali Belanja Material",
                "actual": mat,
                "cap": cap_material,
                "actual_pct": ratio_mat * 100.0,
                "cap_pct": 50.0,
                "diff": mat_over,
                "message": f"Belanja material ({format_rupiah(mat)} / {ratio_mat*100.0:.1f}%) melebihi pagu 50% (+{format_rupiah(mat_over)})"
            })

        if is_man_anomaly:
            anomalies.append({
                "pos": "MANPOWER",
                "label": "Anomali Upah WBS",
                "actual": man,
                "cap": cap_manpower,
                "actual_pct": ratio_man * 100.0,
                "cap_pct": 25.0,
                "diff": man_over,
                "message": f"Upah WBS ({format_rupiah(man)} / {ratio_man*100.0:.1f}%) melebihi pagu 25% (+{format_rupiah(man_over)})"
            })

        if is_ops_anomaly:
            anomalies.append({
                "pos": "OPERASIONAL",
                "label": "Anomali Operasional",
                "actual": ops,
                "cap": cap_operasional,
                "actual_pct": ratio_ops * 100.0,
                "cap_pct": 10.0,
                "diff": ops_over,
                "message": f"Petty cash operasional ({format_rupiah(ops)} / {ratio_ops*100.0:.1f}%) melebihi pagu 10% (+{format_rupiah(ops_over)})"
            })

        if is_margin_eroded:
            anomalies.append({
                "pos": "MARGIN",
                "label": "Anomali Margin Tergerus",
                "actual": real_margin,
                "cap": target_margin,
                "actual_pct": ratio_margin * 100.0,
                "cap_pct": 15.0,
                "diff": margin_deficit,
                "message": f"Margin riil ({format_rupiah(real_margin)} / {ratio_margin*100.0:.1f}%) tergerus di bawah target 15% (defisit {format_rupiah(margin_deficit)})"
            })

        if len(anomalies) == 0:
            status = "PROYEK_SEHAT"
            status_label = "Proyek Sehat: Semua pos on-track dalam batas pagu & target margin aman"
        else:
            status = "ANOMALI_TERDETEKSI"
            pos_names = ", ".join([a["pos"] for a in anomalies])
            status_label = f"Anomali Terdeteksi pada {len(anomalies)} pos ({pos_names})"

    else:
        # Kasus Revenue <= 0
        ratio_mat = 0.0
        ratio_man = 0.0
        ratio_ops = 0.0
        ratio_margin = 0.0
        ratio_total_cost = 0.0

        is_mat_anomaly = mat > 0
        is_man_anomaly = man > 0
        is_ops_anomaly = ops > 0
        is_margin_eroded = total_cost > 0

        mat_over = mat
        man_over = man
        ops_over = ops
        margin_deficit = total_cost

        if total_cost > 0:
            status = "ANOMALY_NO_REVENUE"
            status_label = f"Anomali: Proyek tanpa revenue memiliki pengeluaran {format_rupiah(total_cost)}"
            anomalies.append({
                "pos": "TOTAL_COST",
                "label": "Pengeluaran Tanpa Revenue",
                "actual": total_cost,
                "cap": 0.0,
                "actual_pct": 0.0,
                "cap_pct": 0.0,
                "diff": total_cost,
                "message": f"Pengeluaran tercatat {format_rupiah(total_cost)} pada proyek tanpa revenue"
            })
        else:
            status = "ZERO_REVENUE_FALLBACK"
            status_label = "Status OK: Proyek baru tanpa revenue (Fallback aman tanpa NaN)"

    return {
        "revenue": rev,
        "revenue_str": format_rupiah(rev),
        "material": {
            "actual": mat,
            "actual_str": format_rupiah(mat),
            "cap": cap_material,
            "cap_str": format_rupiah(cap_material),
            "ratio": ratio_mat,
            "ratio_pct": ratio_mat * 100.0,
            "ratio_str": f"{ratio_mat * 100.0:.1f}%" if rev > 0 else "0.0% (Zero Revenue)",
            "is_anomaly": is_mat_anomaly,
            "over": mat_over,
            "over_str": f"+{format_rupiah(mat_over)}" if mat_over > 0 else format_rupiah(mat_over)
        },
        "manpower": {
            "actual": man,
            "actual_str": format_rupiah(man),
            "cap": cap_manpower,
            "cap_str": format_rupiah(cap_manpower),
            "ratio": ratio_man,
            "ratio_pct": ratio_man * 100.0,
            "ratio_str": f"{ratio_man * 100.0:.1f}%" if rev > 0 else "0.0% (Zero Revenue)",
            "is_anomaly": is_man_anomaly,
            "over": man_over,
            "over_str": f"+{format_rupiah(man_over)}" if man_over > 0 else format_rupiah(man_over)
        },
        "operasional": {
            "actual": ops,
            "actual_str": format_rupiah(ops),
            "cap": cap_operasional,
            "cap_str": format_rupiah(cap_operasional),
            "ratio": ratio_ops,
            "ratio_pct": ratio_ops * 100.0,
            "ratio_str": f"{ratio_ops * 100.0:.1f}%" if rev > 0 else "0.0% (Zero Revenue)",
            "is_anomaly": is_ops_anomaly,
            "over": ops_over,
            "over_str": f"+{format_rupiah(ops_over)}" if ops_over > 0 else format_rupiah(ops_over)
        },
        "margin": {
            "target": target_margin,
            "target_str": format_rupiah(target_margin),
            "target_pct": 15.0,
            "real": real_margin,
            "real_str": format_rupiah(real_margin),
            "real_pct": ratio_margin * 100.0,
            "real_pct_str": f"{ratio_margin * 100.0:.1f}%" if rev > 0 else "0.0% (Zero Revenue)",
            "is_eroded": is_margin_eroded,
            "deficit": margin_deficit,
            "deficit_str": f"-{format_rupiah(margin_deficit)}" if margin_deficit > 0 else format_rupiah(0)
        },
        "total_cost": total_cost,
        "total_cost_str": format_rupiah(total_cost),
        "total_cost_pct": ratio_total_cost * 100.0,
        "total_cost_pct_str": f"{ratio_total_cost * 100.0:.1f}%" if rev > 0 else "0.0% (Zero Revenue)",
        "anomalies": anomalies,
        "anomaly_count": len(anomalies),
        "has_anomaly": len(anomalies) > 0,
        "is_healthy": (rev > 0 and len(anomalies) == 0),
        "status": status,
        "status_label": status_label
    }


def analyze_labor_budget(revenue: float | int | None, labor_wbs: float | int | None) -> dict:
    """
    Evaluasi estimasi upah WBS terhadap batas maksimal manpower (25% dari revenue).
    Fungsi legacy yang kompatibel dengan modul Planning.
    """
    eval_result = evaluate_4pillar_budget(revenue=revenue, manpower=labor_wbs)
    man_data = eval_result["manpower"]
    rev = eval_result["revenue"]
    labor = man_data["actual"]
    max_labor_budget = man_data["cap"]
    diff = labor - max_labor_budget

    if rev <= 0:
        if labor > 0:
            status = "ANOMALY_NO_REVENUE"
            status_label = f"Anomali: Proyek tanpa revenue memiliki estimasi upah {format_rupiah(labor)}"
        else:
            status = "ZERO_REVENUE_FALLBACK"
            status_label = "Status OK: Proyek baru tanpa revenue (Fallback aman tanpa NaN)"
    elif man_data["is_anomaly"]:
        status = "ANOMALY_OVER_BUDGET"
        status_label = f"Anomali terdeteksi (+{format_rupiah(man_data['over'])} over-budget)"
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
        "ratio": man_data["ratio"],
        "ratio_pct": man_data["ratio_pct"],
        "ratio_str": f"{man_data['ratio_pct']:.1f}%" if rev > 0 else "0.0% (N/A - Zero Revenue)",
        "diff": diff,
        "diff_str": f"+{format_rupiah(diff)}" if diff > 0 else format_rupiah(diff),
        "is_over_budget": man_data["is_anomaly"],
        "status": status,
        "status_label": status_label
    }


# ============================================================================
# 4. SKENARIO PENGUJIAN TERSTRUKTUR (4-PILAR & MULTI-POS)
# ============================================================================

def test_scenario_anomali_material() -> bool:
    """
    Skenario 1) Anomali Material:
    Revenue Rp 100.000.000, Belanja Material Rp 55.000.000 (55% > pagu 50%).
    Pos lain aman: Manpower Rp 20.000.000 (20%), Operasional Rp 8.000.000 (8%).
    Harus terdeteksi anomali pada pos MATERIAL (+Rp 5.000.000 over-budget).
    """
    mod = f"{MODULE_NAME}_MATERIAL"
    log("INFO", mod, "Menjalankan Skenario Anomali Material (Belanja material > 50% revenue)...")

    revenue = 100_000_000
    material = 55_000_000
    manpower = 20_000_000
    operasional = 8_000_000

    result = evaluate_4pillar_budget(revenue, material, manpower, operasional)

    log("WARN", mod, f"Revenue   : {result['revenue_str']}")
    log("WARN", mod, f"Material  : {result['material']['actual_str']} ({result['material']['ratio_str']}) - Plafon: {result['material']['cap_str']} (50%)")
    log("WARN", mod, f"Over-Pagu : {result['material']['over_str']}")
    log("WARN", mod, f"Status    : {result['status_label']}")

    # Verifikasi assertions
    assert result["revenue"] == 100_000_000, "Revenue harus 100.000.000"
    assert result["material"]["actual"] == 55_000_000, "Material aktual harus 55.000.000"
    assert result["material"]["cap"] == 50_000_000, "Plafon material 50% harus 50.000.000"
    assert math.isclose(result["material"]["ratio_pct"], 55.0, abs_tol=1e-5), "Rasio material harus 55.0%"
    assert result["material"]["is_anomaly"] is True, "Material harus terdeteksi anomali"
    assert result["material"]["over"] == 5_000_000, "Over-budget material harus Rp 5.000.000"
    assert result["manpower"]["is_anomaly"] is False, "Manpower tidak boleh anomali"
    assert result["operasional"]["is_anomaly"] is False, "Operasional tidak boleh anomali"

    # Verifikasi anomali terdaftar
    anomaly_positions = [a["pos"] for a in result["anomalies"]]
    assert "MATERIAL" in anomaly_positions, "Pos MATERIAL harus terdaftar dalam anomalies"
    assert any("melebihi pagu 50%" in a["message"] for a in result["anomalies"]), "Pesan harus mencantumkan over-pagu 50%"

    log("INFO", mod, "✓ Skenario Anomali Material LULUS: Anomali belanja material (+Rp 5.000.000 / 55%) terdeteksi tepat.")
    return True


def test_scenario_anomali_manpower() -> bool:
    """
    Skenario 2) Anomali Manpower:
    Revenue Rp 100.000.000, Upah WBS Rp 30.000.000 (30% > pagu 25%).
    Pos lain aman: Material Rp 45.000.000 (45%), Operasional Rp 8.000.000 (8%).
    Harus terdeteksi anomali pada pos MANPOWER (+Rp 5.000.000 over-budget).
    """
    mod = f"{MODULE_NAME}_MANPOWER"
    log("INFO", mod, "Menjalankan Skenario Anomali Manpower (Upah WBS > 25% revenue)...")

    revenue = 100_000_000
    material = 45_000_000
    manpower = 30_000_000
    operasional = 8_000_000

    result = evaluate_4pillar_budget(revenue, material, manpower, operasional)

    log("WARN", mod, f"Revenue   : {result['revenue_str']}")
    log("WARN", mod, f"Manpower  : {result['manpower']['actual_str']} ({result['manpower']['ratio_str']}) - Plafon: {result['manpower']['cap_str']} (25%)")
    log("WARN", mod, f"Over-Pagu : {result['manpower']['over_str']}")
    log("WARN", mod, f"Status    : {result['status_label']}")

    # Verifikasi assertions
    assert result["revenue"] == 100_000_000, "Revenue harus 100.000.000"
    assert result["manpower"]["actual"] == 30_000_000, "Manpower aktual harus 30.000.000"
    assert result["manpower"]["cap"] == 25_000_000, "Plafon upah WBS 25% harus 25.000.000"
    assert math.isclose(result["manpower"]["ratio_pct"], 30.0, abs_tol=1e-5), "Rasio upah harus 30.0%"
    assert result["manpower"]["is_anomaly"] is True, "Manpower harus terdeteksi anomali"
    assert result["manpower"]["over"] == 5_000_000, "Over-budget upah harus Rp 5.000.000"
    assert result["material"]["is_anomaly"] is False, "Material tidak boleh anomali"
    assert result["operasional"]["is_anomaly"] is False, "Operasional tidak boleh anomali"

    # Verifikasi anomali terdaftar
    anomaly_positions = [a["pos"] for a in result["anomalies"]]
    assert "MANPOWER" in anomaly_positions, "Pos MANPOWER harus terdaftar dalam anomalies"
    assert any("melebihi pagu 25%" in a["message"] for a in result["anomalies"]), "Pesan harus mencantumkan over-pagu 25%"

    log("INFO", mod, "✓ Skenario Anomali Manpower LULUS: Anomali upah WBS (+Rp 5.000.000 / 30%) terdeteksi tepat.")
    return True


def test_scenario_anomali_operasional() -> bool:
    """
    Skenario 3) Anomali Operasional:
    Revenue Rp 100.000.000, Petty Cash Operasional Rp 14.000.000 (14% > pagu 10%).
    Pos lain aman: Material Rp 45.000.000 (45%), Manpower Rp 20.000.000 (20%).
    Harus terdeteksi anomali pada pos OPERASIONAL (+Rp 4.000.000 over-budget).
    """
    mod = f"{MODULE_NAME}_OPERASIONAL"
    log("INFO", mod, "Menjalankan Skenario Anomali Operasional (Petty cash > 10% revenue)...")

    revenue = 100_000_000
    material = 45_000_000
    manpower = 20_000_000
    operasional = 14_000_000

    result = evaluate_4pillar_budget(revenue, material, manpower, operasional)

    log("WARN", mod, f"Revenue     : {result['revenue_str']}")
    log("WARN", mod, f"Operasional : {result['operasional']['actual_str']} ({result['operasional']['ratio_str']}) - Plafon: {result['operasional']['cap_str']} (10%)")
    log("WARN", mod, f"Over-Pagu   : {result['operasional']['over_str']}")
    log("WARN", mod, f"Status      : {result['status_label']}")

    # Verifikasi assertions
    assert result["revenue"] == 100_000_000, "Revenue harus 100.000.000"
    assert result["operasional"]["actual"] == 14_000_000, "Operasional aktual harus 14.000.000"
    assert result["operasional"]["cap"] == 10_000_000, "Plafon operasional 10% harus 10.000.000"
    assert math.isclose(result["operasional"]["ratio_pct"], 14.0, abs_tol=1e-5), "Rasio operasional harus 14.0%"
    assert result["operasional"]["is_anomaly"] is True, "Operasional harus terdeteksi anomali"
    assert result["operasional"]["over"] == 4_000_000, "Over-budget operasional harus Rp 4.000.000"
    assert result["material"]["is_anomaly"] is False, "Material tidak boleh anomali"
    assert result["manpower"]["is_anomaly"] is False, "Manpower tidak boleh anomali"

    # Verifikasi anomali terdaftar
    anomaly_positions = [a["pos"] for a in result["anomalies"]]
    assert "OPERASIONAL" in anomaly_positions, "Pos OPERASIONAL harus terdaftar dalam anomalies"
    assert any("melebihi pagu 10%" in a["message"] for a in result["anomalies"]), "Pesan harus mencantumkan over-pagu 10%"

    log("INFO", mod, "✓ Skenario Anomali Operasional LULUS: Anomali petty cash (+Rp 4.000.000 / 14%) terdeteksi tepat.")
    return True


def test_scenario_margin_tergerus() -> bool:
    """
    Skenario 4) Margin Tergerus:
    Revenue Rp 100.000.000.
    Total Biaya Rp 88.000.000 (Material Rp 50jt / 50%, Manpower Rp 25jt / 25%, Operasional Rp 13jt / 13%).
    Margin Riil = Rp 100jt - Rp 88jt = Rp 12.000.000 (12.0% < target 15%).
    Harus terdeteksi anomali MARGIN tergerus (defisit Rp 3.000.000 terhadap target Rp 15jt).
    """
    mod = f"{MODULE_NAME}_MARGIN"
    log("INFO", mod, "Menjalankan Skenario Margin Tergerus (Margin riil < 15% revenue)...")

    revenue = 100_000_000
    material = 50_000_000      # 50% (tepat di plafon)
    manpower = 25_000_000      # 25% (tepat di plafon)
    operasional = 13_000_000   # 13% (over plafon 10%)

    result = evaluate_4pillar_budget(revenue, material, manpower, operasional)

    log("WARN", mod, f"Revenue     : {result['revenue_str']}")
    log("WARN", mod, f"Total Biaya : {result['total_cost_str']} ({result['total_cost_pct_str']})")
    log("WARN", mod, f"Target Marg.: {result['margin']['target_str']} (15.0%)")
    log("WARN", mod, f"Margin Riil : {result['margin']['real_str']} ({result['margin']['real_pct_str']})")
    log("WARN", mod, f"Defisit Marg: {result['margin']['deficit_str']}")
    log("WARN", mod, f"Status      : {result['status_label']}")

    # Verifikasi assertions
    assert result["revenue"] == 100_000_000, "Revenue harus 100.000.000"
    assert result["total_cost"] == 88_000_000, "Total pengeluaran harus 88.000.000"
    assert result["margin"]["real"] == 12_000_000, "Margin riil harus Rp 12.000.000"
    assert result["margin"]["target"] == 15_000_000, "Target margin 15% harus Rp 15.000.000"
    assert math.isclose(result["margin"]["real_pct"], 12.0, abs_tol=1e-5), "Persentase margin riil harus 12.0%"
    assert result["margin"]["is_eroded"] is True, "Margin harus terdeteksi tergerus (< 15%)"
    assert result["margin"]["deficit"] == 3_000_000, "Defisit margin harus Rp 3.000.000"

    # Verifikasi anomali terdaftar
    anomaly_positions = [a["pos"] for a in result["anomalies"]]
    assert "MARGIN" in anomaly_positions, "Pos MARGIN harus terdaftar dalam anomalies"
    assert any("tergerus di bawah target 15%" in a["message"] for a in result["anomalies"]), "Pesan harus mencantumkan margin tergerus di bawah 15%"

    log("INFO", mod, "✓ Skenario Margin Tergerus LULUS: Margin riil 12% (< target 15%, defisit Rp 3jt) terdeteksi akurat.")
    return True


def test_scenario_proyek_sehat() -> bool:
    """
    Skenario 5) Proyek Sehat (Semua Pos On-Track):
    Revenue Rp 100.000.000.
    Material = Rp 45.000.000 (45% <= 50%)
    Manpower = Rp 20.000.000 (20% <= 25%)
    Operasional = Rp 8.000.000 (8% <= 10%)
    Total Biaya = Rp 73.000.000 (73% <= 85%)
    Margin Riil = Rp 27.000.000 (27% >= 15%)
    Semua pos aman tanpa anomali, status PROYEK_SEHAT.
    """
    mod = f"{MODULE_NAME}_SEHAT"
    log("INFO", mod, "Menjalankan Skenario Proyek Sehat (Semua pos on-track)...")

    revenue = 100_000_000
    material = 45_000_000
    manpower = 20_000_000
    operasional = 8_000_000

    result = evaluate_4pillar_budget(revenue, material, manpower, operasional)

    log("INFO", mod, f"Revenue     : {result['revenue_str']}")
    log("INFO", mod, f"Material    : {result['material']['actual_str']} ({result['material']['ratio_str']}) - Plafon: {result['material']['cap_str']}")
    log("INFO", mod, f"Manpower    : {result['manpower']['actual_str']} ({result['manpower']['ratio_str']}) - Plafon: {result['manpower']['cap_str']}")
    log("INFO", mod, f"Operasional : {result['operasional']['actual_str']} ({result['operasional']['ratio_str']}) - Plafon: {result['operasional']['cap_str']}")
    log("INFO", mod, f"Margin Riil : {result['margin']['real_str']} ({result['margin']['real_pct_str']}) - Target: {result['margin']['target_str']}")
    log("INFO", mod, f"Status      : {result['status_label']}")

    # Verifikasi assertions
    assert result["material"]["is_anomaly"] is False, "Material harus aman (on-track)"
    assert result["manpower"]["is_anomaly"] is False, "Manpower harus aman (on-track)"
    assert result["operasional"]["is_anomaly"] is False, "Operasional harus aman (on-track)"
    assert result["margin"]["is_eroded"] is False, "Margin tidak tergerus (>= 15%)"
    assert result["is_healthy"] is True, "Proyek harus berstatus healthy"
    assert result["status"] == "PROYEK_SEHAT", "Status harus PROYEK_SEHAT"
    assert len(result["anomalies"]) == 0, "Daftar anomali harus kosong"
    assert result["margin"]["real"] == 27_000_000, "Margin riil harus Rp 27.000.000 (27%)"

    log("INFO", mod, "✓ Skenario Proyek Sehat LULUS: Semua pos on-track, 0 anomali, margin 27% (>= 15%).")
    return True


def test_scenario_multi_anomali() -> bool:
    """
    Skenario 6) Multi-Pos Anomali:
    Revenue Rp 100.000.000.
    Material = Rp 55.000.000 (55% > 50%) -> Over Rp 5jt
    Manpower = Rp 28.000.000 (28% > 25%) -> Over Rp 3jt
    Operasional = Rp 12.000.000 (12% > 10%) -> Over Rp 2jt
    Total Biaya = Rp 95.000.000 (95%)
    Margin Riil = Rp 5.000.000 (5% < 15%) -> Defisit Rp 10jt
    Harus mendeteksi 4 anomali pos sekaligus (MATERIAL, MANPOWER, OPERASIONAL, MARGIN).
    """
    mod = f"{MODULE_NAME}_MULTI"
    log("INFO", mod, "Menjalankan Skenario Multi-Pos Anomali Simultan...")

    revenue = 100_000_000
    material = 55_000_000
    manpower = 28_000_000
    operasional = 12_000_000

    result = evaluate_4pillar_budget(revenue, material, manpower, operasional)

    log("WARN", mod, f"Revenue        : {result['revenue_str']}")
    log("WARN", mod, f"Total Biaya    : {result['total_cost_str']} ({result['total_cost_pct_str']})")
    log("WARN", mod, f"Margin Riil    : {result['margin']['real_str']} ({result['margin']['real_pct_str']})")
    log("WARN", mod, f"Jumlah Anomali : {result['anomaly_count']} anomali terdeteksi")
    for a in result["anomalies"]:
        log("WARN", mod, f"  * [{a['pos']}] {a['message']}")

    # Verifikasi assertions
    assert result["anomaly_count"] == 4, "Harus ada 4 anomali terdeteksi simultan"
    assert result["has_anomaly"] is True, "Harus berstatus has_anomaly=True"
    assert result["status"] == "ANOMALI_TERDETEKSI", "Status harus ANOMALI_TERDETEKSI"

    anomaly_positions = [a["pos"] for a in result["anomalies"]]
    assert "MATERIAL" in anomaly_positions, "Pos MATERIAL harus terdaftar"
    assert "MANPOWER" in anomaly_positions, "Pos MANPOWER harus terdaftar"
    assert "OPERASIONAL" in anomaly_positions, "Pos OPERASIONAL harus terdaftar"
    assert "MARGIN" in anomaly_positions, "Pos MARGIN harus terdaftar"

    assert result["material"]["over"] == 5_000_000, "Over material harus Rp 5jt"
    assert result["manpower"]["over"] == 3_000_000, "Over manpower harus Rp 3jt"
    assert result["operasional"]["over"] == 2_000_000, "Over operasional harus Rp 2jt"
    assert result["margin"]["deficit"] == 10_000_000, "Defisit margin harus Rp 10jt"

    log("INFO", mod, "✓ Skenario Multi-Pos Anomali LULUS: Semua 4 pos anomali terdeteksi simultan secara akurat.")
    return True


def test_scenario_zero_revenue_fallback() -> bool:
    """
    Skenario 7) Zero Revenue Fallback:
    Proyek baru tanpa revenue -> Tampilkan fallback aman tanpa NaN / ZeroDivisionError.
    """
    mod = f"{MODULE_NAME}_ZERO"
    log("INFO", mod, "Menjalankan Skenario Zero Revenue (Fallback aman tanpa NaN)...")

    # Kasus 1: Revenue = 0, Semua Biaya = 0
    res_zero = evaluate_4pillar_budget(0, 0, 0, 0)
    assert not math.isnan(res_zero["material"]["ratio"]), "Ratio material tidak boleh NaN"
    assert not math.isnan(res_zero["manpower"]["ratio"]), "Ratio manpower tidak boleh NaN"
    assert not math.isnan(res_zero["operasional"]["ratio"]), "Ratio operasional tidak boleh NaN"
    assert not math.isnan(res_zero["margin"]["real_pct"]), "Margin pct tidak boleh NaN"
    assert "NaN" not in res_zero["material"]["ratio_str"], "String ratio tidak boleh memuat 'NaN'"
    assert res_zero["status"] == "ZERO_REVENUE_FALLBACK", "Status harus ZERO_REVENUE_FALLBACK"

    # Kasus 2: Revenue = None
    res_none = evaluate_4pillar_budget(None, None, None, None)
    assert res_none["revenue"] == 0.0, "Revenue None harus dikonversi aman ke 0.0"
    assert res_none["status"] == "ZERO_REVENUE_FALLBACK"

    # Kasus 3: Revenue = 0 tapi ada pengeluaran aktual (misal upah awal Rp 5jt)
    res_with_cost = evaluate_4pillar_budget(0, material=0, manpower=5_000_000, operasional=0)
    assert res_with_cost["status"] == "ANOMALY_NO_REVENUE", "Harus terdeteksi anomali pengeluaran tanpa revenue"
    assert not math.isnan(res_with_cost["total_cost_pct"]), "Total cost pct tidak boleh NaN"

    # Kasus 4: Verifikasi legacy analyze_labor_budget
    legacy_res = analyze_labor_budget(0, 0)
    assert legacy_res["status"] == "ZERO_REVENUE_FALLBACK"
    assert not math.isnan(legacy_res["ratio"])

    log("INFO", mod, "✓ Skenario Zero Revenue LULUS: Fallback zero revenue aman, tidak ada NaN atau crash.")
    return True


def test_scenario_pagu_total_integritas() -> bool:
    """
    Skenario 8) Integritas Pagu Total (50% + 25% + 10% + 15% = 100%):
    Verifikasi integritas alokasi pagu historis DAT.
    """
    mod = f"{MODULE_NAME}_PAGU"
    log("INFO", mod, "Menjalankan Skenario Integritas Pagu Total 100%...")

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

    log("INFO", mod, "✓ Skenario Integritas Pagu Total LULUS: Total pagu tepat 100% dan teralokasi sempurna.")
    return True


# ============================================================================
# 5. ENTRY POINT & EXECUTION RUNNER
# ============================================================================

def main():
    log("INFO", MODULE_NAME, "================================================================")
    log("INFO", MODULE_NAME, "MEMULAI TEST SUITE: 4-PILAR BUDGETING & ANOMALI MULTI-POS")
    log("INFO", MODULE_NAME, "Standar Bisnis: Noir Living (DAT)")
    log("INFO", MODULE_NAME, "Patokan: Material 50% · Manpower 25% · Ops 10% · Margin 15%")
    log("INFO", MODULE_NAME, "================================================================")

    scenarios = [
        ("Skenario 1) Anomali Material (>50%)", test_scenario_anomali_material),
        ("Skenario 2) Anomali Manpower (>25%)", test_scenario_anomali_manpower),
        ("Skenario 3) Anomali Operasional (>10%)", test_scenario_anomali_operasional),
        ("Skenario 4) Margin Tergerus (<15%)", test_scenario_margin_tergerus),
        ("Skenario 5) Proyek Sehat (On-Track)", test_scenario_proyek_sehat),
        ("Skenario 6) Multi-Pos Anomali Simultan", test_scenario_multi_anomali),
        ("Skenario 7) Zero Revenue Fallback", test_scenario_zero_revenue_fallback),
        ("Skenario 8) Integritas Pagu Total 100%", test_scenario_pagu_total_integritas),
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
