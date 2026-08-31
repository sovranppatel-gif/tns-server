import {
  createFaculty,
  deleteFaculty,
  getFacultyById,
  getFacultyMeta,
  getFacultyStats,
  listFaculties,
  listFacultyExams,
  listFacultyStudents,
  updateFaculty,
  updateFacultyStatus,
} from "./faculty.service.js";
import {
  createAssignment,
  deleteAssignment,
  listAllAssignments,
  listAssignments,
  updateAssignment,
  updateAssignmentStatus,
} from "./facultyAssignment.service.js";
import {
  listFacultyAttendance,
  upsertFacultyAttendance,
} from "./facultyAttendance.service.js";
import {
  createTimetableEntry,
  deleteTimetableEntry,
  listFacultyTimetable,
  listTimetable,
  updateTimetableEntry,
} from "./facultyTimetable.service.js";
import {
  normalizeAssignmentPayload,
  normalizeAttendancePayload,
  normalizeFacultyPayload,
  normalizeTimetablePayload,
  validateAssignmentPayload,
  validateFacultyPayload,
  validateTimetablePayload,
} from "./faculty.validation.js";
import { ASSIGNMENT_STATUSES, FACULTY_STATUSES } from "./faculty.constants.js";

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

export async function getFacultiesController(req, res) {
  try {
    const data = await listFaculties({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      status: req.query.status,
      designation: req.query.designation,
      department: req.query.department,
      universityId: req.query.universityId,
      courseId: req.query.courseId,
      export: req.query.export,
    });
    return res.json({
      success: true,
      message: "Faculties fetched",
      rows: data.rows,
      stats: data.stats,
      pagination: data.pagination,
    });
  } catch (err) {
    return fail(res, err, "Failed to fetch faculties");
  }
}

export async function getFacultyStatsController(_req, res) {
  try {
    const stats = await getFacultyStats();
    return res.json({ success: true, message: "Faculty stats fetched", stats });
  } catch (err) {
    return fail(res, err, "Failed to fetch faculty stats");
  }
}

export async function getFacultyMetaController(_req, res) {
  try {
    const meta = await getFacultyMeta();
    return res.json({ success: true, message: "Faculty options fetched", ...meta });
  } catch (err) {
    return fail(res, err, "Failed to fetch faculty options");
  }
}

export async function getFacultyController(req, res) {
  try {
    const entry = await getFacultyById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: "Faculty not found" });
    return res.json({ success: true, message: "Faculty fetched", entry });
  } catch (err) {
    return fail(res, err, "Failed to fetch faculty");
  }
}

export async function createFacultyController(req, res) {
  try {
    const payload = normalizeFacultyPayload(req.body || {});
    const invalid = validateFacultyPayload(payload, { isCreate: true });
    if (invalid) return res.status(400).json({ success: false, message: invalid });
    const entry = await createFaculty(payload, getEditor(req));
    return res.status(201).json({ success: true, message: "Faculty created", entry });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "Faculty ID or email already exists" });
    }
    return fail(res, err, "Failed to create faculty");
  }
}

export async function updateFacultyController(req, res) {
  try {
    const payload = normalizeFacultyPayload(req.body || {});
    const invalid = validateFacultyPayload(payload, { isCreate: false });
    if (invalid) return res.status(400).json({ success: false, message: invalid });
    const entry = await updateFaculty(req.params.id, payload, getEditor(req));
    return res.json({ success: true, message: "Faculty updated", entry });
  } catch (err) {
    return fail(res, err, "Failed to update faculty");
  }
}

export async function updateFacultyStatusController(req, res) {
  try {
    const status = String(req.body?.status || "").trim();
    if (!FACULTY_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    const entry = await updateFacultyStatus(req.params.id, status, getEditor(req));
    return res.json({ success: true, message: `Faculty ${status.toLowerCase()}`, entry });
  } catch (err) {
    return fail(res, err, "Failed to update faculty status");
  }
}

export async function deleteFacultyController(req, res) {
  try {
    const entry = await deleteFaculty(req.params.id, getEditor(req));
    return res.json({ success: true, message: "Faculty archived", entry });
  } catch (err) {
    return fail(res, err, "Failed to delete faculty");
  }
}

export async function getAssignmentsController(req, res) {
  try {
    const data = await listAssignments(req.params.facultyId);
    return res.json({ success: true, message: "Assignments fetched", ...data });
  } catch (err) {
    return fail(res, err, "Failed to fetch assignments");
  }
}

export async function getAllAssignmentsController(req, res) {
  try {
    const data = await listAllAssignments({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      status: req.query.status,
      universityId: req.query.universityId,
      courseId: req.query.courseId,
    });
    return res.json({ success: true, message: "Assignments fetched", ...data });
  } catch (err) {
    return fail(res, err, "Failed to fetch assignments");
  }
}

export async function createAssignmentController(req, res) {
  try {
    const payload = normalizeAssignmentPayload(req.body || {});
    const invalid = validateAssignmentPayload(payload);
    if (invalid) return res.status(400).json({ success: false, message: invalid });
    const entry = await createAssignment(req.params.facultyId, payload, getEditor(req));
    return res.status(201).json({ success: true, message: "Assignment added", entry });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "Duplicate assignment" });
    }
    return fail(res, err, "Failed to add assignment");
  }
}

