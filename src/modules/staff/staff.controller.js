import {
  archiveStaff,
  createStaff,
  getStaffById,
  getStaffMeta,
  getStaffStats,
  listStaff,
  restoreStaff,
  updateStaff,
  updateStaffStatus,
} from "./staff.service.js";
import {
  archiveLookup,
  createLookup,
  listLookups,
  restoreLookup,
  setLookupStatus,
  updateLookup,
} from "./staffLookups.service.js";
import {
  normalizeLookupPayload,
  normalizeStaffPayload,
  validateLookupPayload,
  validateStaffPayload,
} from "./staff.validation.js";
import { STAFF_STATUSES } from "./staff.constants.js";

function getEditor(req) {
  return req.masterAdmin?.email || "master-admin";
}

function fail(res, err, fallback) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  return res.status(status).json({
    success: false,
    message: status >= 500 ? fallback : err.message || fallback,
  });
}

export async function getStaffListController(req, res) {
  try {
    const data = await listStaff({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      status: req.query.status,
      designation: req.query.designation,
      department: req.query.department,
      staffCategory: req.query.staffCategory || req.query.category,
      shift: req.query.shift,
      employmentType: req.query.employmentType,
      export: req.query.export,
      archived: req.query.archived,
    });
    return res.json({
      success: true,
      message: "Staff fetched",
      rows: data.rows,
      stats: data.stats,
      pagination: data.pagination,
    });
  } catch (err) {
    return fail(res, err, "Failed to fetch staff");
  }
}

export async function getStaffStatsController(_req, res) {
  try {
    const stats = await getStaffStats();
    return res.json({ success: true, message: "Staff stats fetched", stats });
  } catch (err) {
    return fail(res, err, "Failed to fetch staff stats");
  }
}

export async function getStaffMetaController(_req, res) {
  try {
    const meta = await getStaffMeta();
    return res.json({ success: true, message: "Staff options fetched", ...meta });
  } catch (err) {
    return fail(res, err, "Failed to fetch staff options");
  }
}

export async function getStaffController(req, res) {
  try {
    const entry = await getStaffById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: "Staff not found" });
    return res.json({ success: true, message: "Staff fetched", entry });
  } catch (err) {
    return fail(res, err, "Failed to fetch staff");
  }
}

export async function createStaffController(req, res) {
  try {
    const payload = normalizeStaffPayload(req.body || {});
    const invalid = validateStaffPayload(payload);
    if (invalid) return res.status(400).json({ success: false, message: invalid });
    const entry = await createStaff(payload, getEditor(req));
    return res.status(201).json({ success: true, message: "Staff created", entry });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "Staff ID already exists" });
    }
    return fail(res, err, "Failed to create staff");
  }
}

export async function updateStaffController(req, res) {
  try {
    const payload = normalizeStaffPayload(req.body || {});
    const invalid = validateStaffPayload(payload);
    if (invalid) return res.status(400).json({ success: false, message: invalid });
    const entry = await updateStaff(req.params.id, payload, getEditor(req));
    return res.json({ success: true, message: "Staff updated", entry });
  } catch (err) {
    return fail(res, err, "Failed to update staff");
  }
}

export async function updateStaffStatusController(req, res) {
  try {
    const status = String(req.body?.status || "").trim();
    if (!STAFF_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    const entry = await updateStaffStatus(req.params.id, status, getEditor(req));
    return res.json({ success: true, message: `Staff marked ${status}`, entry });
  } catch (err) {
    return fail(res, err, "Failed to update staff status");
  }
}

export async function archiveStaffController(req, res) {
  try {
    const entry = await archiveStaff(req.params.id, getEditor(req));
    return res.json({ success: true, message: "Staff archived", entry });
  } catch (err) {
    return fail(res, err, "Failed to archive staff");
  }
}

export async function restoreStaffController(req, res) {
  try {
    const entry = await restoreStaff(req.params.id, getEditor(req));
    return res.json({ success: true, message: "Staff restored", entry });
  } catch (err) {
    return fail(res, err, "Failed to restore staff");
  }
}

export async function uploadStaffPhotoController(req, res) {
  try {
    if (!req.file?.filename) {
      return res.status(400).json({ success: false, message: "No photo received" });
    }
    return res.status(201).json({
      success: true,
      message: "Photo uploaded",
      data: {
        url: `/uploads/staff/${req.file.filename}`,
        name: req.file.originalname || req.file.filename,
        size: req.file.size,
      },
    });
  } catch (err) {
    return fail(res, err, "Failed to upload photo");
  }
}

function lookupKind(kind) {
  return ["department", "designation", "category", "shift"].includes(kind) ? kind : null;
}

export function listLookupController(kind) {
  return async (req, res) => {
    if (!lookupKind(kind)) return res.status(400).json({ success: false, message: "Invalid lookup" });
    try {
      const rows = await listLookups(kind, req.query);
      return res.json({ success: true, message: "Fetched", rows });
    } catch (err) {
      return fail(res, err, "Failed to fetch records");
    }
  };
}

export function createLookupController(kind) {
  return async (req, res) => {
    try {
      const payload = normalizeLookupPayload(req.body || {}, kind);
      const invalid = validateLookupPayload(payload, kind);
      if (invalid) return res.status(400).json({ success: false, message: invalid });
      const entry = await createLookup(kind, payload, getEditor(req));
      return res.status(201).json({ success: true, message: "Created", entry });
    } catch (err) {
      return fail(res, err, "Failed to create record");
    }
  };
}

export function updateLookupController(kind) {
  return async (req, res) => {
    try {
      const payload = normalizeLookupPayload(req.body || {}, kind);
      const invalid = validateLookupPayload(payload, kind);
      if (invalid) return res.status(400).json({ success: false, message: invalid });
      const entry = await updateLookup(kind, req.params.id, payload, getEditor(req));
      return res.json({ success: true, message: "Updated", entry });
    } catch (err) {
      return fail(res, err, "Failed to update record");
    }
  };
}

export function statusLookupController(kind) {
  return async (req, res) => {
    try {
      const entry = await setLookupStatus(kind, req.params.id, req.body?.status, getEditor(req));
      return res.json({ success: true, message: "Status updated", entry });
    } catch (err) {
      return fail(res, err, "Failed to update status");
    }
  };
}

export function archiveLookupController(kind) {
  return async (req, res) => {
    try {
      const entry = await archiveLookup(kind, req.params.id, getEditor(req));
      return res.json({ success: true, message: "Archived", entry });
    } catch (err) {
      return fail(res, err, "Failed to archive record");
    }
  };
}

export function restoreLookupController(kind) {
  return async (req, res) => {
    try {
      const entry = await restoreLookup(kind, req.params.id, getEditor(req));
      return res.json({ success: true, message: "Restored", entry });
    } catch (err) {
      return fail(res, err, "Failed to restore record");
    }
  };
}
