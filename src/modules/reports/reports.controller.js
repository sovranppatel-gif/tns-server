import { getReport, getReportsMeta, REPORT_TYPES } from "./reports.service.js";

export async function getReportsMetaController(_req, res) {
  try {
    const meta = await getReportsMeta();
    return res.json({
      success: true,
      message: "Report filters loaded",
      ...meta,
    });
  } catch (err) {
    console.error("reports meta error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to load report filters",
    });
  }
}

export async function getReportController(req, res) {
  try {
    const raw = String(req.params.type || req.query.type || "overview").toLowerCase();
    const type = REPORT_TYPES.includes(raw) ? raw : "overview";
    const data = await getReport(type, req.query);
    return res.json({
      success: true,
      message: `${data.title} fetched`,
      ...data,
    });
  } catch (err) {
    console.error("reports fetch error:", err);
    return res.status(err.status || err.statusCode || 500).json({
      success: false,
      message: err.message || "Failed to load report",
    });
  }
}
