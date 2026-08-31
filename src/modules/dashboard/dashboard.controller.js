import { getMasterDashboardOverview } from "./dashboard.service.js";

export async function getOverviewController(_req, res) {
  try {
    const data = await getMasterDashboardOverview();
    return res.json({
      success: true,
      message: "Dashboard overview fetched",
      ...data,
    });
  } catch (err) {
    console.error("master dashboard overview error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to load dashboard",
    });
  }
}
