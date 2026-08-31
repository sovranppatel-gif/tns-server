import { createActivityLog } from "../modules/activityLog/activityLog.service.js";
import { verifyMasterAdminToken } from "../lib/jwt.js";

const SECTION_MAP = [
  { prefix: "/api/hero-left", section: "hero-left" },
  { prefix: "/api/about", section: "about" },
  { prefix: "/api/expertise", section: "expertise" },
  { prefix: "/api/process", section: "process" },
  { prefix: "/api/services", section: "services" },
  { prefix: "/api/case-study", section: "case-study" },
  { prefix: "/api/faq", section: "faq" },
  { prefix: "/api/universities", section: "universities" },
  { prefix: "/api/courses", section: "courses" },
  { prefix: "/api/admissions", section: "admissions" },
  { prefix: "/api/fees", section: "fees" },
  { prefix: "/api/attendance", section: "attendance" },
  { prefix: "/api/batches", section: "batches" },
  { prefix: "/api/faculties", section: "faculty" },
  { prefix: "/api/staff", section: "staff" },
  { prefix: "/api/enquiries", section: "enquiries" },
  { prefix: "/api/community-join", section: "enquiries" },
  { prefix: "/api/leads", section: "leads" },
  { prefix: "/api/site-settings", section: "site-settings" },
  { prefix: "/api/master-admin/auth", section: "master-admin" },
  { prefix: "/api/students/auth", section: "students-auth" },
  { prefix: "/api/question-bank", section: "question-bank" },
  { prefix: "/api/exams", section: "online-exams" },
  { prefix: "/api/student/exams", section: "student-exams" },
];

const SKIP_PREFIXES = ["/api/activity-logs", "/health", "/uploads"];

function resolveSection(path) {
  const hit = SECTION_MAP.find((item) => path.startsWith(item.prefix));
  if (hit) return hit.section;
  if (path.startsWith("/api/")) {
    const part = path.split("/").filter(Boolean)[1];
    return part || "api";
  }
  return null;
}

function resolveAction(method, path) {
  const lower = path.toLowerCase();
  if (lower.endsWith("/login")) return "login";
  if (lower.endsWith("/logout")) return "logout";
  if (lower.includes("/toggle/")) return "toggle";
  if (lower.includes("/publish")) return "publish";
  if (lower.includes("/archive")) return "archive";
  if (lower.includes("/cancel")) return "cancel";
  if (lower.includes("/release-results")) return "result-released";
  if (lower.endsWith("/start")) return "exam-started";
  if (lower.endsWith("/submit")) return "exam-submitted";
  if (lower.includes("/answer")) return "answer-saved";
  if (lower.includes("/avatar")) return "upload";
  if (method === "POST") return "create";
  if (method === "PUT" || method === "PATCH") return "update";
  if (method === "DELETE") return "delete";
  return method.toLowerCase();
}

function extractResourceId(path) {
  const parts = path.split("/").filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (/^[a-f0-9]{24}$/i.test(part)) return part;
  }
  return "";
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || "";
}

function actorFromToken(req) {
  if (req.masterAdmin?.email) return req.masterAdmin.email;
  if (req.student?.email) return req.student.email;
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");
  if (type !== "Bearer" || !token) return "";
  try {
    const decoded = verifyMasterAdminToken(token.trim());
    return decoded.email || decoded.name || "";
  } catch {
    return "";
  }
}

function shouldSkip(path, method) {
  if (method === "OPTIONS" || method === "HEAD") return true;
  if (method === "GET" && !path.toLowerCase().endsWith("/logout")) return true;
  if (/\/answer/.test(path)) return true;
  return SKIP_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function humanMessage({ section, action, actor, body, statusCode }) {
  const who = actor || "unknown";
  if (action === "login" && statusCode < 400) return `${who} logged in`;
  if (action === "login") return `${who} failed login`;
  if (action === "logout") return `${who} logged out`;
  if (typeof body?.message === "string" && body.message.trim()) {
    return `${who} — ${body.message.trim()}`;
  }
  return `${who} ${action} ${section}`;
}

/**
 * Logs mutating API calls (and login/logout) to Mongo + the server console.
 */
export function activityLogger(req, res, next) {
  const started = Date.now();
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    try {
      const path = String(req.originalUrl || req.url || "").split("?")[0];
      const method = String(req.method || "").toUpperCase();
      const isAuthMoment = /\/login$|\/logout$/i.test(path);

      if ((!shouldSkip(path, method) || isAuthMoment) && (res.statusCode < 400 || isAuthMoment)) {
        const section = resolveSection(path);
        if (section) {
          const action =
            res.statusCode >= 400 && path.toLowerCase().endsWith("/login")
              ? "login-failed"
              : resolveAction(method, path);
          const resourceId =
            extractResourceId(path) ||
            (body?.data && (body.data._id || body.data.id)) ||
            (body?.entry && (body.entry._id || body.entry.id)) ||
            (body?.user && (body.user.id || body.user._id)) ||
            "";

          const actor =
            actorFromToken(req) ||
            (typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "") ||
            body?.user?.email ||
            "anonymous";

          const message = humanMessage({
            section,
            action,
            actor,
            body,
            statusCode: res.statusCode,
          });

          void createActivityLog({
            section,
            action,
            method,
            path,
            actor: String(actor),
            resourceId: String(resourceId || ""),
            message,
            statusCode: res.statusCode,
            ip: clientIp(req),
            meta: {
              durationMs: Date.now() - started,
              success: body?.success !== false && res.statusCode < 400,
            },
          }).catch((err) => {
            console.error("activity log write failed:", err.message);
          });
        }
      }
    } catch (err) {
      console.error("activity logger error:", err.message);
    }

    return originalJson(body);
  };

  next();
}
