import { Router } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { requireMasterAdminJwt } from "../../middleware/requireMasterAdminJwt.js";
import { requireStudentJwt } from "../../middleware/requireStudentJwt.js";
import { AssignmentTarget } from "./assignments.model.js";
import { analytics, createAssignment, deleteAssignment, evaluateSubmission, getAssignment, getStudentAssignment, listAssignments, listStudentAssignments, publishAssignment, submitStudentAssignment, updateAssignment } from "./assignments.service.js";

const router = Router();
const actor = (req) => req.masterAdmin?.email || req.faculty?.email || "master-admin";
function facultyOrAdmin(req, res, next) { const header = req.headers.authorization || ""; const token = header.startsWith("Bearer ") ? header.slice(7) : ""; try { const decoded = jwt.verify(token, env.jwtSecret); if (!["master_admin", "faculty"].includes(decoded.role)) return res.status(403).json({ success: false, message: "Assignment access denied" }); req.masterAdmin = decoded.role === "master_admin" ? { email: decoded.email, name: decoded.name, sub: decoded.sub } : undefined; req.faculty = decoded.role === "faculty" ? { email: decoded.email, name: decoded.name, sub: decoded.sub } : undefined; return next(); } catch { return res.status(401).json({ success: false, message: "Authorization required" }); } }
function handle(fn) { return async (req, res) => { try { return res.json({ success: true, message: "OK", data: await fn(req, res) }); } catch (e) { return res.status(e.status || e.statusCode || 500).json({ success: false, message: e.message || "Internal server error" }); } }; }

router.get("/student", requireStudentJwt, handle((req) => listStudentAssignments(req)));
router.get("/student/:id", requireStudentJwt, handle((req) => getStudentAssignment(req, req.params.id)));
router.post("/student/:id/submit", requireStudentJwt, handle((req) => submitStudentAssignment(req, req.params.id, req.body)));

router.use(facultyOrAdmin);
router.get("/analytics", handle(() => analytics()));
router.get("/", handle((req) => listAssignments(req.query)));
router.post("/", handle((req) => createAssignment(req.body, actor(req))));
router.get("/:id", handle((req) => getAssignment(req.params.id)));
router.put("/:id", handle((req) => updateAssignment(req.params.id, req.body, actor(req))));
router.delete("/:id", requireMasterAdminJwt, handle((req) => deleteAssignment(req.params.id, actor(req))));
router.post("/:id/publish", handle((req) => publishAssignment(req.params.id, actor(req))));
router.get("/:id/targets", handle((req) => AssignmentTarget.find({ assignmentId: req.params.id }).lean()));
router.get("/:id/submissions", handle(async (req) => { const assignment = await getAssignment(req.params.id); return assignment.students.filter((row) => row.submissionCount > 0); }));
router.post("/:id/evaluate", handle((req) => evaluateSubmission(req.params.id, req.body, actor(req))));

export default router;