export async function updateAssignmentController(req, res) {
  try {
    const payload = normalizeAssignmentPayload(req.body || {});
    const invalid = validateAssignmentPayload(payload);
    if (invalid) return res.status(400).json({ success: false, message: invalid });
    const entry = await updateAssignment(
      req.params.facultyId,
      req.params.assignmentId,
      payload,
      getEditor(req)
    );
    return res.json({ success: true, message: "Assignment updated", entry });
  } catch (err) {
    return fail(res, err, "Failed to update assignment");
  }
}

export async function updateAssignmentStatusController(req, res) {
  try {
    const status = String(req.body?.status || "").trim();
    if (!ASSIGNMENT_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid assignment status" });
    }
    const entry = await updateAssignmentStatus(
      req.params.facultyId,
      req.params.assignmentId,
      status,
      getEditor(req)
    );
    return res.json({ success: true, message: "Assignment status updated", entry });
  } catch (err) {
    return fail(res, err, "Failed to update assignment status");
  }
}

export async function deleteAssignmentController(req, res) {
  try {
    const entry = await deleteAssignment(
      req.params.facultyId,
      req.params.assignmentId,
      getEditor(req)
    );
    return res.json({ success: true, message: "Assignment removed", entry });
  } catch (err) {
    return fail(res, err, "Failed to remove assignment");
  }
}

export async function getFacultyStudentsController(req, res) {
  try {
    const data = await listFacultyStudents(req.params.facultyId);
    return res.json({ success: true, message: "Faculty students fetched", ...data });
  } catch (err) {
    return fail(res, err, "Failed to fetch faculty students");
  }
}

export async function getFacultyExamsController(req, res) {
  try {
    const data = await listFacultyExams(req.params.facultyId);
    return res.json({ success: true, message: "Faculty exams fetched", ...data });
  } catch (err) {
    return fail(res, err, "Failed to fetch faculty exams");
  }
}

export async function getFacultyTimetableController(req, res) {
  try {
    const data = await listFacultyTimetable(req.params.facultyId);
    return res.json({ success: true, message: "Timetable fetched", ...data });
  } catch (err) {
    return fail(res, err, "Failed to fetch timetable");
  }
}

export async function getTimetableController(req, res) {
  try {
    const data = await listTimetable({
      facultyId: req.query.facultyId,
      batchId: req.query.batchId,
      courseId: req.query.courseId,
      day: req.query.day,
      status: req.query.status,
    });
    return res.json({ success: true, message: "Timetable fetched", ...data });
  } catch (err) {
    return fail(res, err, "Failed to fetch timetable");
  }
}

export async function createTimetableController(req, res) {
  try {
    const payload = normalizeTimetablePayload(req.body || {});
    const invalid = validateTimetablePayload(payload);
    if (invalid) return res.status(400).json({ success: false, message: invalid });
    const entry = await createTimetableEntry(req.params.facultyId, payload, getEditor(req));
    return res.status(201).json({ success: true, message: "Class added", entry });
  } catch (err) {
    return fail(res, err, "Failed to add class");
  }
}

export async function updateTimetableController(req, res) {
  try {
    const payload = normalizeTimetablePayload(req.body || {});
    const invalid = validateTimetablePayload(payload);
    if (invalid) return res.status(400).json({ success: false, message: invalid });
    const entry = await updateTimetableEntry(
      req.params.facultyId,
      req.params.entryId,
      payload,
      getEditor(req)
    );
    return res.json({ success: true, message: "Class updated", entry });
  } catch (err) {
    return fail(res, err, "Failed to update class");
  }
}

export async function deleteTimetableController(req, res) {
  try {
    const entry = await deleteTimetableEntry(
      req.params.facultyId,
      req.params.entryId,
      getEditor(req)
    );
    return res.json({ success: true, message: "Class removed", entry });
  } catch (err) {
    return fail(res, err, "Failed to remove class");
  }
}

export async function getFacultyAttendanceController(req, res) {
  try {
    const data = await listFacultyAttendance(req.params.facultyId, {
      month: req.query.month,
      date: req.query.date,
    });
    return res.json({ success: true, message: "Attendance fetched", ...data });
  } catch (err) {
    return fail(res, err, "Failed to fetch attendance");
  }
}

export async function upsertFacultyAttendanceController(req, res) {
  try {
    const payload = normalizeAttendancePayload(req.body || {});
    const entry = await upsertFacultyAttendance(req.params.facultyId, payload, getEditor(req));
    return res.json({ success: true, message: "Attendance saved", entry });
  } catch (err) {
    return fail(res, err, "Failed to save attendance");
  }
}

export async function uploadFacultyPhotoController(req, res) {
  try {
    if (!req.file?.filename) {
      return res.status(400).json({ success: false, message: "No photo received" });
    }
    return res.status(201).json({
      success: true,
      message: "Photo uploaded",
      data: {
        url: `/uploads/faculty/${req.file.filename}`,
        name: req.file.originalname || req.file.filename,
        size: req.file.size,
      },
    });
  } catch (err) {
    return fail(res, err, "Failed to upload photo");
  }
}

