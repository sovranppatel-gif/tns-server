import { verifyMasterAdminToken } from "../lib/jwt.js";

export function requireMasterAdminJwt(req, res, next) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");

  if (type !== "Bearer" || !token) {
    return res.status(401).json({ success: false, message: "Authorization required" });
  }

  try {
    const decoded = verifyMasterAdminToken(token.trim());
    req.masterAdmin = {
      sub: decoded.sub,
      email: decoded.email,
      name: decoded.name,
    };
    return next();
  } catch (e) {
    return res.status(401).json({
      success: false,
      message: e.name === "TokenExpiredError" ? "Token expired" : "Invalid or expired token",
    });
  }
}
