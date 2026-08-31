import mongoose from "mongoose";
import { Lead, LEAD_SOURCES, LEAD_STATUSES } from "./leads.model.js";
import { emitSectionUpdate } from "../../lib/socket.js";
import { createActivityLog } from "../activityLog/activityLog.service.js";

function toRow(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  return {
    ...d,
    _id: String(d._id),
    id: String(d._id),
    enquiryId: d.enquiryId ? String(d.enquiryId) : null,
    followUp: d.followUp ? new Date(d.followUp).toISOString() : null,
    createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
    updatedAt: d.updatedAt ? new Date(d.updatedAt).toISOString() : null,
  };
}

function buildStats(rows) {
  const byStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));
  for (const row of rows) {
    if (byStatus[row.status] != null) byStatus[row.status] += 1;
  }
  const total = rows.length;
  const converted = byStatus.Converted || 0;
  const conversionRate =
    total > 0 ? `${Math.round((converted / total) * 100)}%` : "0%";

  return {
    total,
    newLeads: byStatus.New || 0,
    contacted: byStatus.Contacted || 0,
    qualified: byStatus.Qualified || 0,
    converted,
    lost: byStatus.Lost || 0,
    conversionRate,
    byStatus,
  };
}

/** Map enquiry "heard about" → lead source enum */
function mapHeardAboutToSource(heardAbout, heardAboutOther = "") {
  const heard = String(heardAbout || "").trim();
  if (heard === "Google / Search") {
    return { source: "Website", sourceOther: "" };
  }
  if (LEAD_SOURCES.includes(heard)) {
    return {
      source: heard,
      sourceOther: heard === "Others" ? String(heardAboutOther || "").trim().slice(0, 200) : "",
    };
  }
  if (heard) {
    return { source: "Others", sourceOther: heard.slice(0, 200) };
  }
  return { source: "Website", sourceOther: "" };
}

function enquiryToLeadPayload(enquiry, createdBy = "system") {
  const e = enquiry?.toObject ? enquiry.toObject() : enquiry;
  const phone = String(e.mobile || "")
    .replace(/\D/g, "")
    .slice(-10);
  const { source, sourceOther } = mapHeardAboutToSource(e.heardAbout, e.heardAboutOther);
  const interest =
    e.enquiryType === "student"
      ? String(e.courseRequested || "").trim()
      : String(e.serviceRequested || "").trim();

  const detailBits = [
    e.enquiryType === "student" ? e.trainingGoals : e.projectDetails,
    e.companyOrCollege ? `Org: ${e.companyOrCollege}` : "",
    e.city || e.state ? `Location: ${[e.city, e.state].filter(Boolean).join(", ")}` : "",
  ]
    .map((s) => String(s || "").trim())
    .filter(Boolean);

  return {
    name: String(e.fullName || "").trim() || "Unknown",
    phone: phone.length === 10 ? phone : String(e.mobile || "").trim().slice(0, 20),
    email: String(e.workEmail || "").trim().toLowerCase(),
    source,
    sourceOther,
    interest,
    counsellor: "Unassigned",
    followUp: null,
    status: "New",
    notes: detailBits.join("\n").slice(0, 2000),
    enquiryId: e._id,
    createdBy,
    updatedBy: createdBy,
  };
}

export async function listLeads({ search = "", status = "" } = {}) {
  const query = {};

  if (status && LEAD_STATUSES.includes(status)) {
    query.status = status;
  }

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { source: { $regex: search, $options: "i" } },
      { sourceOther: { $regex: search, $options: "i" } },
      { interest: { $regex: search, $options: "i" } },
      { counsellor: { $regex: search, $options: "i" } },
      { notes: { $regex: search, $options: "i" } },
      { status: { $regex: search, $options: "i" } },
    ];
  }

  const [filteredDocs, allDocs] = await Promise.all([
    Lead.find(query).sort({ createdAt: -1 }).lean().maxTimeMS(5000),
    status || search
      ? Lead.find({}).select("status").lean().maxTimeMS(5000)
      : Promise.resolve(null),
  ]);

  const rows = filteredDocs.map(toRow);
  const stats = buildStats(status || search ? (allDocs || []).map(toRow) : rows);
  return { rows, stats };
}

