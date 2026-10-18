function _array_like_to_array(arr, len) {
    if (len == null || len > arr.length) len = arr.length;
    for(var i = 0, arr2 = new Array(len); i < len; i++)arr2[i] = arr[i];
    return arr2;
}
function _array_with_holes(arr) {
    if (Array.isArray(arr)) return arr;
}
function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) {
    try {
        var info = gen[key](arg);
        var value = info.value;
    } catch (error) {
        reject(error);
        return;
    }
    if (info.done) {
        resolve(value);
    } else {
        Promise.resolve(value).then(_next, _throw);
    }
}
function _async_to_generator(fn) {
    return function() {
        var self = this, args = arguments;
        return new Promise(function(resolve, reject) {
            var gen = fn.apply(self, args);
            function _next(value) {
                asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value);
            }
            function _throw(err) {
                asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err);
            }
            _next(undefined);
        });
    };
}
function _define_property(obj, key, value) {
    if (key in obj) {
        Object.defineProperty(obj, key, {
            value: value,
            enumerable: true,
            configurable: true,
            writable: true
        });
    } else {
        obj[key] = value;
    }
    return obj;
}
function _iterable_to_array_limit(arr, i) {
    var _i = arr == null ? null : typeof Symbol !== "undefined" && arr[Symbol.iterator] || arr["@@iterator"];
    if (_i == null) return;
    var _arr = [];
    var _n = true;
    var _d = false;
    var _s, _e;
    try {
        for(_i = _i.call(arr); !(_n = (_s = _i.next()).done); _n = true){
            _arr.push(_s.value);
            if (i && _arr.length === i) break;
        }
    } catch (err) {
        _d = true;
        _e = err;
    } finally{
        try {
            if (!_n && _i["return"] != null) _i["return"]();
        } finally{
            if (_d) throw _e;
        }
    }
    return _arr;
}
function _non_iterable_rest() {
    throw new TypeError("Invalid attempt to destructure non-iterable instance.\\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _object_spread(target) {
    for(var i = 1; i < arguments.length; i++){
        var source = arguments[i] != null ? arguments[i] : {};
        var ownKeys = Object.keys(source);
        if (typeof Object.getOwnPropertySymbols === "function") {
            ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function(sym) {
                return Object.getOwnPropertyDescriptor(source, sym).enumerable;
            }));
        }
        ownKeys.forEach(function(key) {
            _define_property(target, key, source[key]);
        });
    }
    return target;
}
function ownKeys(object, enumerableOnly) {
    var keys = Object.keys(object);
    if (Object.getOwnPropertySymbols) {
        var symbols = Object.getOwnPropertySymbols(object);
        if (enumerableOnly) {
            symbols = symbols.filter(function(sym) {
                return Object.getOwnPropertyDescriptor(object, sym).enumerable;
            });
        }
        keys.push.apply(keys, symbols);
    }
    return keys;
}
function _object_spread_props(target, source) {
    source = source != null ? source : {};
    if (Object.getOwnPropertyDescriptors) {
        Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
    } else {
        ownKeys(Object(source)).forEach(function(key) {
            Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
        });
    }
    return target;
}
function _sliced_to_array(arr, i) {
    return _array_with_holes(arr) || _iterable_to_array_limit(arr, i) || _unsupported_iterable_to_array(arr, i) || _non_iterable_rest();
}
function _unsupported_iterable_to_array(o, minLen) {
    if (!o) return;
    if (typeof o === "string") return _array_like_to_array(o, minLen);
    var n = Object.prototype.toString.call(o).slice(8, -1);
    if (n === "Object" && o.constructor) n = o.constructor.name;
    if (n === "Map" || n === "Set") return Array.from(n);
    if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _array_like_to_array(o, minLen);
}
function _ts_generator(thisArg, body) {
    var f, y, t, g, _ = {
        label: 0,
        sent: function() {
            if (t[0] & 1) throw t[1];
            return t[1];
        },
        trys: [],
        ops: []
    };
    return g = {
        next: verb(0),
        "throw": verb(1),
        "return": verb(2)
    }, typeof Symbol === "function" && (g[Symbol.iterator] = function() {
        return this;
    }), g;
    function verb(n) {
        return function(v) {
            return step([
                n,
                v
            ]);
        };
    }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while(_)try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [
                op[0] & 2,
                t.value
            ];
            switch(op[0]){
                case 0:
                case 1:
                    t = op;
                    break;
                case 4:
                    _.label++;
                    return {
                        value: op[1],
                        done: false
                    };
                case 5:
                    _.label++;
                    y = op[1];
                    op = [
                        0
                    ];
                    continue;
                case 7:
                    op = _.ops.pop();
                    _.trys.pop();
                    continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) {
                        _ = 0;
                        continue;
                    }
                    if (op[0] === 3 && (!t || op[1] > t[0] && op[1] < t[3])) {
                        _.label = op[1];
                        break;
                    }
                    if (op[0] === 6 && _.label < t[1]) {
                        _.label = t[1];
                        t = op;
                        break;
                    }
                    if (t && _.label < t[2]) {
                        _.label = t[2];
                        _.ops.push(op);
                        break;
                    }
                    if (t[2]) _.ops.pop();
                    _.trys.pop();
                    continue;
            }
            op = body.call(thisArg, _);
        } catch (e) {
            op = [
                6,
                e
            ];
            y = 0;
        } finally{
            f = t = 0;
        }
        if (op[0] & 5) throw op[1];
        return {
            value: op[0] ? op[1] : void 0,
            done: true
        };
    }
}
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { rupiah, formatRibuan, persen, formatNominalInput, PLANNING_STATUSES, planningStatusStyle, volumeText, normalizeStatus } from "../lib/constants.js";
// ============================================================
// Modul BUDGETING — khusus role admin (adminOnly).
// WBS per proyek: daftar pekerjaan per area, volume & satuan,
// penugasan pekerja/tukang, estimasi upah (borongan/harian),
// status progress, dan shortcut "+ Buat PR Material" ke modul
// Purchase Request (membuat PR DRAFT + item otomatis terisi).
//
// Tabel DB: public.project_plans (RLS admin-only).
// ============================================================
var UNIT_OPTIONS = [
    "unit",
    "m1",
    "m2",
    "m3",
    "ls",
    "titik",
    "set",
    "pcs",
    "kg",
    "liter"
];
// ============================================================
// PATOKAN ANGGARAN 4-PILAR (Noir Living)
//   Budget Standar  : Material 50% · Upah 25% · Operasional 10% · Target Margin 15%
//   Budget Custom   : persentase bebas (draft), diterapkan hanya bila VALID.
// Draft vs Applied: draft = yang sedang diketik user (boleh sementara total >100
// agar dapat rebalance). Applied = snapshot valid terakhir yang dipakai untuk
// pagu nominal, deteksi anomali, dan sumber data finance. Tidak ada normalisasi
// senyap: nilai tidak valid hanya TIDAK diterapkan (bukan di-rescale).
// ============================================================
var STANDARD_PERCENTAGES = {
    material: 50,
    manpower: 25,
    operasional: 10,
    margin: 15
};
var PCT_FIELDS = [
    {
        key: "material",
        label: "Material"
    },
    {
        key: "manpower",
        label: "Upah"
    },
    {
        key: "operasional",
        label: "Operasional"
    },
    {
        key: "margin",
        label: "Target Margin"
    }
];
// Bentuk draft (string) dari objek persentase — dipakai untuk nilai input.
function pctToDraft(p) {
    return {
        material: String(p.material),
        manpower: String(p.manpower),
        operasional: String(p.operasional),
        margin: String(p.margin)
    };
}
// Validasi draft persentase: tiap field harus finite dan 0..100, TOTAL <= 100.
// Mengembalikan { valid, fieldsOk, totalOk, total, remaining, errors, values }.
// values berisi angka tervalidasi (null bila field invalid) — hanya dipakai bila valid.
function validatePercentDraft(draft) {
    var values = {};
    var errors = [];
    var total = 0;
    var fieldsOk = true;
    var _iteratorNormalCompletion = true, _didIteratorError = false, _iteratorError = undefined;
    try {
        for(var _iterator = PCT_FIELDS[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true){
            var f = _step.value;
            var raw = draft ? draft[f.key] : "";
            var str = String(raw !== null && raw !== void 0 ? raw : "").trim();
            var num = str === "" ? NaN : Number(str);
            if (str === "" || !Number.isFinite(num) || num < 0 || num > 100) {
                fieldsOk = false;
                errors.push("".concat(f.label, " harus angka 0–100"));
                values[f.key] = null;
            } else {
                values[f.key] = num;
                total += num;
            }
        }
    } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
    } finally{
        try {
            if (!_iteratorNormalCompletion && _iterator.return != null) {
                _iterator.return();
            }
        } finally{
            if (_didIteratorError) {
                throw _iteratorError;
            }
        }
    }
    var totalRounded = Math.round(total * 100) / 100;
    var totalOk = fieldsOk && totalRounded <= 100;
    var valid = fieldsOk && totalOk;
    return {
        valid: valid,
        fieldsOk: fieldsOk,
        totalOk: totalOk,
        total: totalRounded,
        remaining: Math.max(0, Math.round((100 - totalRounded) * 100) / 100),
        errors: errors,
        values: values
    };
}
var emptyForm = {
    id: null,
    area: "",
    item_name: "",
    volume: "1",
    unit: "unit",
    spec: "",
    worker_name: "",
    worker_type: "borongan",
    labor_cost: "",
    status: "Perencanaan",
    progress: "0",
    target_start: "",
    target_end: ""
};
function digitsOnly(v) {
    var d = String(v !== null && v !== void 0 ? v : "").replace(/[^\d]/g, "");
    return d ? Number(d) : 0;
}
// Normalisasi nomor proyek untuk pencocokan project_no (Rekap Cost) ↔ kode (Projects).
// Toleran terhadap: spasi, leading zero ('099' == '99'), dan sisa desimal ekspor
// numerik Sheets ('99.0' == '99'). String non-numerik ('99abc') TIDAK dianggap
// sama dengan '99' (mencegah false-match seperti parseInt).
function normalizeProjectNo(v) {
    var s = String(v !== null && v !== void 0 ? v : "").trim();
    if (!s) return "";
    var m = s.match(/^0*(\d+)(?:[.,]0+)?$/);
    return m ? String(Number(m[1])) : s;
}
export default function Planning(param) {
    var rows = param.rows, say = param.say, setPage = param.setPage, refresh = param.refresh;
    var allProjects = (rows === null || rows === void 0 ? void 0 : rows.projects) || [];
    var _useState = _sliced_to_array(useState([]), 2), plans = _useState[0], setPlans = _useState[1];
    var _useState1 = _sliced_to_array(useState([]), 2), costData = _useState1[0], setCostData = _useState1[1];
    // Error khusus tabel project_cost_summary (Rekap Cost) — dipisah dari `error`
    // supaya panel pagu anggaran TIDAK salah klaim "Revenue belum diset" ketika
    // data cost sebenarnya GAGAL dimuat (RLS / jaringan).
    var _useState2 = _sliced_to_array(useState(""), 2), costError = _useState2[0], setCostError = _useState2[1];
    var _useState3 = _sliced_to_array(useState(true), 2), loading = _useState3[0], setLoading = _useState3[1];
    var _useState4 = _sliced_to_array(useState(""), 2), error = _useState4[0], setError = _useState4[1];
    var _useState5 = _sliced_to_array(useState(""), 2), projectId = _useState5[0], setProjectId = _useState5[1];
    var _useState6 // null | { mode: 'add' | 'edit', form }
     = _sliced_to_array(useState(null), 2), modal = _useState6[0], setModal = _useState6[1];
    var _useState7 = _sliced_to_array(useState(false), 2), saving = _useState7[0], setSaving = _useState7[1];
    var _useState8 = _sliced_to_array(useState(null), 2), busyId = _useState8[0], setBusyId = _useState8[1];
    var _useState9 = _sliced_to_array(useState(null), 2), prBusyId = _useState9[0], setPrBusyId = _useState9[1];
    var _useState10 // 'standard' or 'custom'
     = _sliced_to_array(useState("standard"), 2), budgetMode = _useState10[0], setBudgetMode = _useState10[1];
    // Draft = nilai input yang sedang diketik (string, boleh sementara total >100).
    var _useState11 = _sliced_to_array(useState(function() {
        return pctToDraft(STANDARD_PERCENTAGES);
    }), 2), customDraft = _useState11[0], setCustomDraft = _useState11[1];
    // Applied = snapshot VALID terakhir (angka) yang dipakai untuk pagu/anomali.
    var _useState12 = _sliced_to_array(useState(STANDARD_PERCENTAGES), 2), appliedPercentages = _useState12[0], setAppliedPercentages = _useState12[1];
    var _useState13 = _sliced_to_array(useState(false), 2), customNotApplied = _useState13[0], setCustomNotApplied = _useState13[1];
    // Proyek aktif (belum DONE), urut nomor kode numerik.
    var activeProjects = useMemo(function() {
        return allProjects.filter(function(p) {
            return normalizeStatus(p.status) !== "DONE";
        }).sort(function(a, b) {
            var na = parseInt(a.kode, 10);
            var nb = parseInt(b.kode, 10);
            if (!isNaN(na) && !isNaN(nb)) return na - nb;
            return (a.kode || "").localeCompare(b.kode || "");
        });
    }, [
        allProjects
    ]);
    // Pilih proyek pertama otomatis saat data siap.
    useEffect(function() {
        if (!projectId && activeProjects.length) setProjectId(activeProjects[0].id);
    }, [
        activeProjects,
        projectId
    ]);
    var loadPlans = useCallback(/*#__PURE__*/ _async_to_generator(function() {
        var _ref, plansRes, costRes, e;
        return _ts_generator(this, function(_state) {
            switch(_state.label){
                case 0:
                    if (!supabase) return [
                        2
                    ];
                    setLoading(true);
                    setError("");
                    setCostError("");
                    _state.label = 1;
                case 1:
                    _state.trys.push([
                        1,
                        3,
                        4,
                        5
                    ]);
                    return [
                        4,
                        Promise.all([
                            supabase.from("project_plans").select("*").order("created_at", {
                                ascending: true
                            }),
                            supabase.from("project_cost_summary").select("*")
                        ])
                    ];
                case 2:
                    _ref = _sliced_to_array.apply(void 0, [
                        _state.sent(),
                        2
                    ]), plansRes = _ref[0], costRes = _ref[1];
                    if (plansRes.error) setError(plansRes.error.message);
                    else setPlans(plansRes.data || []);
                    if (costRes.error) {
                        console.warn("Gagal memuat project_cost_summary:", costRes.error.message);
                        setCostError(costRes.error.message || "gagal memuat data Rekap Cost");
                        setCostData([]);
                    } else {
                        setCostData(costRes.data || []);
                    }
                    return [
                        3,
                        5
                    ];
                case 3:
                    e = _state.sent();
                    setError(e.message);
                    return [
                        3,
                        5
                    ];
                case 4:
                    setLoading(false);
                    return [
                        7
                    ];
                case 5:
                    return [
                        2
                    ];
            }
        });
    }), []);
    useEffect(function() {
        loadPlans();
    }, [
        loadPlans
    ]);
    var project = activeProjects.find(function(p) {
        return p.id === projectId;
    }) || allProjects.find(function(p) {
        return p.id === projectId;
    });
    // Data project_cost_summary yang cocok dengan proyek aktif (project_no == p.kode).
    // Exact match dulu; fallback normalisasi nomor (leading zero / '.0') yang aman
    // dari false-match (lihat normalizeProjectNo).
    var activeCost = useMemo(function() {
        if (!project || !costData.length) return null;
        var key = String(project.kode || "").trim();
        if (!key) return null;
        var keyNorm = normalizeProjectNo(key);
        return costData.find(function(c) {
            var cNo = String(c.project_no || "").trim();
            if (cNo === key) return true;
            if (!keyNorm || !cNo) return false;
            return normalizeProjectNo(cNo) === keyNorm;
        }) || null;
    }, [
        project,
        costData
    ]);
    var projectPlans = useMemo(function() {
        return plans.filter(function(pl) {
            return pl.project_id === projectId;
        });
    }, [
        plans,
        projectId
    ]);
    // Statistik cepat WBS proyek terpilih
    var stats = useMemo(function() {
        var total = projectPlans.length;
        var labor = projectPlans.reduce(function(s, pl) {
            return s + (Number(pl.labor_cost) || 0);
        }, 0);
        var avgProgress = total ? Math.round(projectPlans.reduce(function(s, pl) {
            return s + (Number(pl.progress) || 0);
        }, 0) / total) : 0;
        var selesai = projectPlans.filter(function(pl) {
            return pl.status === "Selesai";
        }).length;
        return {
            total: total,
            labor: labor,
            avgProgress: avgProgress,
            selesai: selesai
        };
    }, [
        projectPlans
    ]);
    // Validasi draft persentase custom (dihitung tiap render draft berubah).
    // total boleh sementara >100 (draft) agar user dapat rebalance.
    var customValidation = useMemo(function() {
        return validatePercentDraft(customDraft);
    }, [
        customDraft
    ]);
    // Sinkronkan draft → applied HANYA bila draft valid (tidak ada normalisasi senyap).
    // Saat draft invalid (mis. total >100 di tengah rebalance) applied TIDAK berubah,
    // sehingga pagu nominal/anomali tetap memakai snapshot valid terakhir.
    useEffect(function() {
        if (budgetMode !== "custom") return;
        if (customValidation.valid) {
            setAppliedPercentages(customValidation.values);
            setCustomNotApplied(false);
        } else {
            setCustomNotApplied(true);
        }
    }, [
        budgetMode,
        customValidation.valid,
        customDraft
    ]) // eslint-disable-line react-hooks/exhaustive-deps
    ;
    // Kalkulasi pagu anggaran historis Noir Living & perbandingan Pagu vs Realisasi Riil
    var budget = useMemo(function() {
        var revenueVal = Number(activeCost === null || activeCost === void 0 ? void 0 : activeCost.revenue);
        var revenue = !isNaN(revenueVal) && revenueVal > 0 ? revenueVal : 0;
        // Mode custom berlaku walau revenue belum tersedia (pagu nominal pending).
        // Persentase yang DITERAPKAN: custom memakai snapshot valid terakhir;
        // standar memakai patokan fixed 50/25/10/15. TIDAK fallback diam-diam.
        var useCustom = budgetMode === "custom";
        var applied = useCustom ? appliedPercentages : STANDARD_PERCENTAGES;
        var pctMaterial = applied.material;
        var pctManpower = applied.manpower;
        var pctOperasional = applied.operasional;
        var pctMargin = applied.margin;
        // Total persentase yang benar-benar DITERAPKAN (selalu <= 100).
        var totalCustomPct = pctMaterial + pctManpower + pctOperasional + pctMargin;
        var isExceedingLimit = useCustom && !customValidation.valid;
        // 1. Plafon 4-Pilar (Patokan Historis DAT / Noir Living) atau Custom
        var budgetMaterial = Math.round(revenue * (pctMaterial / 100));
        var budgetManpower = Math.round(revenue * (pctManpower / 100));
        var budgetOperasional = Math.round(revenue * (pctOperasional / 100));
        var targetMargin = Math.round(revenue * (pctMargin / 100));
        // 2. Realisasi Riil
        var matVal = Number(activeCost === null || activeCost === void 0 ? void 0 : activeCost.cumulative_cost);
        var realMaterial = !isNaN(matVal) && matVal > 0 ? matVal : 0;
        var labVal = Number(stats === null || stats === void 0 ? void 0 : stats.labor);
        var realLabor = !isNaN(labVal) && labVal > 0 ? labVal : 0;
        var opsVal = Number(activeCost === null || activeCost === void 0 ? void 0 : activeCost.petty_cash);
        var realOperasional = !isNaN(opsVal) && opsVal > 0 ? opsVal : 0;
        var realTotalCost = realMaterial + realLabor + realOperasional;
        var realMargin = revenue - realTotalCost;
        // 3. Deteksi Anomali
        var isMaterialOver = revenue > 0 && realMaterial > budgetMaterial;
        var isLaborOver = revenue > 0 && realLabor > budgetManpower;
        var isOperasionalOver = revenue > 0 && realOperasional > budgetOperasional;
        var isMarginThin = revenue > 0 && realMargin < targetMargin;
        // 4. Variansi & Sisa Kuota Budget (Aman dari NaN & Div by Zero)
        var isLaborOverBudget = isLaborOver;
        var laborVariance = realLabor - budgetManpower;
        var laborRemaining = budgetManpower - realLabor;
        var laborPct = revenue > 0 ? realLabor / revenue * 100 : 0;
        var laborUsageOfPlafon = budgetManpower > 0 ? realLabor / budgetManpower * 100 : 0;
        var isMaterialOverBudget = isMaterialOver;
        var materialVariance = realMaterial - budgetMaterial;
        var materialRemaining = budgetMaterial - realMaterial;
        var materialPct = revenue > 0 ? realMaterial / revenue * 100 : 0;
        var materialUsageOfPlafon = budgetMaterial > 0 ? realMaterial / budgetMaterial * 100 : 0;
        var isOperasionalOverBudget = isOperasionalOver;
        var operasionalVariance = realOperasional - budgetOperasional;
        var operasionalRemaining = budgetOperasional - realOperasional;
        var operasionalPct = revenue > 0 ? realOperasional / revenue * 100 : 0;
        var operasionalUsageOfPlafon = budgetOperasional > 0 ? realOperasional / budgetOperasional * 100 : 0;
        var isMarginUnderTarget = isMarginThin;
        var marginVariance = realMargin - targetMargin;
        var marginDeficit = targetMargin - realMargin;
        var marginPct = revenue > 0 ? realMargin / revenue * 100 : 0;
        var marginAchievement = targetMargin > 0 ? realMargin / targetMargin * 100 : 0;
        // 5. Rangkuman Anomali untuk Banner Peringatan
        var anomalies = [];
        if (revenue > 0) {
            if (isMaterialOver) {
                anomalies.push({
                    pillar: "Material",
                    title: "1. Material (50% max)",
                    icon: "\uD83D\uDCE6",
                    pagu: budgetMaterial,
                    actual: realMaterial,
                    diff: materialVariance,
                    diffFormatted: "+".concat(rupiah(materialVariance)),
                    statusBadge: "⚠️ Over-Budget (+".concat(rupiah(materialVariance), ")"),
                    pct: materialPct,
                    usagePct: materialUsageOfPlafon,
                    message: "Belanja material riil ".concat(rupiah(realMaterial), " (").concat(persen(materialPct, 1), " dari revenue) melebihi batas pagu 50% (").concat(rupiah(budgetMaterial), ")."),
                    recommendation: "Audit rincian item PR Material dan verifikasi harga nota belanja lapangan."
                });
            }
            if (isLaborOver) {
                anomalies.push({
                    pillar: "Manpower",
                    title: "2. Upah Tukang (25% max)",
                    icon: "\uD83D\uDC77",
                    pagu: budgetManpower,
                    actual: realLabor,
                    diff: laborVariance,
                    diffFormatted: "+".concat(rupiah(laborVariance)),
                    statusBadge: "⚠️ Over-Budget (+".concat(rupiah(laborVariance), ")"),
                    pct: laborPct,
                    usagePct: laborUsageOfPlafon,
                    message: "Estimasi upah WBS ".concat(rupiah(realLabor), " (").concat(persen(laborPct, 1), " dari revenue) melebihi batas pagu 25% (").concat(rupiah(budgetManpower), ")."),
                    recommendation: "Tinjau kembali rincian pekerjaan atau negosiasi ulang kesepakatan upah tukang borongan."
                });
            }
            if (isOperasionalOver) {
                anomalies.push({
                    pillar: "Operasional",
                    title: "3. Operasional (10% max)",
                    icon: "⚡",
                    pagu: budgetOperasional,
                    actual: realOperasional,
                    diff: operasionalVariance,
                    diffFormatted: "+".concat(rupiah(operasionalVariance)),
                    statusBadge: "⚠️ Over-Budget (+".concat(rupiah(operasionalVariance), ")"),
                    pct: operasionalPct,
                    usagePct: operasionalUsageOfPlafon,
                    message: "Petty cash operasional riil ".concat(rupiah(realOperasional), " (").concat(persen(operasionalPct, 1), " dari revenue) melebihi batas pagu 10% (").concat(rupiah(budgetOperasional), ")."),
                    recommendation: "Perketat pengeluaran kas kecil proyek dan batasi bon operasional non-esensial."
                });
            }
            if (isMarginThin) {
                anomalies.push({
                    pillar: "Margin",
                    title: "4. Target Margin (15% min)",
                    icon: "\uD83D\uDCC8",
                    pagu: targetMargin,
                    actual: realMargin,
                    diff: marginDeficit,
                    diffFormatted: "-".concat(rupiah(marginDeficit)),
                    statusBadge: "⚠️ Defisit Margin (-".concat(rupiah(marginDeficit), ")"),
                    pct: marginPct,
                    usagePct: marginAchievement,
                    message: "Estimasi margin riil ".concat(rupiah(realMargin), " (").concat(persen(marginPct, 1), " dari revenue) berada di bawah target minimal 15% (").concat(rupiah(targetMargin), ")."),
                    recommendation: "Evaluasi total biaya material, upah, dan petty cash untuk memulihkan margin keuntungan proyek."
                });
            }
        }
        var hasAnomaly = anomalies.length > 0;
        return {
            revenue: revenue,
            // Plafon 4-Pilar
            budgetMaterial: budgetMaterial,
            budgetManpower: budgetManpower,
            budgetOperasional: budgetOperasional,
            targetMargin: targetMargin,
            // Custom Budget Mode Info
            useCustom: useCustom,
            appliedPercentages: appliedPercentages,
            draftPercentages: customDraft,
            customValidation: customValidation,
            customNotApplied: customNotApplied,
            totalCustomPct: totalCustomPct,
            isExceedingLimit: isExceedingLimit,
            // Realisasi Riil
            realMaterial: realMaterial,
            realLabor: realLabor,
            realOperasional: realOperasional,
            realTotalCost: realTotalCost,
            realMargin: realMargin,
            // Flags Anomali
            isMaterialOver: isMaterialOver,
            isMaterialOverBudget: isMaterialOverBudget,
            isLaborOver: isLaborOver,
            isLaborOverBudget: isLaborOverBudget,
            isOperasionalOver: isOperasionalOver,
            isOperasionalOverBudget: isOperasionalOverBudget,
            isMarginThin: isMarginThin,
            isMarginUnderTarget: isMarginUnderTarget,
            hasAnomaly: hasAnomaly,
            anomalies: anomalies,
            // Sisa & Variansi Kuota Budget
            materialVariance: materialVariance,
            materialRemaining: materialRemaining,
            materialPct: materialPct,
            materialUsageOfPlafon: materialUsageOfPlafon,
            laborVariance: laborVariance,
            laborRemaining: laborRemaining,
            laborPct: laborPct,
            laborUsageOfPlafon: laborUsageOfPlafon,
            operasionalVariance: operasionalVariance,
            operasionalRemaining: operasionalRemaining,
            operasionalPct: operasionalPct,
            operasionalUsageOfPlafon: operasionalUsageOfPlafon,
            marginVariance: marginVariance,
            marginDeficit: marginDeficit,
            marginPct: marginPct,
            marginAchievement: marginAchievement,
            // Status muat Rekap Cost (project_cost_summary) — dipakai panel untuk
            // membedakan "revenue memang belum diisi" vs "data gagal dimuat".
            costError: costError,
            costSummary: activeCost
        };
    }, [
        activeCost,
        stats.labor,
        costError,
        budgetMode,
        appliedPercentages,
        customValidation,
        customDraft,
        customNotApplied
    ]);
    // Sinkronkan ke stats untuk kompatibilitas penuh dengan pemanggilan legacy
    Object.assign(stats, budget);
    function openAdd() {
        if (!projectId) {
            say("Pilih proyek dulu sebelum menambah pekerjaan.");
            return;
        }
        setModal({
            mode: "add",
            form: _object_spread({}, emptyForm)
        });
    }
    function openEdit(plan) {
        var _plan_progress;
        setModal({
            mode: "edit",
            form: {
                id: plan.id,
                area: plan.area || "",
                item_name: plan.item_name || "",
                volume: plan.volume !== null && plan.volume !== undefined ? String(plan.volume) : "1",
                unit: plan.unit || "unit",
                spec: plan.spec || "",
                worker_name: plan.worker_name || "",
                worker_type: plan.worker_type || "borongan",
                labor_cost: plan.labor_cost ? formatNominalInput(String(Math.round(Number(plan.labor_cost)))) : "",
                status: plan.status || "Perencanaan",
                progress: String((_plan_progress = plan.progress) !== null && _plan_progress !== void 0 ? _plan_progress : 0),
                target_start: plan.target_start || "",
                target_end: plan.target_end || ""
            }
        });
    }
    function setFormField(name, value) {
        setModal(function(m) {
            if (!m) return m;
            var form = _object_spread_props(_object_spread({}, m.form), _define_property({}, name, value));
            // Status "Selesai" otomatis menuntaskan progress.
            if (name === "status" && value === "Selesai") form.progress = "100";
            return _object_spread_props(_object_spread({}, m), {
                form: form
            });
        });
    }
    // Update DRAFT persentase (string) — tidak menyentuh applied secara langsung.
    // Applied disinkronkan oleh efek saat draft valid; nilai invalid ditandai.
    function updateCustomPercentage(field, value) {
        setCustomDraft(function(prev) {
            return _object_spread_props(_object_spread({}, prev), _define_property({}, field, value));
        });
    }
    // Pindah mode anggaran. Kembali ke Standar → applied direset ke patokan fixed.
    // Pindah ke Custom → draft dipulihkan dari snapshot applied terakhir.
    function changeBudgetMode(mode) {
        if (mode === budgetMode) return;
        if (mode === "standard") {
            setBudgetMode("standard");
            setAppliedPercentages(STANDARD_PERCENTAGES);
            setCustomDraft(pctToDraft(STANDARD_PERCENTAGES));
            setCustomNotApplied(false);
        } else {
            setBudgetMode("custom");
            setCustomDraft(pctToDraft(appliedPercentages));
        }
    }
    function savePlan(e) {
        return _savePlan.apply(this, arguments);
    }
    function _savePlan() {
        _savePlan = _async_to_generator(function(e) {
            var f, progress, payload, _ref, err, _ref1, err1;
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        e.preventDefault();
                        if (!supabase || saving || !modal) return [
                            2
                        ];
                        f = modal.form;
                        if (!f.area.trim() || !f.item_name.trim()) {
                            say("Area dan Nama Item wajib diisi.");
                            return [
                                2
                            ];
                        }
                        setSaving(true);
                        _state.label = 1;
                    case 1:
                        _state.trys.push([
                            1,
                            ,
                            7,
                            8
                        ]);
                        progress = Math.max(0, Math.min(100, Math.round(Number(f.progress) || 0)));
                        payload = {
                            project_id: projectId,
                            area: f.area.trim(),
                            item_name: f.item_name.trim(),
                            volume: Number(f.volume) || 0,
                            unit: f.unit || "unit",
                            spec: f.spec.trim() || null,
                            worker_name: f.worker_name.trim() || null,
                            worker_type: f.worker_type || "borongan",
                            labor_cost: digitsOnly(f.labor_cost),
                            status: f.status || "Perencanaan",
                            progress: f.status === "Selesai" ? 100 : progress,
                            target_start: f.target_start || null,
                            target_end: f.target_end || null
                        };
                        if (!(modal.mode === "edit" && f.id)) return [
                            3,
                            3
                        ];
                        return [
                            4,
                            supabase.from("project_plans").update(payload).eq("id", f.id)
                        ];
                    case 2:
                        _ref = _state.sent(), err = _ref.error;
                        if (err) {
                            say("Gagal menyimpan perubahan: ".concat(err.message));
                            return [
                                2
                            ];
                        }
                        say('Pekerjaan "'.concat(payload.item_name, '" berhasil diperbarui.'));
                        return [
                            3,
                            5
                        ];
                    case 3:
                        return [
                            4,
                            supabase.from("project_plans").insert(payload)
                        ];
                    case 4:
                        _ref1 = _state.sent(), err1 = _ref1.error;
                        if (err1) {
                            say("Gagal menambah pekerjaan: ".concat(err1.message));
                            return [
                                2
                            ];
                        }
                        say('Pekerjaan "'.concat(payload.item_name, '" (').concat(payload.area, ") berhasil ditambahkan."));
                        _state.label = 5;
                    case 5:
                        setModal(null);
                        return [
                            4,
                            loadPlans()
                        ];
                    case 6:
                        _state.sent();
                        return [
                            3,
                            8
                        ];
                    case 7:
                        setSaving(false);
                        return [
                            7
                        ];
                    case 8:
                        return [
                            2
                        ];
                }
            });
        });
        return _savePlan.apply(this, arguments);
    }
    function deletePlan(plan) {
        return _deletePlan.apply(this, arguments);
    }
    function _deletePlan() {
        _deletePlan = _async_to_generator(function(plan) {
            var ok, _ref, err;
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        if (!supabase || busyId) return [
                            2
                        ];
                        ok = window.confirm('Hapus pekerjaan "'.concat(plan.item_name, '" (').concat(plan.area, ")? Tindakan ini tidak bisa dibatalkan."));
                        if (!ok) return [
                            2
                        ];
                        setBusyId(plan.id);
                        _state.label = 1;
                    case 1:
                        _state.trys.push([
                            1,
                            ,
                            4,
                            5
                        ]);
                        return [
                            4,
                            supabase.from("project_plans").delete().eq("id", plan.id)
                        ];
                    case 2:
                        _ref = _state.sent(), err = _ref.error;
                        if (err) {
                            say("Gagal menghapus: ".concat(err.message));
                            return [
                                2
                            ];
                        }
                        say('Pekerjaan "'.concat(plan.item_name, '" dihapus.'));
                        return [
                            4,
                            loadPlans()
                        ];
                    case 3:
                        _state.sent();
                        return [
                            3,
                            5
                        ];
                    case 4:
                        setBusyId(null);
                        return [
                            7
                        ];
                    case 5:
                        return [
                            2
                        ];
                }
            });
        });
        return _deletePlan.apply(this, arguments);
    }
    function createPrFromPlan(plan) {
        return _createPrFromPlan.apply(this, arguments);
    }
    function _createPrFromPlan() {
        _createPrFromPlan = // Shortcut "+ Buat PR Material": membuat PR DRAFT + 1 item terisi otomatis
        // (mengikuti konvensi modul Purchase Request: status DRAFT, item
        // PENDING_APPROVAL, nomor dari RPC next_pr_number).
        _async_to_generator(function(plan) {
            var proj, projLabel, _plan_volume, summary, ok, prNumber, _ref, rpcNum, rpcErr, e, _ref1, lastPr, maxNum, _ref2, inserted, prErr, _ref3, rp, retry, err;
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        if (!supabase || prBusyId) return [
                            2
                        ];
                        proj = allProjects.find(function(p) {
                            return p.id === plan.project_id;
                        });
                        projLabel = proj ? proj.kode ? "[".concat(proj.kode, "] ").concat(proj.name) : proj.name : "proyek";
                        summary = "".concat((_plan_volume = plan.volume) !== null && _plan_volume !== void 0 ? _plan_volume : "", " ").concat(plan.unit || "", " ").concat(plan.item_name).replace(/\s+/g, " ").trim();
                        ok = window.confirm('Buat Purchase Request material untuk:\n\n"'.concat(summary, '"\nProyek: ').concat(projLabel, "\n\nPR dibuat sebagai DRAFT dan otomatis terisi 1 item material. Lanjutkan di modul Purchase Request."));
                        if (!ok) return [
                            2
                        ];
                        setPrBusyId(plan.id);
                        _state.label = 1;
                    case 1:
                        _state.trys.push([
                            1,
                            15,
                            16,
                            17
                        ]);
                        // Nomor PR atomic (advisory lock di DB); fallback aman bila RPC gagal.
                        prNumber = null;
                        _state.label = 2;
                    case 2:
                        _state.trys.push([
                            2,
                            4,
                            ,
                            5
                        ]);
                        return [
                            4,
                            supabase.rpc("next_pr_number")
                        ];
                    case 3:
                        _ref = _state.sent(), rpcNum = _ref.data, rpcErr = _ref.error;
                        if (!rpcErr && rpcNum) prNumber = String(rpcNum);
                        return [
                            3,
                            5
                        ];
                    case 4:
                        e = _state.sent();
                        return [
                            3,
                            5
                        ];
                    case 5:
                        if (!!prNumber) return [
                            3,
                            7
                        ];
                        return [
                            4,
                            supabase.from("purchase_requests").select("pr_number").not("pr_number", "is", null).order("created_at", {
                                ascending: false
                            }).limit(200)
                        ];
                    case 6:
                        _ref1 = _state.sent(), lastPr = _ref1.data;
                        maxNum = (lastPr || []).reduce(function(max, p) {
                            var n = parseInt(String(p.pr_number || "").replace(/^\D+/, ""), 10);
                            return isFinite(n) && n > max ? n : max;
                        }, 0);
                        prNumber = "PR-" + String(maxNum + 1).padStart(3, "0");
                        _state.label = 7;
                    case 7:
                        return [
                            4,
                            supabase.from("purchase_requests").insert({
                                project_id: plan.project_id || null,
                                title: "Material: ".concat(plan.item_name),
                                pr_number: prNumber,
                                priority: "NORMAL",
                                status: "DRAFT",
                                materials_summary: summary,
                                notes: "Dari Budgeting — ".concat(plan.area).concat(plan.spec ? " (".concat(plan.spec, ")") : "")
                            }).select().single()
                        ];
                    case 8:
                        _ref2 = _state.sent(), inserted = _ref2.data, prErr = _ref2.error;
                        if (!prErr) return [
                            3,
                            13
                        ];
                        if (!(String(prErr.code) === "23505")) return [
                            3,
                            12
                        ];
                        return [
                            4,
                            supabase.rpc("next_pr_number")
                        ];
                    case 9:
                        _ref3 = _state.sent(), rp = _ref3.data;
                        if (!rp) return [
                            3,
                            12
                        ];
                        return [
                            4,
                            supabase.from("purchase_requests").insert({
                                project_id: plan.project_id || null,
                                title: "Material: ".concat(plan.item_name),
                                pr_number: String(rp),
                                priority: "NORMAL",
                                status: "DRAFT",
                                materials_summary: summary,
                                notes: "Dari Budgeting — ".concat(plan.area).concat(plan.spec ? " (".concat(plan.spec, ")") : "")
                            }).select().single()
                        ];
                    case 10:
                        retry = _state.sent();
                        if (retry.error) {
                            say("Gagal membuat PR: ".concat(retry.error.message));
                            return [
                                2
                            ];
                        }
                        return [
                            4,
                            finishPrItem(retry.data, plan, summary)
                        ];
                    case 11:
                        _state.sent();
                        return [
                            2
                        ];
                    case 12:
                        say("Gagal membuat PR: ".concat(prErr.message));
                        return [
                            2
                        ];
                    case 13:
                        return [
                            4,
                            finishPrItem(inserted, plan, summary)
                        ];
                    case 14:
                        _state.sent();
                        return [
                            3,
                            17
                        ];
                    case 15:
                        err = _state.sent();
                        say("Terjadi kesalahan saat membuat PR: ".concat(err.message));
                        return [
                            3,
                            17
                        ];
                    case 16:
                        setPrBusyId(null);
                        return [
                            7
                        ];
                    case 17:
                        return [
                            2
                        ];
                }
            });
        });
        return _createPrFromPlan.apply(this, arguments);
    }
    function finishPrItem(insertedPr, plan, summary) {
        return _finishPrItem.apply(this, arguments);
    }
    function _finishPrItem() {
        _finishPrItem = _async_to_generator(function(insertedPr, plan, summary) {
            var _ref, itemErr, e;
            return _ts_generator(this, function(_state) {
                switch(_state.label){
                    case 0:
                        return [
                            4,
                            supabase.from("pr_items").insert({
                                pr_id: insertedPr.id,
                                material_id: null,
                                item_name: plan.item_name,
                                kode: "",
                                unit: plan.unit || "unit",
                                // Volume 0 / kosong → pakai 1 supaya qty PR tidak pernah 0.
                                quantity: Number.isFinite(Number(plan.volume)) && Number(plan.volume) > 0 ? Number(plan.volume) : 1,
                                status: "PENDING_APPROVAL",
                                supplier_category: null,
                                vendor_id: null,
                                estimated_price: null,
                                sort_order: 0
                            })
                        ];
                    case 1:
                        _ref = _state.sent(), itemErr = _ref.error;
                        if (itemErr) {
                            say("PR ".concat(insertedPr.pr_number, " dibuat, tapi item gagal disimpan: ").concat(itemErr.message, ". Buka modul Purchase Request untuk melengkapi."));
                        } else {
                            say("PR ".concat(insertedPr.pr_number, ' berhasil dibuat (DRAFT) untuk "').concat(plan.item_name, '" — ').concat(summary, '. Lanjutkan di modul Purchase Request (klik "✓ Selesai" untuk kirim ke Approval).'));
                        }
                        _state.label = 2;
                    case 2:
                        _state.trys.push([
                            2,
                            5,
                            ,
                            6
                        ]);
                        if (!refresh) return [
                            3,
                            4
                        ];
                        return [
                            4,
                            refresh()
                        ];
                    case 3:
                        _state.sent();
                        _state.label = 4;
                    case 4:
                        return [
                            3,
                            6
                        ];
                    case 5:
                        e = _state.sent();
                        return [
                            3,
                            6
                        ];
                    case 6:
                        setPage && setPage("requests");
                        return [
                            2
                        ];
                }
            });
        });
        return _finishPrItem.apply(this, arguments);
    }
    return /*#__PURE__*/ _jsxs(_Fragment, {
        children: [
            /*#__PURE__*/ _jsxs("div", {
                className: "toolbar",
                style: {
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "space-between",
                    gap: "12px",
                    flexWrap: "wrap"
                },
                children: [
                    /*#__PURE__*/ _jsxs("div", {
                        children: [
                            /*#__PURE__*/ _jsxs("label", {
                                style: {
                                    display: "grid",
                                    gap: "6px",
                                    fontSize: "12px",
                                    fontWeight: 700,
                                    color: "#3b504b"
                                },
                                children: [
                                    "Proyek Aktif (",
                                    activeProjects.length,
                                    ")",
                                    /*#__PURE__*/ _jsxs("select", {
                                        value: projectId,
                                        onChange: function(e) {
                                            return setProjectId(e.target.value);
                                        },
                                        style: {
                                            minWidth: "280px",
                                            padding: "9px 13px",
                                            fontSize: "13px"
                                        },
                                        children: [
                                            activeProjects.length === 0 && /*#__PURE__*/ _jsx("option", {
                                                value: "",
                                                children: "— belum ada proyek aktif —"
                                            }),
                                            activeProjects.map(function(p) {
                                                return /*#__PURE__*/ _jsxs("option", {
                                                    value: p.id,
                                                    children: [
                                                        p.kode ? "[".concat(p.kode, "] ") : "",
                                                        p.name
                                                    ]
                                                }, p.id);
                                            })
                                        ]
                                    })
                                ]
                            }),
                            project && /*#__PURE__*/ _jsxs("div", {
                                style: {
                                    marginTop: "8px",
                                    display: "flex",
                                    gap: "8px",
                                    alignItems: "center",
                                    flexWrap: "wrap"
                                },
                                children: [
                                    /*#__PURE__*/ _jsxs("span", {
                                        className: "badge status-APPROVED",
                                        style: {
                                            fontSize: "11px"
                                        },
                                        children: [
                                            project.kode ? "[".concat(project.kode, "] ") : "",
                                            project.name
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsx("span", {
                                        className: "badge status-DRAFT",
                                        style: {
                                            fontSize: "11px"
                                        },
                                        children: project.status || "—"
                                    })
                                ]
                            })
                        ]
                    }),
                    /*#__PURE__*/ _jsxs("div", {
                        className: "toolbar-actions",
                        children: [
                            /*#__PURE__*/ _jsx("button", {
                                type: "button",
                                className: "outline",
                                onClick: loadPlans,
                                style: {
                                    padding: "9px 14px",
                                    fontSize: "13px"
                                },
                                children: "↻ Perbarui"
                            }),
                            /*#__PURE__*/ _jsx("button", {
                                type: "button",
                                className: "btn-create-module",
                                onClick: openAdd,
                                children: "+ Tambah Pekerjaan"
                            })
                        ]
                    })
                ]
            }),
            error && /*#__PURE__*/ _jsxs("div", {
                className: "notice",
                style: {
                    background: "#fee2e2",
                    borderColor: "#fca5a5",
                    color: "#991b1b"
                },
                children: [
                    "Gagal memuat data budgeting: ",
                    error
                ]
            }),
            costError && /*#__PURE__*/ _jsxs("div", {
                className: "notice",
                style: {
                    background: "#fef2f2",
                    borderColor: "#fca5a5",
                    color: "#991b1b"
                },
                children: [
                    "⚠️ Gagal memuat data Rekap Cost (project_cost_summary): ",
                    costError,
                    ". Pagu anggaran 4-pilar belum bisa dihitung — nilai di bawah BUKAN angka nol sesungguhnya. Coba tombol ↻ Perbarui; bila berulang, periksa koneksi / hak akses (RLS admin)."
                ]
            }),
            /*#__PURE__*/ _jsxs("div", {
                className: "panel budget-control-panel ".concat(budget.hasAnomaly ? "has-anomaly" : ""),
                children: [
                    /*#__PURE__*/ _jsxs("div", {
                        style: {
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: "12px",
                            marginBottom: "16px",
                            paddingBottom: "14px",
                            borderBottom: "1px solid var(--border-light)"
                        },
                        children: [
                            /*#__PURE__*/ _jsxs("div", {
                                children: [
                                    /*#__PURE__*/ _jsxs("div", {
                                        style: {
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "10px",
                                            flexWrap: "wrap",
                                            marginBottom: "8px"
                                        },
                                        children: [
                                            /*#__PURE__*/ _jsx("h3", {
                                                style: {
                                                    margin: 0,
                                                    fontSize: "15px",
                                                    fontWeight: 800,
                                                    color: "#142320",
                                                    fontFamily: "var(--font-heading)"
                                                },
                                                children: "\uD83C\uDFAF Kontrol Anggaran & Pagu Historis"
                                            }),
                                            /*#__PURE__*/ _jsxs("span", {
                                                className: "badge",
                                                style: {
                                                    background: "#e6ece9",
                                                    color: "#2d4a43",
                                                    fontSize: "10.5px",
                                                    fontWeight: 650
                                                },
                                                children: [
                                                    "Patokan: Material ",
                                                    budget.appliedPercentages.material,
                                                    "% \xb7 Upah ",
                                                    budget.appliedPercentages.manpower,
                                                    "% \xb7 Ops ",
                                                    budget.appliedPercentages.operasional,
                                                    "% \xb7 Margin ",
                                                    budget.appliedPercentages.margin,
                                                    "%"
                                                ]
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        style: {
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "12px",
                                            flexWrap: "wrap"
                                        },
                                        children: [
                                            /*#__PURE__*/ _jsxs("label", {
                                                style: {
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "8px",
                                                    background: budgetMode === "standard" ? "#e6ece9" : "#f3f4f6",
                                                    padding: "4px 12px",
                                                    borderRadius: "6px",
                                                    cursor: "pointer"
                                                },
                                                children: [
                                                    /*#__PURE__*/ _jsx("input", {
                                                        type: "radio",
                                                        name: "budgetMode",
                                                        value: "standard",
                                                        checked: budgetMode === "standard",
                                                        onChange: function() {
                                                            return changeBudgetMode("standard");
                                                        },
                                                        style: {
                                                            margin: 0
                                                        }
                                                    }),
                                                    /*#__PURE__*/ _jsx("span", {
                                                        style: {
                                                            fontSize: "13px",
                                                            fontWeight: 700,
                                                            color: "#1f2937"
                                                        },
                                                        children: "\uD83D\uDD38 Budget Standar"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("label", {
                                                style: {
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "8px",
                                                    background: budgetMode === "custom" ? "#e6ece9" : "#f3f4f6",
                                                    padding: "4px 12px",
                                                    borderRadius: "6px",
                                                    cursor: "pointer"
                                                },
                                                children: [
                                                    /*#__PURE__*/ _jsx("input", {
                                                        type: "radio",
                                                        name: "budgetMode",
                                                        value: "custom",
                                                        checked: budgetMode === "custom",
                                                        onChange: function() {
                                                            return changeBudgetMode("custom");
                                                        },
                                                        style: {
                                                            margin: 0
                                                        }
                                                    }),
                                                    /*#__PURE__*/ _jsx("span", {
                                                        style: {
                                                            fontSize: "13px",
                                                            fontWeight: 700,
                                                            color: "#1f2937"
                                                        },
                                                        children: "\uD83D\uDD38 Budget Custom"
                                                    })
                                                ]
                                            })
                                        ]
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsx("div", {
                                children: budget.revenue > 0 ? budget.hasAnomaly ? /*#__PURE__*/ _jsxs("span", {
                                    className: "badge badge-anomaly-glow",
                                    style: {
                                        background: "#fee2e2",
                                        color: "#b91c1c",
                                        border: "1.5px solid #ef4444",
                                        fontSize: "12px",
                                        padding: "6px 12px",
                                        fontWeight: 800
                                    },
                                    children: [
                                        "⚠️ ",
                                        budget.anomalies.length,
                                        " ANOMALI ANGGARAN TERDETEKSI"
                                    ]
                                }) : /*#__PURE__*/ _jsxs("span", {
                                    className: "badge",
                                    style: {
                                        background: "#e8f7ee",
                                        color: "#0d6e38",
                                        border: "1px solid #b7e4c7",
                                        fontSize: "12px",
                                        padding: "6px 12px",
                                        fontWeight: 750
                                    },
                                    children: [
                                        "✓ Semua 4-Pilar Aman (Margin ",
                                        persen(budget.marginPct, 1),
                                        ")"
                                    ]
                                }) : budget.costError ? /*#__PURE__*/ _jsx("span", {
                                    className: "badge",
                                    style: {
                                        background: "#fee2e2",
                                        color: "#b91c1c",
                                        border: "1px solid #f87171",
                                        fontSize: "12px",
                                        padding: "6px 12px",
                                        fontWeight: 700
                                    },
                                    children: "⚠️ Gagal memuat Rekap Cost — pagu belum bisa dihitung"
                                }) : /*#__PURE__*/ _jsx("span", {
                                    className: "badge",
                                    style: {
                                        background: "#fef3c7",
                                        color: "#92400e",
                                        border: "1px solid #fde68a",
                                        fontSize: "12px",
                                        padding: "6px 12px",
                                        fontWeight: 700
                                    },
                                    children: "Revenue belum diset di Rekap Cost"
                                })
                            })
                        ]
                    }),
                    budget.useCustom && /*#__PURE__*/ _jsxs("div", {
                        className: "budget-pct-panel",
                        children: [
                            /*#__PURE__*/ _jsxs("div", {
                                className: "budget-pct-panel-head",
                                children: [
                                    /*#__PURE__*/ _jsx("span", {
                                        className: "budget-pct-panel-title",
                                        children: "⚙️ Atur persentase anggaran"
                                    }),
                                    /*#__PURE__*/ _jsxs("span", {
                                        className: "budget-pct-panel-hint",
                                        children: [
                                            "Draft perubahan ",
                                            /*#__PURE__*/ _jsx("em", {
                                                children: "Belum tersimpan permanen"
                                            }),
                                            " — hanya berlaku di sesi ini."
                                        ]
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsx("div", {
                                className: "budget-pct-grid",
                                children: PCT_FIELDS.map(function(f) {
                                    var invalidField = budget.customValidation.values[f.key] === null;
                                    return /*#__PURE__*/ _jsxs("label", {
                                        className: "budget-pct-field",
                                        children: [
                                            /*#__PURE__*/ _jsxs("span", {
                                                className: "budget-pct-field-label",
                                                children: [
                                                    f.label,
                                                    " (%)"
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsx("input", {
                                                type: "number",
                                                min: "0",
                                                max: "100",
                                                step: "1",
                                                inputMode: "numeric",
                                                "aria-label": "Persentase ".concat(f.label),
                                                value: budget.draftPercentages[f.key],
                                                onChange: function(e) {
                                                    return updateCustomPercentage(f.key, e.target.value);
                                                },
                                                className: "custom-pct-input",
                                                style: {
                                                    border: invalidField ? "2px solid #ef4444" : "1px solid #cbd5e1"
                                                }
                                            })
                                        ]
                                    }, f.key);
                                })
                            }),
                            /*#__PURE__*/ _jsxs("div", {
                                className: "budget-pct-footer",
                                children: [
                                    /*#__PURE__*/ _jsxs("span", {
                                        className: "budget-pct-total",
                                        children: [
                                            "Total: ",
                                            /*#__PURE__*/ _jsxs("strong", {
                                                style: {
                                                    color: budget.customValidation.totalOk ? "#047857" : "#b91c1c"
                                                },
                                                children: [
                                                    budget.customValidation.total,
                                                    "%"
                                                ]
                                            }),
                                            " / 100%"
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("span", {
                                        className: "budget-pct-sisa",
                                        children: [
                                            "Sisa: ",
                                            /*#__PURE__*/ _jsxs("strong", {
                                                children: [
                                                    budget.customValidation.remaining,
                                                    "%"
                                                ]
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsx("span", {
                                        className: "budget-pct-status",
                                        style: {
                                            background: budget.customValidation.valid ? "#ecfdf5" : "#fef2f2",
                                            color: budget.customValidation.valid ? "#047857" : "#b91c1c",
                                            borderColor: budget.customValidation.valid ? "#d1fae5" : "#fecaca"
                                        },
                                        children: budget.customValidation.valid ? "✓ Diterapkan" : budget.customValidation.totalOk ? "⚠️ ".concat(budget.customValidation.errors[0] || "Nilai tidak valid") : "⚠️ Total melebihi 100% — belum diterapkan"
                                    })
                                ]
                            }),
                            !budget.customValidation.valid && /*#__PURE__*/ _jsxs("div", {
                                className: "budget-pct-warn",
                                children: [
                                    "Perubahan belum diterapkan. Pagu & deteksi anomali masih memakai alokasi valid terakhir",
                                    " ",
                                    "(Material ",
                                    budget.appliedPercentages.material,
                                    "% \xb7 Upah ",
                                    budget.appliedPercentages.manpower,
                                    "% \xb7",
                                    " ",
                                    "Ops ",
                                    budget.appliedPercentages.operasional,
                                    "% \xb7 Margin ",
                                    budget.appliedPercentages.margin,
                                    "%)."
                                ]
                            }),
                            budget.revenue <= 0 && /*#__PURE__*/ _jsx("div", {
                                className: "budget-pct-pending",
                                children: "ℹ️ Nilai kontrak (revenue) belum tersedia — pagu nominal menunggu. Persentase tetap dapat diatur sekarang."
                            })
                        ]
                    }),
                    /*#__PURE__*/ _jsxs("div", {
                        className: "budget-overview-strip",
                        children: [
                            /*#__PURE__*/ _jsxs("div", {
                                className: "budget-overview-item",
                                children: [
                                    /*#__PURE__*/ _jsx("span", {
                                        className: "budget-overview-label",
                                        children: "Nilai Kontrak (Revenue)"
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "budget-overview-val",
                                        children: [
                                            budget.revenue > 0 ? rupiah(budget.revenue) : budget.costError ? "Gagal Dimuat" : "Belum Diset",
                                            budget.revenue > 0 && /*#__PURE__*/ _jsx("small", {
                                                children: "Basis 100%"
                                            })
                                        ]
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("div", {
                                className: "budget-overview-item",
                                children: [
                                    /*#__PURE__*/ _jsx("span", {
                                        className: "budget-overview-label",
                                        children: "Total Realisasi Biaya"
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "budget-overview-val",
                                        children: [
                                            rupiah(budget.realTotalCost),
                                            budget.revenue > 0 && /*#__PURE__*/ _jsxs("small", {
                                                style: {
                                                    color: budget.realTotalCost > budget.revenue * 0.85 ? "#b91c1c" : "#556b65"
                                                },
                                                children: [
                                                    "(",
                                                    persen(budget.realTotalCost / budget.revenue * 100, 1),
                                                    ")"
                                                ]
                                            })
                                        ]
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("div", {
                                className: "budget-overview-item",
                                children: [
                                    /*#__PURE__*/ _jsx("span", {
                                        className: "budget-overview-label",
                                        children: "Estimasi Margin Riil"
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "budget-overview-val ".concat(budget.isMarginThin ? "danger-text" : budget.revenue > 0 ? "success-text" : ""),
                                        children: [
                                            budget.revenue > 0 ? rupiah(budget.realMargin) : "—",
                                            budget.revenue > 0 && /*#__PURE__*/ _jsxs("small", {
                                                style: {
                                                    color: budget.isMarginThin ? "#b91c1c" : "#0d6e38"
                                                },
                                                children: [
                                                    "(",
                                                    persen(budget.marginPct, 1),
                                                    ")"
                                                ]
                                            })
                                        ]
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("div", {
                                className: "budget-overview-item",
                                children: [
                                    /*#__PURE__*/ _jsx("span", {
                                        className: "budget-overview-label",
                                        children: "Status Anggaran"
                                    }),
                                    /*#__PURE__*/ _jsx("div", {
                                        style: {
                                            marginTop: "2px"
                                        },
                                        children: budget.revenue > 0 ? budget.hasAnomaly ? /*#__PURE__*/ _jsxs("span", {
                                            className: "badge",
                                            style: {
                                                background: "#fee2e2",
                                                color: "#b91c1c",
                                                border: "1px solid #f87171",
                                                fontSize: "11px",
                                                fontWeight: 800
                                            },
                                            children: [
                                                "\uD83D\uDEA8 ",
                                                budget.anomalies.length,
                                                " Pilar Over-Budget / Defisit"
                                            ]
                                        }) : /*#__PURE__*/ _jsx("span", {
                                            className: "badge",
                                            style: {
                                                background: "#e8f7ee",
                                                color: "#0d6e38",
                                                border: "1px solid #b7e4c7",
                                                fontSize: "11px",
                                                fontWeight: 750
                                            },
                                            children: "✓ Sesuai Pagu Historis"
                                        }) : budget.costError ? /*#__PURE__*/ _jsx("span", {
                                            className: "badge",
                                            style: {
                                                background: "#fee2e2",
                                                color: "#b91c1c",
                                                border: "1px solid #f87171",
                                                fontSize: "11px",
                                                fontWeight: 750
                                            },
                                            children: "⚠️ Rekap Cost Gagal Dimuat"
                                        }) : /*#__PURE__*/ _jsx("span", {
                                            className: "badge",
                                            style: {
                                                background: "#fef3c7",
                                                color: "#92400e",
                                                fontSize: "11px",
                                                fontWeight: 650
                                            },
                                            children: "Menunggu Nilai Kontrak"
                                        })
                                    })
                                ]
                            })
                        ]
                    }),
                    budget.revenue > 0 && budget.hasAnomaly && /*#__PURE__*/ _jsxs("div", {
                        className: "budget-anomaly-summary-banner",
                        children: [
                            /*#__PURE__*/ _jsxs("div", {
                                className: "anomaly-banner-top",
                                children: [
                                    /*#__PURE__*/ _jsxs("div", {
                                        style: {
                                            display: "flex",
                                            alignItems: "flex-start",
                                            gap: "10px"
                                        },
                                        children: [
                                            /*#__PURE__*/ _jsx("span", {
                                                style: {
                                                    fontSize: "24px",
                                                    lineHeight: 1
                                                },
                                                children: "⚠️"
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "anomaly-banner-title",
                                                        children: [
                                                            "PERINGATAN RANGKUMAN ANOMALI ANGGARAN (",
                                                            budget.anomalies.length,
                                                            " PILAR TERDETEKSI)"
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsx("div", {
                                                        className: "anomaly-banner-subtitle",
                                                        children: "Pengeluaran riil lapangan telah melampaui batas pagu historis Noir Living. Mohon evaluasi segera sebelum menyetujui WBS baru atau pengajuan PR material."
                                                    })
                                                ]
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsx("span", {
                                        className: "badge badge-anomaly-glow",
                                        style: {
                                            background: "#b91c1c",
                                            color: "#ffffff",
                                            fontWeight: 800,
                                            fontSize: "11px",
                                            padding: "6px 14px",
                                            alignSelf: "flex-start"
                                        },
                                        children: "OVER-BUDGET ALERT"
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsx("div", {
                                className: "anomaly-items-grid",
                                children: budget.anomalies.map(function(anom, idx) {
                                    return /*#__PURE__*/ _jsxs("div", {
                                        className: "anomaly-item-card",
                                        children: [
                                            /*#__PURE__*/ _jsxs("div", {
                                                style: {
                                                    display: "flex",
                                                    justifyContent: "space-between",
                                                    alignItems: "center",
                                                    marginBottom: "4px"
                                                },
                                                children: [
                                                    /*#__PURE__*/ _jsxs("span", {
                                                        style: {
                                                            fontWeight: 750,
                                                            fontSize: "12px",
                                                            color: "#991b1b",
                                                            display: "flex",
                                                            alignItems: "center",
                                                            gap: "5px"
                                                        },
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                children: anom.icon
                                                            }),
                                                            " ",
                                                            anom.title
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsx("span", {
                                                        className: "badge",
                                                        style: {
                                                            background: "#fee2e2",
                                                            color: "#b91c1c",
                                                            border: "1px solid #f87171",
                                                            fontWeight: 800,
                                                            fontSize: "10.5px"
                                                        },
                                                        children: anom.pillar === "Margin" ? "Defisit ".concat(anom.diffFormatted) : "Over ".concat(anom.diffFormatted)
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsx("div", {
                                                style: {
                                                    fontSize: "11.5px",
                                                    color: "#7f1d1d",
                                                    lineHeight: 1.4,
                                                    marginBottom: "6px"
                                                },
                                                children: anom.message
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                style: {
                                                    fontSize: "11px",
                                                    color: "#991b1b",
                                                    background: "#fff5f5",
                                                    padding: "5px 8px",
                                                    borderRadius: "4px",
                                                    border: "1px solid #fecaca"
                                                },
                                                children: [
                                                    /*#__PURE__*/ _jsx("strong", {
                                                        children: "\uD83D\uDCA1 Rekomendasi:"
                                                    }),
                                                    " ",
                                                    anom.recommendation
                                                ]
                                            })
                                        ]
                                    }, idx);
                                })
                            })
                        ]
                    }),
                    /*#__PURE__*/ _jsxs("div", {
                        className: "budget-cards-grid",
                        children: [
                            /*#__PURE__*/ _jsxs("div", {
                                className: "budget-card card-material ".concat(budget.isMaterialOver ? "is-anomaly" : budget.revenue > 0 ? "is-on-track" : ""),
                                children: [
                                    /*#__PURE__*/ _jsxs("div", {
                                        children: [
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "budget-card-header",
                                                children: [
                                                    /*#__PURE__*/ _jsx("span", {
                                                        className: "budget-card-title",
                                                        children: "1. Material"
                                                    }),
                                                    budget.useCustom ? /*#__PURE__*/ _jsxs("span", {
                                                        className: "badge",
                                                        style: {
                                                            background: budget.customNotApplied ? "#fef3c7" : "#e0f2fe",
                                                            color: budget.customNotApplied ? "#b45309" : "#0369a1",
                                                            fontSize: "10px",
                                                            fontWeight: 700
                                                        },
                                                        title: "Persentase diterapkan (atur di panel atas)",
                                                        children: [
                                                            budget.appliedPercentages.material,
                                                            "% Diterapkan"
                                                        ]
                                                    }) : /*#__PURE__*/ _jsx("span", {
                                                        className: "badge",
                                                        style: {
                                                            background: "#e0f2fe",
                                                            color: "#0369a1",
                                                            fontSize: "10px",
                                                            fontWeight: 700
                                                        },
                                                        children: "50% Max"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                children: [
                                                    /*#__PURE__*/ _jsx("div", {
                                                        className: "budget-card-nominal",
                                                        children: budget.revenue > 0 ? rupiah(budget.budgetMaterial) : "—"
                                                    }),
                                                    /*#__PURE__*/ _jsx("div", {
                                                        className: "budget-card-sub",
                                                        children: "Batas Pagu (Maksimal Rp)"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "budget-card-details",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "budget-detail-row",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                className: "budget-detail-label",
                                                                children: "Pengeluaran Riil:"
                                                            }),
                                                            /*#__PURE__*/ _jsx("span", {
                                                                className: "budget-detail-val ".concat(budget.isMaterialOver ? "danger-text" : ""),
                                                                children: budget.costError ? "—" : rupiah(budget.realMaterial)
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "budget-detail-row",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                className: "budget-detail-label",
                                                                children: budget.isMaterialOver ? "Over-Budget:" : "Sisa Kuota Budget:"
                                                            }),
                                                            /*#__PURE__*/ _jsx("span", {
                                                                className: "budget-detail-val ".concat(budget.isMaterialOver ? "danger-text" : "success-text"),
                                                                children: budget.revenue > 0 ? budget.isMaterialOver ? "+".concat(rupiah(budget.materialVariance)) : rupiah(budget.materialRemaining) : "—"
                                                            })
                                                        ]
                                                    })
                                                ]
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        children: [
                                            /*#__PURE__*/ _jsx("div", {
                                                children: budget.revenue > 0 ? budget.isMaterialOver ? /*#__PURE__*/ _jsxs("span", {
                                                    className: "badge badge-anomaly-glow",
                                                    style: {
                                                        background: "#fee2e2",
                                                        color: "#b91c1c",
                                                        border: "1.5px solid #ef4444",
                                                        fontWeight: 800,
                                                        fontSize: "10.5px",
                                                        whiteSpace: "normal",
                                                        lineHeight: 1.3,
                                                        display: "block",
                                                        padding: "5px 8px",
                                                        textAlign: "center"
                                                    },
                                                    children: [
                                                        "⚠️ Over-Budget (+",
                                                        rupiah(budget.materialVariance),
                                                        ")"
                                                    ]
                                                }) : /*#__PURE__*/ _jsxs("span", {
                                                    className: "badge",
                                                    style: {
                                                        background: "#e8f7ee",
                                                        color: "#0d6e38",
                                                        border: "1px solid #b7e4c7",
                                                        fontWeight: 750,
                                                        fontSize: "11px",
                                                        display: "block",
                                                        textAlign: "center",
                                                        padding: "4px 8px"
                                                    },
                                                    children: [
                                                        "✓ Aman (",
                                                        persen(budget.materialUsageOfPlafon, 0),
                                                        " pagu)"
                                                    ]
                                                }) : /*#__PURE__*/ _jsx("span", {
                                                    className: "badge",
                                                    style: {
                                                        background: "#fef3c7",
                                                        color: "#92400e",
                                                        border: "1px solid #fde68a",
                                                        fontSize: "10.5px",
                                                        display: "block",
                                                        textAlign: "center"
                                                    },
                                                    children: budget.costError ? "Riil: — (Rekap Cost gagal dimuat)" : "Riil: ".concat(rupiah(budget.realMaterial))
                                                })
                                            }),
                                            budget.revenue > 0 && /*#__PURE__*/ _jsx("div", {
                                                className: "budget-progress-track",
                                                title: "Pemakaian Material: ".concat(persen(budget.materialUsageOfPlafon, 1), " dari pagu 50%"),
                                                children: /*#__PURE__*/ _jsx("div", {
                                                    className: "budget-progress-fill",
                                                    style: {
                                                        width: "".concat(Math.min(100, Math.max(0, budget.materialUsageOfPlafon)), "%"),
                                                        background: budget.isMaterialOver ? "#dc2626" : "#0284c7"
                                                    }
                                                })
                                            })
                                        ]
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("div", {
                                className: "budget-card card-manpower ".concat(budget.isLaborOver ? "is-anomaly" : budget.revenue > 0 ? "is-on-track" : ""),
                                children: [
                                    /*#__PURE__*/ _jsxs("div", {
                                        children: [
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "budget-card-header",
                                                children: [
                                                    /*#__PURE__*/ _jsx("span", {
                                                        className: "budget-card-title",
                                                        children: "2. Manpower"
                                                    }),
                                                    budget.useCustom ? /*#__PURE__*/ _jsxs("span", {
                                                        className: "badge",
                                                        style: {
                                                            background: budget.customNotApplied ? "#fef3c7" : "#f0fdfa",
                                                            color: budget.customNotApplied ? "#b45309" : "#0f766e",
                                                            fontSize: "10px",
                                                            fontWeight: 700
                                                        },
                                                        title: "Persentase diterapkan (atur di panel atas)",
                                                        children: [
                                                            budget.appliedPercentages.manpower,
                                                            "% Diterapkan"
                                                        ]
                                                    }) : /*#__PURE__*/ _jsx("span", {
                                                        className: "badge",
                                                        style: {
                                                            background: "#f0fdfa",
                                                            color: "#0f766e",
                                                            fontSize: "10px",
                                                            fontWeight: 700
                                                        },
                                                        children: "25% Max"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                children: [
                                                    /*#__PURE__*/ _jsx("div", {
                                                        className: "budget-card-nominal ".concat(budget.isLaborOver ? "danger-text" : ""),
                                                        children: budget.revenue > 0 ? rupiah(budget.budgetManpower) : "—"
                                                    }),
                                                    /*#__PURE__*/ _jsx("div", {
                                                        className: "budget-card-sub",
                                                        children: "Batas Pagu (Maksimal Rp)"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "budget-card-details",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "budget-detail-row",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                className: "budget-detail-label",
                                                                title: "Estimasi rencana dari WBS Budgeting (project_plans.labor_cost) — bukan upah yang sudah dibayar.",
                                                                children: "Estimasi Upah WBS:"
                                                            }),
                                                            /*#__PURE__*/ _jsx("span", {
                                                                className: "budget-detail-val ".concat(budget.isLaborOver ? "danger-text" : ""),
                                                                children: rupiah(budget.realLabor)
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "budget-detail-row",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                className: "budget-detail-label",
                                                                children: budget.isLaborOver ? "Over-Budget:" : "Sisa Kuota Budget:"
                                                            }),
                                                            /*#__PURE__*/ _jsx("span", {
                                                                className: "budget-detail-val ".concat(budget.isLaborOver ? "danger-text" : "success-text"),
                                                                children: budget.revenue > 0 ? budget.isLaborOver ? "+".concat(rupiah(budget.laborVariance)) : rupiah(budget.laborRemaining) : "—"
                                                            })
                                                        ]
                                                    })
                                                ]
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        children: [
                                            /*#__PURE__*/ _jsx("div", {
                                                children: budget.revenue > 0 ? budget.isLaborOver ? /*#__PURE__*/ _jsxs("span", {
                                                    className: "badge badge-anomaly-glow",
                                                    style: {
                                                        background: "#fee2e2",
                                                        color: "#b91c1c",
                                                        border: "1.5px solid #ef4444",
                                                        fontWeight: 800,
                                                        fontSize: "10.5px",
                                                        whiteSpace: "normal",
                                                        lineHeight: 1.3,
                                                        display: "block",
                                                        padding: "5px 8px",
                                                        textAlign: "center"
                                                    },
                                                    children: [
                                                        "⚠️ Over-Budget (+",
                                                        rupiah(budget.laborVariance),
                                                        ")"
                                                    ]
                                                }) : /*#__PURE__*/ _jsxs("span", {
                                                    className: "badge",
                                                    style: {
                                                        background: "#e8f7ee",
                                                        color: "#0d6e38",
                                                        border: "1px solid #b7e4c7",
                                                        fontWeight: 750,
                                                        fontSize: "11px",
                                                        display: "block",
                                                        textAlign: "center",
                                                        padding: "4px 8px"
                                                    },
                                                    children: [
                                                        "✓ Aman (",
                                                        persen(budget.laborUsageOfPlafon, 0),
                                                        " pagu)"
                                                    ]
                                                }) : budget.realLabor > 0 ? /*#__PURE__*/ _jsxs("span", {
                                                    className: "badge",
                                                    style: {
                                                        background: "#fef3c7",
                                                        color: "#92400e",
                                                        border: "1px solid #fde68a",
                                                        fontSize: "10.5px",
                                                        display: "block",
                                                        textAlign: "center"
                                                    },
                                                    children: [
                                                        "WBS: ",
                                                        rupiah(budget.realLabor)
                                                    ]
                                                }) : /*#__PURE__*/ _jsx("span", {
                                                    className: "badge status-DRAFT",
                                                    style: {
                                                        fontSize: "10.5px",
                                                        display: "block",
                                                        textAlign: "center"
                                                    },
                                                    children: "Belum ada WBS"
                                                })
                                            }),
                                            budget.revenue > 0 && /*#__PURE__*/ _jsx("div", {
                                                className: "budget-progress-track",
                                                title: "Pemakaian Upah: ".concat(persen(budget.laborUsageOfPlafon, 1), " dari pagu 25%"),
                                                children: /*#__PURE__*/ _jsx("div", {
                                                    className: "budget-progress-fill",
                                                    style: {
                                                        width: "".concat(Math.min(100, Math.max(0, budget.laborUsageOfPlafon)), "%"),
                                                        background: budget.isLaborOver ? "#dc2626" : "#0d9488"
                                                    }
                                                })
                                            })
                                        ]
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("div", {
                                className: "budget-card card-operasional ".concat(budget.isOperasionalOver ? "is-anomaly" : budget.revenue > 0 ? "is-on-track" : ""),
                                children: [
                                    /*#__PURE__*/ _jsxs("div", {
                                        children: [
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "budget-card-header",
                                                children: [
                                                    /*#__PURE__*/ _jsx("span", {
                                                        className: "budget-card-title",
                                                        children: "3. Operasional"
                                                    }),
                                                    budget.useCustom ? /*#__PURE__*/ _jsxs("span", {
                                                        className: "badge",
                                                        style: {
                                                            background: "#fef3c7",
                                                            color: "#b45309",
                                                            fontSize: "10px",
                                                            fontWeight: 700
                                                        },
                                                        title: "Persentase diterapkan (atur di panel atas)",
                                                        children: [
                                                            budget.appliedPercentages.operasional,
                                                            "% Diterapkan"
                                                        ]
                                                    }) : /*#__PURE__*/ _jsx("span", {
                                                        className: "badge",
                                                        style: {
                                                            background: "#fef3c7",
                                                            color: "#b45309",
                                                            fontSize: "10px",
                                                            fontWeight: 700
                                                        },
                                                        children: "10% Max"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                children: [
                                                    /*#__PURE__*/ _jsx("div", {
                                                        className: "budget-card-nominal ".concat(budget.isOperasionalOver ? "danger-text" : ""),
                                                        children: budget.revenue > 0 ? rupiah(budget.budgetOperasional) : "—"
                                                    }),
                                                    /*#__PURE__*/ _jsx("div", {
                                                        className: "budget-card-sub",
                                                        children: "Batas Pagu (Maksimal Rp)"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "budget-card-details",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "budget-detail-row",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                className: "budget-detail-label",
                                                                children: "Pengeluaran Riil (Petty Cash):"
                                                            }),
                                                            /*#__PURE__*/ _jsx("span", {
                                                                className: "budget-detail-val ".concat(budget.isOperasionalOver ? "danger-text" : ""),
                                                                children: budget.costError ? "—" : rupiah(budget.realOperasional)
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "budget-detail-row",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                className: "budget-detail-label",
                                                                children: budget.isOperasionalOver ? "Over-Budget:" : "Sisa Kuota Budget:"
                                                            }),
                                                            /*#__PURE__*/ _jsx("span", {
                                                                className: "budget-detail-val ".concat(budget.isOperasionalOver ? "danger-text" : "success-text"),
                                                                children: budget.revenue > 0 ? budget.isOperasionalOver ? "+".concat(rupiah(budget.operasionalVariance)) : rupiah(budget.operasionalRemaining) : "—"
                                                            })
                                                        ]
                                                    })
                                                ]
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        children: [
                                            /*#__PURE__*/ _jsx("div", {
                                                children: budget.revenue > 0 ? budget.isOperasionalOver ? /*#__PURE__*/ _jsxs("span", {
                                                    className: "badge badge-anomaly-glow",
                                                    style: {
                                                        background: "#fee2e2",
                                                        color: "#b91c1c",
                                                        border: "1.5px solid #ef4444",
                                                        fontWeight: 800,
                                                        fontSize: "10.5px",
                                                        whiteSpace: "normal",
                                                        lineHeight: 1.3,
                                                        display: "block",
                                                        padding: "5px 8px",
                                                        textAlign: "center"
                                                    },
                                                    children: [
                                                        "⚠️ Over-Budget (+",
                                                        rupiah(budget.operasionalVariance),
                                                        ")"
                                                    ]
                                                }) : /*#__PURE__*/ _jsxs("span", {
                                                    className: "badge",
                                                    style: {
                                                        background: "#e8f7ee",
                                                        color: "#0d6e38",
                                                        border: "1px solid #b7e4c7",
                                                        fontWeight: 750,
                                                        fontSize: "11px",
                                                        display: "block",
                                                        textAlign: "center",
                                                        padding: "4px 8px"
                                                    },
                                                    children: [
                                                        "✓ Aman (",
                                                        persen(budget.operasionalUsageOfPlafon, 0),
                                                        " pagu)"
                                                    ]
                                                }) : /*#__PURE__*/ _jsx("span", {
                                                    className: "badge",
                                                    style: {
                                                        background: "#fef3c7",
                                                        color: "#92400e",
                                                        border: "1px solid #fde68a",
                                                        fontSize: "10.5px",
                                                        display: "block",
                                                        textAlign: "center"
                                                    },
                                                    children: budget.costError ? "Petty Cash: — (Rekap Cost gagal dimuat)" : "Petty Cash: ".concat(rupiah(budget.realOperasional))
                                                })
                                            }),
                                            budget.revenue > 0 && /*#__PURE__*/ _jsx("div", {
                                                className: "budget-progress-track",
                                                title: "Pemakaian Ops: ".concat(persen(budget.operasionalUsageOfPlafon, 1), " dari pagu 10%"),
                                                children: /*#__PURE__*/ _jsx("div", {
                                                    className: "budget-progress-fill",
                                                    style: {
                                                        width: "".concat(Math.min(100, Math.max(0, budget.operasionalUsageOfPlafon)), "%"),
                                                        background: budget.isOperasionalOver ? "#dc2626" : "#d97706"
                                                    }
                                                })
                                            })
                                        ]
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("div", {
                                className: "budget-card card-margin ".concat(budget.isMarginThin ? "is-anomaly" : budget.revenue > 0 ? "is-on-track" : ""),
                                children: [
                                    /*#__PURE__*/ _jsxs("div", {
                                        children: [
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "budget-card-header",
                                                children: [
                                                    /*#__PURE__*/ _jsx("span", {
                                                        className: "budget-card-title",
                                                        children: "4. Target Margin"
                                                    }),
                                                    budget.useCustom ? /*#__PURE__*/ _jsxs("span", {
                                                        className: "badge",
                                                        style: {
                                                            background: budget.customNotApplied ? "#fef3c7" : "#dcfce7",
                                                            color: budget.customNotApplied ? "#b45309" : "#15803d",
                                                            fontSize: "10px",
                                                            fontWeight: 700
                                                        },
                                                        title: "Persentase diterapkan (atur di panel atas)",
                                                        children: [
                                                            budget.appliedPercentages.margin,
                                                            "% Diterapkan"
                                                        ]
                                                    }) : /*#__PURE__*/ _jsx("span", {
                                                        className: "badge",
                                                        style: {
                                                            background: "#dcfce7",
                                                            color: "#15803d",
                                                            fontSize: "10px",
                                                            fontWeight: 700
                                                        },
                                                        children: "15% Min"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                children: [
                                                    /*#__PURE__*/ _jsx("div", {
                                                        className: "budget-card-nominal",
                                                        style: {
                                                            color: budget.revenue > 0 ? "#0d6e38" : "inherit"
                                                        },
                                                        children: budget.revenue > 0 ? rupiah(budget.targetMargin) : "—"
                                                    }),
                                                    /*#__PURE__*/ _jsx("div", {
                                                        className: "budget-card-sub",
                                                        children: "Target Minimal (Pagu 15%)"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "budget-card-details",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "budget-detail-row",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                className: "budget-detail-label",
                                                                children: "Estimasi Margin Riil:"
                                                            }),
                                                            /*#__PURE__*/ _jsx("span", {
                                                                className: "budget-detail-val ".concat(budget.isMarginThin ? "danger-text" : "success-text"),
                                                                children: budget.revenue > 0 ? rupiah(budget.realMargin) : "—"
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "budget-detail-row",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                className: "budget-detail-label",
                                                                children: budget.isMarginThin ? "Defisit Margin:" : "Surplus Margin:"
                                                            }),
                                                            /*#__PURE__*/ _jsx("span", {
                                                                className: "budget-detail-val ".concat(budget.isMarginThin ? "danger-text" : "success-text"),
                                                                children: budget.revenue > 0 ? budget.isMarginThin ? "-".concat(rupiah(budget.marginDeficit)) : "+".concat(rupiah(budget.marginVariance)) : "—"
                                                            })
                                                        ]
                                                    })
                                                ]
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        children: [
                                            /*#__PURE__*/ _jsx("div", {
                                                children: budget.revenue > 0 ? budget.isMarginThin ? /*#__PURE__*/ _jsxs("span", {
                                                    className: "badge badge-anomaly-glow",
                                                    style: {
                                                        background: "#fee2e2",
                                                        color: "#b91c1c",
                                                        border: "1.5px solid #ef4444",
                                                        fontWeight: 800,
                                                        fontSize: "10.5px",
                                                        whiteSpace: "normal",
                                                        lineHeight: 1.3,
                                                        display: "block",
                                                        padding: "5px 8px",
                                                        textAlign: "center"
                                                    },
                                                    children: [
                                                        "⚠️ Defisit Margin (-",
                                                        rupiah(budget.marginDeficit),
                                                        ")"
                                                    ]
                                                }) : /*#__PURE__*/ _jsxs("span", {
                                                    className: "badge",
                                                    style: {
                                                        background: "#e8f7ee",
                                                        color: "#0d6e38",
                                                        border: "1px solid #b7e4c7",
                                                        fontWeight: 750,
                                                        fontSize: "11px",
                                                        display: "block",
                                                        textAlign: "center",
                                                        padding: "4px 8px"
                                                    },
                                                    children: [
                                                        "✓ Aman (",
                                                        persen(budget.marginPct, 1),
                                                        " rev)"
                                                    ]
                                                }) : /*#__PURE__*/ _jsx("span", {
                                                    className: "badge status-DRAFT",
                                                    style: {
                                                        fontSize: "10.5px",
                                                        display: "block",
                                                        textAlign: "center"
                                                    },
                                                    children: "Target: 15%"
                                                })
                                            }),
                                            budget.revenue > 0 && /*#__PURE__*/ _jsx("div", {
                                                className: "budget-progress-track",
                                                title: "Pencapaian Margin: ".concat(persen(budget.marginAchievement, 1), " dari target 15%"),
                                                children: /*#__PURE__*/ _jsx("div", {
                                                    className: "budget-progress-fill",
                                                    style: {
                                                        width: "".concat(Math.min(100, Math.max(0, budget.marginAchievement)), "%"),
                                                        background: budget.isMarginThin ? "#dc2626" : "#16a34a"
                                                    }
                                                })
                                            })
                                        ]
                                    })
                                ]
                            })
                        ]
                    }),
                    /*#__PURE__*/ _jsxs("div", {
                        style: {
                            marginTop: "16px",
                            paddingTop: "14px",
                            borderTop: "1px dashed var(--border-light)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: "8px"
                        },
                        children: [
                            /*#__PURE__*/ _jsxs("div", {
                                style: {
                                    fontSize: "11.5px",
                                    color: "#71817d"
                                },
                                children: [
                                    /*#__PURE__*/ _jsx("strong", {
                                        children: "Komposisi Pagu Total (100%):"
                                    }),
                                    " Material ",
                                    budget.appliedPercentages.material,
                                    "% (",
                                    budget.revenue > 0 ? rupiah(budget.budgetMaterial) : "".concat(budget.appliedPercentages.material, "%"),
                                    ") + Upah ",
                                    budget.appliedPercentages.manpower,
                                    "% (",
                                    budget.revenue > 0 ? rupiah(budget.budgetManpower) : "".concat(budget.appliedPercentages.manpower, "%"),
                                    ") + Ops ",
                                    budget.appliedPercentages.operasional,
                                    "% (",
                                    budget.revenue > 0 ? rupiah(budget.budgetOperasional) : "".concat(budget.appliedPercentages.operasional, "%"),
                                    ") + Margin ",
                                    budget.appliedPercentages.margin,
                                    "% (",
                                    budget.revenue > 0 ? rupiah(budget.targetMargin) : "".concat(budget.appliedPercentages.margin, "%"),
                                    ") = ",
                                    /*#__PURE__*/ _jsx("strong", {
                                        children: budget.revenue > 0 ? rupiah(budget.revenue) : "100%"
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("div", {
                                style: {
                                    display: "flex",
                                    gap: "10px",
                                    alignItems: "center",
                                    fontSize: "11px",
                                    fontWeight: 650,
                                    flexWrap: "wrap"
                                },
                                children: [
                                    /*#__PURE__*/ _jsxs("span", {
                                        style: {
                                            color: budget.revenue > 0 && budget.isMaterialOver ? "#dc2626" : "#0284c7"
                                        },
                                        children: [
                                            "● Material ",
                                            budget.appliedPercentages.material,
                                            "% ",
                                            budget.revenue > 0 ? budget.isMaterialOver ? "(Over)" : "(Aman)" : "(—)"
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("span", {
                                        style: {
                                            color: budget.revenue > 0 && budget.isLaborOver ? "#dc2626" : "#0d9488"
                                        },
                                        children: [
                                            "● Upah ",
                                            budget.appliedPercentages.manpower,
                                            "% ",
                                            budget.revenue > 0 ? budget.isLaborOver ? "(Over)" : "(Aman)" : "(—)"
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("span", {
                                        style: {
                                            color: budget.revenue > 0 && budget.isOperasionalOver ? "#dc2626" : "#d97706"
                                        },
                                        children: [
                                            "● Ops ",
                                            budget.appliedPercentages.operasional,
                                            "% ",
                                            budget.revenue > 0 ? budget.isOperasionalOver ? "(Over)" : "(Aman)" : "(—)"
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("span", {
                                        style: {
                                            color: budget.revenue > 0 && budget.isMarginThin ? "#dc2626" : "#16a34a"
                                        },
                                        children: [
                                            "● Margin ",
                                            budget.appliedPercentages.margin,
                                            "% ",
                                            budget.revenue > 0 ? budget.isMarginThin ? "(Tipis)" : "(Aman)" : "(—)"
                                        ]
                                    })
                                ]
                            })
                        ]
                    })
                ]
            }),
            budget.revenue > 0 && budget.hasAnomaly && /*#__PURE__*/ _jsxs("div", {
                className: "notice",
                style: {
                    background: "#fef2f2",
                    borderColor: "#fca5a5",
                    color: "#991b1b",
                    marginBottom: "14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    flexWrap: "wrap",
                    borderRadius: "var(--radius-md)"
                },
                children: [
                    /*#__PURE__*/ _jsxs("div", {
                        style: {
                            display: "flex",
                            alignItems: "center",
                            gap: "8px"
                        },
                        children: [
                            /*#__PURE__*/ _jsx("span", {
                                style: {
                                    fontSize: "18px"
                                },
                                children: "⚠️"
                            }),
                            /*#__PURE__*/ _jsxs("span", {
                                style: {
                                    fontSize: "12.5px",
                                    fontWeight: 650
                                },
                                children: [
                                    /*#__PURE__*/ _jsx("strong", {
                                        children: "Perhatian Pekerjaan WBS:"
                                    }),
                                    " Proyek ini memiliki ",
                                    /*#__PURE__*/ _jsxs("strong", {
                                        children: [
                                            budget.anomalies.length,
                                            " anomali anggaran"
                                        ]
                                    }),
                                    " (",
                                    budget.anomalies.map(function(a) {
                                        return a.pillar;
                                    }).join(", "),
                                    "). Hindari penambahan item pekerjaan baru yang tidak tercover addendum / revisi kontrak SPK."
                                ]
                            })
                        ]
                    }),
                    /*#__PURE__*/ _jsxs("span", {
                        className: "badge badge-anomaly-glow",
                        style: {
                            background: "#b91c1c",
                            color: "#ffffff",
                            fontSize: "10.5px",
                            fontWeight: 800,
                            padding: "4px 10px"
                        },
                        children: [
                            budget.anomalies.length,
                            " Anomali Aktif"
                        ]
                    })
                ]
            }),
            /*#__PURE__*/ _jsx("div", {
                className: "panel table desktop-table-view",
                children: /*#__PURE__*/ _jsxs("table", {
                    children: [
                        /*#__PURE__*/ _jsx("thead", {
                            children: /*#__PURE__*/ _jsxs("tr", {
                                children: [
                                    /*#__PURE__*/ _jsx("th", {
                                        children: "Area"
                                    }),
                                    /*#__PURE__*/ _jsx("th", {
                                        children: "Item Pekerjaan"
                                    }),
                                    /*#__PURE__*/ _jsx("th", {
                                        children: "Volume & Satuan"
                                    }),
                                    /*#__PURE__*/ _jsx("th", {
                                        children: "Pekerja (Tukang)"
                                    }),
                                    /*#__PURE__*/ _jsx("th", {
                                        style: {
                                            textAlign: "right"
                                        },
                                        children: "Estimasi Upah"
                                    }),
                                    /*#__PURE__*/ _jsx("th", {
                                        children: "Status Progress"
                                    }),
                                    /*#__PURE__*/ _jsx("th", {
                                        style: {
                                            width: "170px",
                                            textAlign: "center"
                                        },
                                        children: "Aksi"
                                    })
                                ]
                            })
                        }),
                        /*#__PURE__*/ _jsx("tbody", {
                            children: loading ? /*#__PURE__*/ _jsx("tr", {
                                children: /*#__PURE__*/ _jsx("td", {
                                    colSpan: 7,
                                    className: "empty",
                                    children: "Memuat data pekerjaan…"
                                })
                            }) : projectPlans.length ? projectPlans.map(function(pl) {
                                return /*#__PURE__*/ _jsxs("tr", {
                                    children: [
                                        /*#__PURE__*/ _jsx("td", {
                                            style: {
                                                fontWeight: 600
                                            },
                                            children: pl.area || "—"
                                        }),
                                        /*#__PURE__*/ _jsxs("td", {
                                            style: {
                                                whiteSpace: "normal",
                                                maxWidth: "240px"
                                            },
                                            children: [
                                                /*#__PURE__*/ _jsx("div", {
                                                    style: {
                                                        fontWeight: 600
                                                    },
                                                    children: pl.item_name || "—"
                                                }),
                                                pl.spec && /*#__PURE__*/ _jsx("div", {
                                                    style: {
                                                        fontSize: "11px",
                                                        color: "#71817d",
                                                        marginTop: "2px"
                                                    },
                                                    children: pl.spec
                                                }),
                                                (pl.target_start || pl.target_end) && /*#__PURE__*/ _jsxs("div", {
                                                    style: {
                                                        fontSize: "11px",
                                                        color: "#9aa8a4",
                                                        marginTop: "2px"
                                                    },
                                                    children: [
                                                        "\uD83D\uDDD3 ",
                                                        pl.target_start || "—",
                                                        " → ",
                                                        pl.target_end || "—"
                                                    ]
                                                })
                                            ]
                                        }),
                                        /*#__PURE__*/ _jsx("td", {
                                            children: volumeText(pl.volume, pl.unit)
                                        }),
                                        /*#__PURE__*/ _jsx("td", {
                                            children: pl.worker_name ? /*#__PURE__*/ _jsxs(_Fragment, {
                                                children: [
                                                    /*#__PURE__*/ _jsx("div", {
                                                        style: {
                                                            fontWeight: 600
                                                        },
                                                        children: pl.worker_name
                                                    }),
                                                    /*#__PURE__*/ _jsx("div", {
                                                        style: {
                                                            fontSize: "11px",
                                                            color: "#71817d",
                                                            textTransform: "capitalize"
                                                        },
                                                        children: pl.worker_type || "borongan"
                                                    })
                                                ]
                                            }) : "—"
                                        }),
                                        /*#__PURE__*/ _jsx("td", {
                                            style: {
                                                textAlign: "right",
                                                fontWeight: 700
                                            },
                                            children: rupiah(pl.labor_cost || 0)
                                        }),
                                        /*#__PURE__*/ _jsxs("td", {
                                            children: [
                                                /*#__PURE__*/ _jsx("span", {
                                                    className: "badge",
                                                    style: _object_spread_props(_object_spread({}, planningStatusStyle(pl.status)), {
                                                        display: "inline-block"
                                                    }),
                                                    children: pl.status || "Perencanaan"
                                                }),
                                                /*#__PURE__*/ _jsxs("div", {
                                                    style: {
                                                        marginTop: "5px",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: "6px"
                                                    },
                                                    children: [
                                                        /*#__PURE__*/ _jsx("div", {
                                                            style: {
                                                                flex: 1,
                                                                minWidth: "60px",
                                                                height: "6px",
                                                                background: "#edf2ef",
                                                                borderRadius: "4px",
                                                                overflow: "hidden"
                                                            },
                                                            children: /*#__PURE__*/ _jsx("div", {
                                                                style: {
                                                                    width: "".concat(Math.max(0, Math.min(100, Number(pl.progress) || 0)), "%"),
                                                                    height: "100%",
                                                                    background: (Number(pl.progress) || 0) >= 100 ? "#137333" : "#1a56c4"
                                                                }
                                                            })
                                                        }),
                                                        /*#__PURE__*/ _jsxs("small", {
                                                            style: {
                                                                fontSize: "11px",
                                                                color: "#556b65",
                                                                fontWeight: 700
                                                            },
                                                            children: [
                                                                Number(pl.progress) || 0,
                                                                "%"
                                                            ]
                                                        })
                                                    ]
                                                })
                                            ]
                                        }),
                                        /*#__PURE__*/ _jsx("td", {
                                            style: {
                                                textAlign: "center"
                                            },
                                            children: /*#__PURE__*/ _jsxs("div", {
                                                style: {
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    gap: "5px",
                                                    alignItems: "stretch",
                                                    width: "140px",
                                                    margin: "0 auto"
                                                },
                                                children: [
                                                    /*#__PURE__*/ _jsx("button", {
                                                        type: "button",
                                                        className: "btn-finish",
                                                        disabled: prBusyId === pl.id,
                                                        onClick: function() {
                                                            return createPrFromPlan(pl);
                                                        },
                                                        style: {
                                                            fontSize: "10px",
                                                            padding: "5px 6px",
                                                            whiteSpace: "nowrap"
                                                        },
                                                        title: "Buat Purchase Request material dari item pekerjaan ini (otomatis terisi)",
                                                        children: prBusyId === pl.id ? "⏳ Membuat…" : "+ Buat PR Material"
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        style: {
                                                            display: "flex",
                                                            gap: "5px"
                                                        },
                                                        children: [
                                                            /*#__PURE__*/ _jsx("button", {
                                                                type: "button",
                                                                className: "btn-edit icon-btn",
                                                                style: {
                                                                    flex: 1
                                                                },
                                                                onClick: function() {
                                                                    return openEdit(pl);
                                                                },
                                                                title: "Edit pekerjaan",
                                                                children: "✏️"
                                                            }),
                                                            /*#__PURE__*/ _jsx("button", {
                                                                type: "button",
                                                                className: "btn-delete icon-btn",
                                                                style: {
                                                                    flex: 1
                                                                },
                                                                disabled: busyId === pl.id,
                                                                onClick: function() {
                                                                    return deletePlan(pl);
                                                                },
                                                                title: "Hapus pekerjaan",
                                                                children: "\uD83D\uDDD1️"
                                                            })
                                                        ]
                                                    })
                                                ]
                                            })
                                        })
                                    ]
                                }, pl.id);
                            }) : /*#__PURE__*/ _jsx("tr", {
                                children: /*#__PURE__*/ _jsx("td", {
                                    colSpan: 7,
                                    className: "empty",
                                    children: projectId ? 'Belum ada item pekerjaan untuk proyek ini. Klik "+ Tambah Pekerjaan" untuk memulai WBS.' : "Pilih proyek aktif terlebih dahulu."
                                })
                            })
                        })
                    ]
                })
            }),
            /*#__PURE__*/ _jsx("div", {
                className: "mobile-cards-view",
                children: loading ? /*#__PURE__*/ _jsx("div", {
                    className: "panel empty",
                    children: "Memuat data pekerjaan…"
                }) : projectPlans.length ? projectPlans.map(function(pl) {
                    return /*#__PURE__*/ _jsxs("div", {
                        className: "mobile-card",
                        children: [
                            /*#__PURE__*/ _jsxs("div", {
                                className: "mobile-card-header",
                                children: [
                                    /*#__PURE__*/ _jsxs("div", {
                                        children: [
                                            /*#__PURE__*/ _jsx("b", {
                                                className: "mobile-card-title",
                                                children: pl.item_name || "—"
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "mobile-card-sub",
                                                children: [
                                                    pl.area || "—",
                                                    " \xb7 ",
                                                    volumeText(pl.volume, pl.unit)
                                                ]
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsx("span", {
                                        className: "badge",
                                        style: planningStatusStyle(pl.status),
                                        children: pl.status || "Perencanaan"
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("div", {
                                className: "mobile-card-body",
                                children: [
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "mobile-card-row",
                                        children: [
                                            /*#__PURE__*/ _jsx("span", {
                                                className: "mobile-label",
                                                children: "Pekerja:"
                                            }),
                                            /*#__PURE__*/ _jsxs("span", {
                                                className: "mobile-val",
                                                children: [
                                                    pl.worker_name || "—",
                                                    " (",
                                                    pl.worker_type || "borongan",
                                                    ")"
                                                ]
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "mobile-card-row",
                                        children: [
                                            /*#__PURE__*/ _jsx("span", {
                                                className: "mobile-label",
                                                children: "Estimasi Upah:"
                                            }),
                                            /*#__PURE__*/ _jsx("span", {
                                                className: "mobile-val",
                                                style: {
                                                    fontWeight: 700
                                                },
                                                children: rupiah(pl.labor_cost || 0)
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "mobile-card-row",
                                        children: [
                                            /*#__PURE__*/ _jsx("span", {
                                                className: "mobile-label",
                                                children: "Progress:"
                                            }),
                                            /*#__PURE__*/ _jsxs("span", {
                                                className: "mobile-val",
                                                style: {
                                                    fontWeight: 700
                                                },
                                                children: [
                                                    Number(pl.progress) || 0,
                                                    "%"
                                                ]
                                            })
                                        ]
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("div", {
                                className: "mobile-card-actions",
                                style: {
                                    display: "flex",
                                    gap: "6px",
                                    flexWrap: "wrap"
                                },
                                children: [
                                    /*#__PURE__*/ _jsx("button", {
                                        type: "button",
                                        className: "btn-finish",
                                        disabled: prBusyId === pl.id,
                                        onClick: function() {
                                            return createPrFromPlan(pl);
                                        },
                                        style: {
                                            fontSize: "11px",
                                            padding: "6px 10px"
                                        },
                                        children: prBusyId === pl.id ? "⏳…" : "+ Buat PR Material"
                                    }),
                                    /*#__PURE__*/ _jsx("button", {
                                        type: "button",
                                        className: "btn-edit icon-btn",
                                        onClick: function() {
                                            return openEdit(pl);
                                        },
                                        children: "✏️"
                                    }),
                                    /*#__PURE__*/ _jsx("button", {
                                        type: "button",
                                        className: "btn-delete icon-btn",
                                        disabled: busyId === pl.id,
                                        onClick: function() {
                                            return deletePlan(pl);
                                        },
                                        children: "\uD83D\uDDD1️"
                                    })
                                ]
                            })
                        ]
                    }, pl.id);
                }) : /*#__PURE__*/ _jsx("div", {
                    className: "panel empty",
                    children: "Belum ada item pekerjaan untuk proyek ini."
                })
            }),
            modal && /*#__PURE__*/ _jsx("div", {
                className: "modal",
                children: /*#__PURE__*/ _jsxs("form", {
                    className: "dialog dialog-wide",
                    onSubmit: savePlan,
                    children: [
                        /*#__PURE__*/ _jsxs("div", {
                            className: "dialoghead",
                            children: [
                                /*#__PURE__*/ _jsxs("h2", {
                                    children: [
                                        modal.mode === "edit" ? "Edit Pekerjaan" : "Tambah Pekerjaan",
                                        " — WBS"
                                    ]
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    className: "icon",
                                    onClick: function() {
                                        return setModal(null);
                                    },
                                    children: "\xd7"
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsxs("div", {
                            style: {
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr",
                                gap: "12px"
                            },
                            children: [
                                /*#__PURE__*/ _jsxs("label", {
                                    children: [
                                        "Area / Ruangan",
                                        /*#__PURE__*/ _jsx("input", {
                                            type: "text",
                                            value: modal.form.area,
                                            onChange: function(e) {
                                                return setFormField("area", e.target.value);
                                            },
                                            placeholder: "cth: Dapur, Kamar Utama, Living Room",
                                            required: true
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("label", {
                                    children: [
                                        "Nama Item Pekerjaan",
                                        /*#__PURE__*/ _jsx("input", {
                                            type: "text",
                                            value: modal.form.item_name,
                                            onChange: function(e) {
                                                return setFormField("item_name", e.target.value);
                                            },
                                            placeholder: "cth: Kabinet Atas, Wardrobe 4 Pintu",
                                            required: true
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("label", {
                                    children: [
                                        "Volume",
                                        /*#__PURE__*/ _jsx("input", {
                                            type: "number",
                                            min: "0",
                                            step: "0.01",
                                            value: modal.form.volume,
                                            onChange: function(e) {
                                                return setFormField("volume", e.target.value);
                                            }
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("label", {
                                    children: [
                                        "Satuan",
                                        /*#__PURE__*/ _jsx("select", {
                                            value: modal.form.unit,
                                            onChange: function(e) {
                                                return setFormField("unit", e.target.value);
                                            },
                                            children: UNIT_OPTIONS.map(function(u) {
                                                return /*#__PURE__*/ _jsx("option", {
                                                    value: u,
                                                    children: u
                                                }, u);
                                            })
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("label", {
                                    style: {
                                        gridColumn: "1 / -1"
                                    },
                                    children: [
                                        "Spesifikasi Singkat (opsional)",
                                        /*#__PURE__*/ _jsx("input", {
                                            type: "text",
                                            value: modal.form.spec,
                                            onChange: function(e) {
                                                return setFormField("spec", e.target.value);
                                            },
                                            placeholder: "cth: Plywood 18mm, HPL Taco TH 120, Edging PVC"
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("label", {
                                    children: [
                                        "Nama Pekerja (Tukang / Mandor)",
                                        /*#__PURE__*/ _jsx("input", {
                                            type: "text",
                                            value: modal.form.worker_name,
                                            onChange: function(e) {
                                                return setFormField("worker_name", e.target.value);
                                            },
                                            placeholder: "cth: Pak Yanto, Pak Slamet"
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("label", {
                                    children: [
                                        "Tipe Upah",
                                        /*#__PURE__*/ _jsxs("select", {
                                            value: modal.form.worker_type,
                                            onChange: function(e) {
                                                return setFormField("worker_type", e.target.value);
                                            },
                                            children: [
                                                /*#__PURE__*/ _jsx("option", {
                                                    value: "borongan",
                                                    children: "Borongan per Item"
                                                }),
                                                /*#__PURE__*/ _jsx("option", {
                                                    value: "harian",
                                                    children: "Harian"
                                                })
                                            ]
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("label", {
                                    children: [
                                        "Estimasi Upah (Rp)",
                                        /*#__PURE__*/ _jsx("input", {
                                            type: "text",
                                            inputMode: "numeric",
                                            placeholder: "cth: 1.500.000",
                                            value: modal.form.labor_cost,
                                            onChange: function(e) {
                                                return setFormField("labor_cost", formatNominalInput(e.target.value));
                                            }
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("label", {
                                    children: [
                                        "Status Progress",
                                        /*#__PURE__*/ _jsx("select", {
                                            value: modal.form.status,
                                            onChange: function(e) {
                                                return setFormField("status", e.target.value);
                                            },
                                            children: PLANNING_STATUSES.map(function(s) {
                                                return /*#__PURE__*/ _jsx("option", {
                                                    value: s,
                                                    children: s
                                                }, s);
                                            })
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("label", {
                                    children: [
                                        "Progress (%)",
                                        /*#__PURE__*/ _jsx("input", {
                                            type: "number",
                                            min: "0",
                                            max: "100",
                                            value: modal.form.progress,
                                            onChange: function(e) {
                                                return setFormField("progress", e.target.value);
                                            }
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("label", {
                                    children: [
                                        "Target Mulai",
                                        /*#__PURE__*/ _jsx("input", {
                                            type: "date",
                                            value: modal.form.target_start,
                                            onChange: function(e) {
                                                return setFormField("target_start", e.target.value);
                                            }
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("label", {
                                    children: [
                                        "Target Selesai",
                                        /*#__PURE__*/ _jsx("input", {
                                            type: "date",
                                            value: modal.form.target_end,
                                            onChange: function(e) {
                                                return setFormField("target_end", e.target.value);
                                            }
                                        })
                                    ]
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsxs("div", {
                            className: "actions",
                            children: [
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    className: "outline",
                                    onClick: function() {
                                        return setModal(null);
                                    },
                                    children: "Batal"
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    disabled: saving,
                                    children: saving ? "Menyimpan…" : modal.mode === "edit" ? "Simpan Perubahan" : "Simpan Pekerjaan"
                                })
                            ]
                        })
                    ]
                })
            })
        ]
    });
}
