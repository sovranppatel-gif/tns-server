import mongoose from "mongoose";

export function str(value) {
  return String(value ?? "").trim();
}

export function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  return err;
}

export function asObjectId(value) {
  const raw = str(value);
  if (!raw || !mongoose.Types.ObjectId.isValid(raw)) return null;
  if (String(new mongoose.Types.ObjectId(raw)) !== raw) return null;
  return new mongoose.Types.ObjectId(raw);
}

export function money(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  const raw = str(value).replace(/₹/g, "").replace(/,/g, "").replace(/\s/g, "");
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

export function signedMoney(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  const raw = str(value).replace(/₹/g, "").replace(/,/g, "").replace(/\s/g, "");
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function formatINR(amount) {
  return `₹${(Number(amount) || 0).toLocaleString("en-IN")}`;
}

export function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function toIsoDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatDateLabel(value) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function parseDate(value, fallback = null) {
  if (value === undefined || value === null || str(value) === "") return fallback;
  const raw = str(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function monthBounds(year, month) {
  const y = Number(year);
  const m = Number(month);
  const from = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const to = new Date(y, m, 1, 0, 0, 0, 0);
  return { from, to };
}

export function financialYearRange(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth();
  const startYear = month >= 3 ? year : year - 1;
  return {
    from: new Date(startYear, 3, 1, 0, 0, 0, 0),
    to: new Date(startYear + 1, 3, 1, 0, 0, 0, 0),
    label: `FY ${startYear}-${String(startYear + 1).slice(-2)}`,
  };
}

export function rangeFromPreset(preset, from, to) {
  const now = new Date();
  const customFrom = parseDate(from);
  const customTo = parseDate(to);
  if (customFrom || customTo) {
    return {
      from: customFrom ? startOfDay(customFrom) : new Date(2000, 0, 1),
      to: customTo ? endOfDay(customTo) : endOfDay(now),
    };
  }
  const key = str(preset).toLowerCase();
  if (key === "today") return { from: startOfDay(now), to: endOfDay(now) };
  if (key === "week" || key === "this-week") {
    const d = startOfDay(now);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return { from: d, to: endOfDay(now) };
  }
  if (key === "year" || key === "this-year") {
    return { from: new Date(now.getFullYear(), 0, 1), to: endOfDay(now) };
  }
  if (key === "fy" || key === "financial-year" || key === "this-financial-year") {
    const fy = financialYearRange(now);
    return { from: fy.from, to: endOfDay(now) };
  }
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: monthStart, to: endOfDay(now) };
}

export function monthKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(year, month) {
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

export function paginationParams(params = {}, { defaultLimit = 10, maxLimit = 50 } = {}) {
  const isExport = str(params.export) === "1" || str(params.export).toLowerCase() === "true";
  const page = Math.max(1, Number(params.page) || 1);
  const limit = isExport ? Math.min(2000, Number(params.limit) || 2000) : Math.min(maxLimit, Math.max(1, Number(params.limit) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit, isExport };
}

export function paginationMeta(page, limit, total) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil((total || 0) / limit)),
  };
}

export function actorOf(editor) {
  return str(editor) || "master-admin";
}

export function maskAccountNumber(value) {
  const digits = str(value).replace(/\s/g, "");
  if (digits.length < 4) return digits ? "••••" : "";
  return `${"•".repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

export function isCompletedStatus(status) {
  const key = str(status).toLowerCase();
  return key === "completed" || key === "paid" || key === "success" || key === "received";
}

export function isOpenPayableStatus(status) {
  const key = str(status).toLowerCase();
  return ["pending", "partial", "partially paid", "approved", "payment pending", "generated", "reviewed"].includes(key);
}

export function remainingOf(total, paid) {
  return Math.max(0, money(total) - money(paid));
}

export function paymentStatusFromAmounts(total, paid) {
  const t = money(total);
  const p = money(paid);
  if (t <= 0 || p >= t) return "Paid";
  if (p > 0) return "Partially Paid";
  return "Pending";
}
