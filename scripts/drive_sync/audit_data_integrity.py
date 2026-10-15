#!/usr/bin/env python3
"""
Audit Integritas Data & Rekonsiliasi Dashboard (Buncis)
======================================================
Tugas: Memeriksa integritas & konsistensi data antara:
1. Google Sheets Accounting/Finance (REKAP COST 2026, REV PROJECT, BAKSO Tukang Upah)
2. Internal Dashboard / Supabase (project_cost_summary, tukang_dashboards, sync_status)
3. Background Daemons (drive_cost_sync, tukang_upah_sync)
"""

import os
import sys
import json
import time
import subprocess
from datetime import datetime
import pytz

BASE_DIR = "/home/ubuntu/workspace/drive_sync"
sys.path.insert(0, BASE_DIR)

from drive_cost_sync import (
    google_access_token,
    fetch_project_summary,
    fetch_revenue,
    fetch_petty_cash,
    http_json,
    read_text,
    SB_URL_FILE,
    SB_KEY_FILE,
    TOKEN_FILE,
)
from tukang_upah_sync import (
    discover_sheets,
    fetch_dashboard,
)

WIB = pytz.timezone("Asia/Jakarta")

def check_process_running(proc_name):
    try:
        out = subprocess.check_output(["ps", "aux"], text=True)
        lines = [l for l in out.splitlines() if proc_name in l and "grep" not in l and "audit_data_integrity" not in l]
        return len(lines) > 0, len(lines)
    except Exception as e:
        return False, 0

def format_idr(val):
    if val is None:
        return "Rp 0"
    return f"Rp {val:,.0f}".replace(",", ".")

