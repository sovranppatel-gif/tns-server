import { getAnalyticsOverview } from "./analytics.service.js";

export async function getAnalyticsOverviewController(req, res) {
  try {
    const data = await getAnalyticsOverview(req.query);
    return res.json({
      success: true,
      message: "Analytics overview fetched",
      ...data,
    });
  } catch (err) {
    console.error("analytics overview error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to load analytics",
    });
  }
}