export async function getLeadById(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await Lead.findById(id).lean();
  return doc ? toRow(doc) : null;
}

export async function createLead(payload) {
  const data = { ...payload };
  if (data.enquiryId && mongoose.Types.ObjectId.isValid(data.enquiryId)) {
    data.enquiryId = new mongoose.Types.ObjectId(data.enquiryId);
  } else {
    data.enquiryId = null;
  }

  const created = await Lead.create(data);
  console.log(
    `[leads] created id=${created._id} name=${created.name} status=${created.status}`
  );
  return toRow(created);
}

/**
 * Create a lead from an enquiry if one does not already exist for that enquiryId.
 * Emits Socket.IO section:updated for "leads" when a new lead is created.
 */
export async function createLeadFromEnquiry(enquiry, { createdBy = "system", actor = null } = {}) {
  const e = enquiry?.toObject ? enquiry.toObject() : enquiry;
  const enquiryId = e?._id;
  if (!enquiryId || !mongoose.Types.ObjectId.isValid(enquiryId)) {
    return { lead: null, created: false, reason: "invalid_enquiry" };
  }

  const existing = await Lead.findOne({ enquiryId }).lean();
  if (existing) {
    console.log(`[leads] skip auto-create — lead already linked to enquiry ${enquiryId}`);
    return { lead: toRow(existing), created: false, reason: "already_exists" };
  }

  const payload = enquiryToLeadPayload(e, createdBy);
  if (!payload.phone || String(payload.phone).replace(/\D/g, "").length < 10) {
    console.warn(`[leads] skip auto-create — invalid phone for enquiry ${enquiryId}`);
    return { lead: null, created: false, reason: "invalid_phone" };
  }

  try {
    const created = await Lead.create(payload);
    const lead = toRow(created);
    console.log(
      `[leads] auto-created from enquiry id=${lead._id} enquiryId=${enquiryId} name=${lead.name}`
    );

    const at = new Date();
    emitSectionUpdate({
      section: "leads",
      action: "create",
      resourceId: lead._id,
      message: "Lead created from enquiry",
      at,
    });

    void createActivityLog({
      section: "leads",
      action: "create",
      method: "POST",
      path: "/api/leads/from-enquiry",
      actor: String(actor || createdBy || "system"),
      resourceId: lead._id,
      message: `Lead created from enquiry (${e.fullName || lead.name})`,
      statusCode: 201,
      ip: "",
      meta: { enquiryId: String(enquiryId), auto: true },
    }).catch((err) => console.error("[leads] activity log failed:", err.message));

    return { lead, created: true };
  } catch (err) {
    // Race: unique enquiryId index may reject duplicate
    if (err?.code === 11000) {
      const again = await Lead.findOne({ enquiryId }).lean();
      return {
        lead: again ? toRow(again) : null,
        created: false,
        reason: "already_exists",
      };
    }
    throw err;
  }
}

export async function getLeadIdsByEnquiryIds(enquiryIds = []) {
  const ids = enquiryIds
    .map((id) => String(id || "").trim())
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  if (!ids.length) return new Map();

  const leads = await Lead.find({ enquiryId: { $in: ids } })
    .select("_id enquiryId")
    .lean()
    .maxTimeMS(5000);

  const map = new Map();
  for (const lead of leads) {
    map.set(String(lead.enquiryId), String(lead._id));
  }
  return map;
}

export async function updateLead(id, payload) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;

  const data = { ...payload };
  if (data.enquiryId === null || data.enquiryId === "") {
    data.enquiryId = null;
  } else if (data.enquiryId && mongoose.Types.ObjectId.isValid(data.enquiryId)) {
    data.enquiryId = new mongoose.Types.ObjectId(data.enquiryId);
  } else {
    delete data.enquiryId;
  }

  const updated = await Lead.findByIdAndUpdate(id, { $set: data }, { new: true });
  if (updated) {
    console.log(
      `[leads] updated id=${updated._id} name=${updated.name} status=${updated.status}`
    );
  }
  return updated ? toRow(updated) : null;
}

export async function deleteLead(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const deleted = await Lead.findByIdAndDelete(id);
  if (deleted) {
    console.log(`[leads] deleted id=${deleted._id} name=${deleted.name}`);
  }
  return deleted ? toRow(deleted) : null;
}
