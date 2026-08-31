import { verifyStudentToken } from "../lib/jwt.js";

export function requireStudentJwt(req, res, next) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");

  if (type !== "Bearer" || !token) {
    return res.status(401).json({ success: false, message: "Authorization required" });
  }

  try {
    const decoded = verifyStudentToken(token.trim());
    req.student = {
      sub: decoded.sub,
      email: decoded.email,
      name: decoded.name,
      phone: decoded.phone || null,
    };
    return next();
  } catch (e) {
    return res.status(401).json({
      success: false,
      message: e.name === "TokenExpiredError" ? "Token expired" : "Invalid or expired token",
    });
  }
}
