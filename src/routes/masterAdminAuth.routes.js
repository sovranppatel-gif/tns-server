import { Router } from "express";
import bcrypt from "bcryptjs";
import { signMasterAdminToken } from "../lib/jwt.js";
import { requireMasterAdminJwt } from "../middleware/requireMasterAdminJwt.js";
import { User, USER_TYPES } from "../models/User.js";

const router = Router();

// Lookup the master-admin user record in the DB. We always do an equal
// amount of work (one bcrypt compare against a dummy hash) when the user
// doesn't exist so that timing can't be used to enumerate valid emails.
// The dummy hash is generated at module load for a random, never-stored value.
const DUMMY_HASH = bcrypt.hashSync(
  `__never_matches_${Date.now()}_${Math.random()}`,
  10
);

router.post("/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").toLowerCase().trim();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Email and password are required" });
    }

    const user = await User.findOne({
      type: USER_TYPES.MASTER_ADMIN,
      email,
    });

    const hashToCompare = user?.passwordHash || DUMMY_HASH;
    const ok = await bcrypt.compare(password, hashToCompare);

    if (!user || !user.isActive || !ok) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
    }

    const name = user.name || "Master Admin";
    const sub = `master-admin:${user._id.toString()}`;
    const token = signMasterAdminToken({ sub, email: user.email, name });

    // Fire-and-forget last-login update; never blocks the login response.
    User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } })
      .catch((err) => console.error("master-admin lastLoginAt update failed:", err));

    return res.json({
      success: true,
      message: "Master admin logged in",
      token,
      user: {
        id: user._id.toString(),
        email: user.email,
        name,
        role: "master_admin",
        type: user.type,
      },
    });
  } catch (err) {
    console.error("master-admin login error:", err);
    return res.status(500).json({ success: false, message: "Login failed" });
  }
});

router.post("/logout", requireMasterAdminJwt, async (req, res) => {
  return res.json({
    success: true,
    message: "Master admin logged out",
    user: {
      email: req.masterAdmin.email,
      name: req.masterAdmin.name,
    },
  });
});

router.get("/me", requireMasterAdminJwt, async (req, res) => {
  try {
    const user = await User.findOne({
      type: USER_TYPES.MASTER_ADMIN,
      email: req.masterAdmin.email,
    }).select("_id email name type isActive lastLoginAt");

    if (!user || !user.isActive) {
      return res
        .status(401)
        .json({ success: false, message: "Account not found" });
    }

    return res.json({
      success: true,
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name || "Master Admin",
        role: "master_admin",
        type: user.type,
      },
    });
  } catch (err) {
    console.error("master-admin /me error:", err);
    return res.status(500).json({ success: false, message: "Lookup failed" });
  }
});

export default router;