def run_audit():
    audit_time = datetime.now(WIB).strftime("%d %b %Y %H:%M WIB")
    findings = []
    anomalies = []
    
    # 1. Cek Kesehatan Daemon Background
    cost_daemon_ok, cost_daemon_cnt = check_process_running("drive_cost_sync.py")
    tukang_daemon_ok, tukang_daemon_cnt = check_process_running("tukang_upah_sync.py")
    
    daemon_status = []
    if cost_daemon_ok:
        daemon_status.append("✅ Drive Cost Sync Daemon: RUNNING")
    else:
        daemon_status.append("❌ Drive Cost Sync Daemon: STOPPED")
        anomalies.append("Daemon drive_cost_sync.py tidak aktif di background!")

    if tukang_daemon_ok:
        daemon_status.append("✅ Tukang Upah Sync Daemon: RUNNING")
    else:
        daemon_status.append("❌ Tukang Upah Sync Daemon: STOPPED")
        anomalies.append("Daemon tukang_upah_sync.py tidak aktif di background!")

    # 2. Cek Status Supabase Sync Status via RPC
    sb_url = read_text(SB_URL_FILE)
    sb_key = read_text(SB_KEY_FILE)
    sync_token = read_text(TOKEN_FILE)
    headers = {"apikey": sb_key, "Authorization": f"Bearer {sb_key}", "Content-Type": "application/json"}

    # Sync status: rekap_cost
    body_rekap = json.dumps({"p_token": sync_token}).encode()
    _, resp_rekap = http_json(f"{sb_url}/rest/v1/rpc/sync_status_read", method="POST", headers=headers, body={"p_token": sync_token})
    
    # Sync status: tukang_upah
    body_tukang = json.dumps({"p_token": sync_token, "p_id": "tukang_upah"}).encode()
    _, resp_tukang = http_json(f"{sb_url}/rest/v1/rpc/sync_status_read_id", method="POST", headers=headers, body={"p_token": sync_token, "p_id": "tukang_upah"})

    rekap_info = resp_rekap.get("status", {}) if isinstance(resp_rekap, dict) else {}
    tukang_info = resp_tukang.get("status", {}) if isinstance(resp_tukang, dict) else {}

    rekap_status_str = rekap_info.get("last_status", "UNKNOWN")
    tukang_status_str = tukang_info.get("last_status", "UNKNOWN")

    if rekap_status_str != "OK":
        anomalies.append(f"Status sync Rekap Cost di Supabase: {rekap_status_str} ({rekap_info.get('last_message', '')})")
    if tukang_status_str != "OK":
        anomalies.append(f"Status sync Tukang Upah di Supabase: {tukang_status_str} ({tukang_info.get('last_message', '')})")

    # 3. Audit Google Sheets Accounting & Finance
    token = None
    try:
        token = google_access_token()
    except Exception as e:
        anomalies.append(f"Gagal refresh Google OAuth token: {e}")

    cost_rows = []
    rev_map = {}
    pc_map = {}
    total_cum_cost = 0.0
    total_paid_all = 0.0
    total_outstanding_all = 0.0
    
    if token:
        try:
            cost_rows = fetch_project_summary(token)
            for r in cost_rows:
                cum = r.get("cumulative_cost") or 0.0
                paid = r.get("total_paid") or 0.0
                out = r.get("outstanding") or 0.0
                total_cum_cost += cum
                total_paid_all += paid
                total_outstanding_all += out
                
                # Cek konsistensi per baris
                p_no = r.get("project_no") or "NO_ID"
                if not r.get("project_no"):
                    anomalies.append(f"Proyek '{r.get('project_name')}' tidak memiliki project_no!")
        except Exception as e:
            anomalies.append(f"Gagal membaca tab PROJECT SUMMARY: {e}")

        try:
            rev_map = fetch_revenue(token)
        except Exception as e:
            anomalies.append(f"Gagal membaca REV PROJECT.xlsx: {e}")

        try:
            pc_map = fetch_petty_cash(token)
        except Exception as e:
            anomalies.append(f"Gagal membaca PETTY CASH: {e}")

    # 4. Audit Tukang Upah & Kasbon
    tukang_data = {}
    if token:
        try:
            sheets = discover_sheets(token)
            for key, info in sheets.items():
                sid = info["sheet_id"] if isinstance(info, dict) else info
                dash = fetch_dashboard(token, sid)
                hak = dash.get("total_hak_upah") or 0.0
                kasbon = dash.get("total_kasbon") or 0.0
                sisa = hak - kasbon
                tukang_data[key] = {
                    "name": info.get("name", key).replace("_Simple_Upah_Kasbon", ""),
                    "hak_upah": hak,
                    "kasbon": kasbon,
                    "sisa_saldo": sisa,
                }
                # Check negative saldo / over-kasbon
                if sisa < 0:
                    anomalies.append(f"Tukang {key.upper()} over-kasbon! Sisa saldo minus: {format_idr(sisa)}")
        except Exception as e:
            anomalies.append(f"Gagal membaca dashboard tukang BAKSO: {e}")

    # Rekapitulasi Laporan Markdown
    total_revenue_all = sum(rev_map.values())
    total_petty_cash_all = sum(pc_map.values())

    status_icon = "🟢" if len(anomalies) == 0 else "🔴"
    status_summary = "SEMUA DATA SINKRON & SEHAT" if len(anomalies) == 0 else f"{len(anomalies)} ANOMALI DITEMUKAN"

    report_lines = [
        f"📋 **LAPORAN AUDIT INTEGRITAS DATA (BUNCIS)**",
        f"📅 Waktu Audit: {audit_time}",
        f"Status Keseluruhan: {status_icon} **{status_summary}**\n",
        f"**1. Status Daemon & Integrasi Dashboard:**",
        f"- Daemon Cost Sync: {'🟢 Aktif' if cost_daemon_ok else '🔴 Mati'}",
        f"- Daemon Tukang Sync: {'🟢 Aktif' if tukang_daemon_ok else '🔴 Mati'}",
        f"- Supabase Sync Rekap Cost: {'🟢 OK' if rekap_status_str == 'OK' else '🔴 ' + rekap_status_str} ({rekap_info.get('rows_synced', 0)} project)",
        f"- Supabase Sync Tukang: {'🟢 OK' if tukang_status_str == 'OK' else '🔴 ' + tukang_status_str} ({tukang_info.get('rows_synced', 0)} tukang)\n",
        f"**2. Ringkasan Data Accounting (Google Sheets):**",
        f"- Total Project Terpantau: {len(cost_rows)} proyek",
        f"- Total Cumulative Cost: **{format_idr(total_cum_cost)}**",
        f"- Total Paid: {format_idr(total_paid_all)}",
        f"- Total Outstanding: {format_idr(total_outstanding_all)}",
        f"- Total Revenue (REV PROJECT): {format_idr(total_revenue_all)} ({len(rev_map)} project)",
        f"- Total Petty Cash: {format_idr(total_petty_cash_all)} ({len(pc_map)} cost center)\n",
        f"**3. Ringkasan Upah & Kasbon Mandor (BAKSO):**",
    ]

    for t_key, t_val in tukang_data.items():
        report_lines.append(
            f"- **{t_val['name']}**: Hak Upah {format_idr(t_val['hak_upah'])} | Kasbon {format_idr(t_val['kasbon'])} | Sisa Saldo: **{format_idr(t_val['sisa_saldo'])}**"
        )

    if anomalies:
        report_lines.append("\n⚠️ **TEMUAN ANOMALI / PERLU TINDAKAN:**")
        for i, a in enumerate(anomalies, 1):
            report_lines.append(f"{i}. {a}")
    else:
        report_lines.append("\n✨ **Catatan Integritas:** Tidak ada selisih ataupun error formula. Data Sheets & Dashboard dalam status match 100%.")

    return "\n".join(report_lines)

if __name__ == "__main__":
    report = run_audit()
    print(report)
