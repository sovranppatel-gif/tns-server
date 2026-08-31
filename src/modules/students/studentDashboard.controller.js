import { getStudentDashboard } from "./studentDashboard.service.js";

export async function getStudentDashboardController(req, res) {
  try {
    const data = await getStudentDashboard(req.student);
    return res.json({
      success: true,
      message: "Dashboard fetched",
      ...data,
    });
  } catch (err) {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) {
      console.error("student dashboard error:", err);
    }
    return res.status(status).json({
      success: false,
      message: status >= 500 ? "Failed to load dashboard" : err.message,
    });
  }
}
