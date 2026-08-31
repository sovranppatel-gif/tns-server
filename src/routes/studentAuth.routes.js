import { Router } from "express";
import bcrypt from "bcryptjs";
import { signStudentToken } from "../lib/jwt.js";
import { requireStudentJwt } from "../middleware/requireStudentJwt.js";
import {
  isMongoTransientError,
  mongoUnavailableResponse,
} from "../middleware/requireDbReady.js";
import {
  assertResetPasswordEmailVerified,
  assertSignupEmailVerified,
  clearResetPasswordOtps,
  clearSignupOtps,
  issueResetPasswordOtp,
  issueSignupOtp,
  verifyResetPasswordOtp,
  verifySignupOtp,
} from "../lib/otp.js";
import { User, USER_TYPES } from "../models/User.js";
import {
  isValidEmail,
  isValidMobile,
  maskEmail,
  resolveStudentAccount,
} from "../lib/erpStudentAccount.js";
import {
  avatarFromName,
  enrichPublicStudent,
  toPublicStudent,
} from "../lib/studentPublicProfile.js";

const router = Router();

const DUMMY_HASH = bcrypt.hashSync(
  `__never_matches_${Date.now()}_${Math.random()}`,
  10
);

const emptyAddress = () => ({
  line1: "",
  line2: "",
  city: "",
  state: "",
  pincode: "",
});
const emptyParent = () => ({
  name: "",
  relation: "",
  phone: "",
  email: "",
});
const emptyEmergency = () => ({
  name: "",
  relation: "",
  phone: "",
});

function pickTrimmed(value, max = 200) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function normalizeAddress(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    line1: pickTrimmed(src.line1, 200),
    line2: pickTrimmed(src.line2, 200),
    city: pickTrimmed(src.city, 100),
    state: pickTrimmed(src.state, 100),
    pincode: pickTrimmed(src.pincode, 12),
  };
}

function normalizeParent(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    name: pickTrimmed(src.name, 100),
    relation: pickTrimmed(src.relation, 50),
    phone: pickTrimmed(src.phone, 20),
    email: pickTrimmed(src.email, 200).toLowerCase(),
  };
}

function normalizeEmergency(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    name: pickTrimmed(src.name, 100),
    relation: pickTrimmed(src.relation, 50),
    phone: pickTrimmed(src.phone, 20),
  };
}

function normalizeEducation(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 10)
    .map((e) => ({
      level: pickTrimmed(e?.level, 80),
      institute: pickTrimmed(e?.institute, 150),
      year: pickTrimmed(e?.year, 20),
      percentage: pickTrimmed(e?.percentage, 20),
    }))
    .filter((e) => e.level || e.institute);
}

function normalizeStringList(raw, maxItems = 30, maxLen = 80) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => pickTrimmed(s, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

/**
 * POST /api/students/auth/send-otp
 * Body: { email }
 * Sends a 6-digit OTP to the email via Brevo SMTP.
 */
router.post("/send-otp", async (req, res) => {
  try {
    const email = String(req.body?.email || "").toLowerCase().trim();

    if (!email || !isValidEmail(email)) {
      return res
        .status(400)
        .json({ success: false, message: "Enter a valid email address" });
    }

    const existing = await User.findOne({
      type: USER_TYPES.STUDENT,
      email,
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists",
      });
    }

    const result = await issueSignupOtp(email);

    return res.json({
      success: true,
      message: "OTP sent to your email",
      expiresInMinutes: result.expiresInMinutes,
      resendAfterSeconds: result.resendAfterSeconds,
    });
  } catch (err) {
    console.error("student send-otp error:", err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || "Failed to send OTP",
    });
  }
});

/**
 * POST /api/students/auth/verify-otp
 * Body: { email, otp }
 */
router.post("/verify-otp", async (req, res) => {
  try {
    const email = String(req.body?.email || "").toLowerCase().trim();
    const otp = String(req.body?.otp || "").trim();

    if (!email || !isValidEmail(email)) {
      return res
        .status(400)
        .json({ success: false, message: "Enter a valid email address" });
    }
    if (!/^\d{6}$/.test(otp)) {
      return res
        .status(400)
        .json({ success: false, message: "Enter the 6-digit OTP" });
    }

    await verifySignupOtp(email, otp);

    return res.json({
      success: true,
      message: "Email verified",
      email,
    });
  } catch (err) {
    console.error("student verify-otp error:", err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || "OTP verification failed",
    });
  }
});

function readIdentifier(body) {
  return String(body?.identifier || body?.email || body?.mobile || "").trim();
}

/**
 * POST /api/students/auth/forgot-password/send-otp
 * Body: { email }  — email OR 10-digit mobile from the ERP student profile
 * OTP is always sent to the student's registered email (existing mailer).
 */
router.post("/forgot-password/send-otp", async (req, res) => {
  try {
    const { user, email } = await resolveStudentAccount(readIdentifier(req.body));
    if (!user.isActive) {
      return res.status(404).json({
        success: false,
        message: "No student found with this email or mobile number",
      });
    }

    const result = await issueResetPasswordOtp(email);

    return res.json({
      success: true,
      message: "OTP sent to your registered email",
      email,
      emailMasked: maskEmail(email),
      expiresInMinutes: result.expiresInMinutes,
      resendAfterSeconds: result.resendAfterSeconds,
    });
  } catch (err) {
    if (!err.statusCode || err.statusCode >= 500) {
      console.error("student forgot-password send-otp error:", err);
    }
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || "Failed to send OTP",
    });
  }
});

/**
 * POST /api/students/auth/forgot-password/verify-otp
 * Body: { email, otp }  — email may be the address returned by send-otp
 */
router.post("/forgot-password/verify-otp", async (req, res) => {
  try {
    const otp = String(req.body?.otp || "").trim();
    if (!/^\d{6}$/.test(otp)) {
      return res
        .status(400)
        .json({ success: false, message: "Enter the 6-digit OTP" });
    }

    let email = String(req.body?.email || "").toLowerCase().trim();
    if (!isValidEmail(email)) {
      const resolved = await resolveStudentAccount(readIdentifier(req.body));
      email = resolved.email;
    }

    await verifyResetPasswordOtp(email, otp);

    return res.json({
      success: true,
      message: "OTP verified",
      email,
    });
  } catch (err) {
    console.error("student forgot-password verify-otp error:", err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || "OTP verification failed",
    });
  }
});

/**
 * POST /api/students/auth/forgot-password/reset
 * Body: { email, password }
 * Requires a recently verified reset OTP. Returns JWT so user can enter dashboard.
 */
router.post("/forgot-password/reset", async (req, res) => {
  try {
    let email = String(req.body?.email || "").toLowerCase().trim();
    const password = String(req.body?.password || "");

    if (!isValidEmail(email)) {
      const resolved = await resolveStudentAccount(readIdentifier(req.body));
      email = resolved.email;
    }
    if (!email || !isValidEmail(email)) {
      return res
        .status(400)
        .json({ success: false, message: "Enter a valid email address" });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    try {
      await assertResetPasswordEmailVerified(email);
    } catch (e) {
      return res.status(e.statusCode || 400).json({
        success: false,
        message: e.message || "Please verify your email with OTP first",
      });
    }

    const user = await User.findOne({
      type: USER_TYPES.STUDENT,
      email,
    });
    if (!user || !user.isActive) {
      return res.status(404).json({
        success: false,
        message: "No student account found with this email",
      });
    }

    user.passwordHash = await bcrypt.hash(password, 10);
    user.mustResetPassword = false;
    user.lastLoginAt = new Date();
    await user.save();
    await clearResetPasswordOtps(email);

    const token = signStudentToken({
      sub: `student:${user._id.toString()}`,
      email: user.email,
      name: user.name || "Student",
      phone: user.phone,
    });

    return res.json({
      success: true,
      message: "Password updated successfully",
      token,
      user: toPublicStudent(user),
    });
  } catch (err) {
    console.error("student forgot-password reset error:", err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || "Failed to reset password",
    });
  }
});

const HEARD_ABOUT_OPTIONS = new Set([
  "Google / Search",
  "Instagram",
  "Facebook",
  "YouTube",
  "WhatsApp",
  "Friend / Family",
  "College / University",
  "Advertisement",
  "Partner / Counsellor",
  "Others",
]);

/**
 * POST /api/students/auth/register
 * Body: { name, email, password, mobile, heardAbout, heardAboutOther?, promoCode? }
 * Requires a recently verified email OTP.
 */
router.post("/register", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").toLowerCase().trim();
    const password = String(req.body?.password || "");
    const mobile = String(req.body?.mobile || "").replace(/\D/g, "").slice(-10);
    const promoCode =
      String(req.body?.promoCode || "").trim().toUpperCase() || null;
    const heardAbout = String(req.body?.heardAbout || "").trim();
    const heardAboutOther =
      String(req.body?.heardAboutOther || "").trim().slice(0, 200) || null;

    if (!name || !email || !password || !mobile) {
      return res.status(400).json({
        success: false,
        message: "Name, email, password and mobile are required",
      });
    }
    if (!heardAbout || !HEARD_ABOUT_OPTIONS.has(heardAbout)) {
      return res.status(400).json({
        success: false,
        message: "Please select how you heard about us",
      });
    }
    if (heardAbout === "Others" && !heardAboutOther) {
      return res.status(400).json({
        success: false,
        message: "Please tell us where you heard about us",
      });
    }
    if (!isValidEmail(email)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid email address" });
    }
    if (!isValidMobile(mobile)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid 10-digit Indian mobile number",
      });
    }
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    try {
      await assertSignupEmailVerified(email);
    } catch (e) {
      return res.status(e.statusCode || 400).json({
        success: false,
        message: e.message || "Please verify your email with OTP first",
      });
    }

    const phone = `91${mobile}`;

    const existingEmail = await User.findOne({
      type: USER_TYPES.STUDENT,
      email,
    });
    if (existingEmail) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists",
      });
    }

    const existingPhone = await User.findOne({
      type: USER_TYPES.STUDENT,
      phone,
    });
    if (existingPhone) {
      return res.status(409).json({
        success: false,
        message: "An account with this mobile number already exists",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      type: USER_TYPES.STUDENT,
      email,
      name,
      passwordHash,
      phone,
      promoCode,
      heardAbout,
      heardAboutOther: heardAbout === "Others" ? heardAboutOther : null,
      emailVerified: true,
      phoneVerified: false,
      lastLoginAt: new Date(),
    });

    await clearSignupOtps(email);

    const token = signStudentToken({
      sub: `student:${user._id.toString()}`,
      email: user.email,
      name: user.name || "Student",
      phone: user.phone,
    });

    return res.status(201).json({
      success: true,
      token,
      user: toPublicStudent(user),
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Account already exists with this email or mobile",
      });
    }
    console.error("student register error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Registration failed" });
  }
});

/**
 * POST /api/students/auth/login
 * Body: { email, password }  — email may be profile email OR 10-digit mobile
 */
router.post("/login", async (req, res) => {
  try {
    const identifier = readIdentifier(req.body);
    const password = String(req.body?.password || "");

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: "Email/mobile and password are required",
      });
    }

    let user = null;
    try {
      const resolved = await resolveStudentAccount(identifier);
      user = resolved.user;
    } catch (e) {
      if (e.statusCode && e.statusCode !== 404) {
        return res.status(e.statusCode).json({
          success: false,
          message: e.message || "Login failed",
        });
      }
    }

    const hashToCompare = user?.passwordHash || DUMMY_HASH;
    const ok = await bcrypt.compare(password, hashToCompare);

    if (!user || !user.isActive || !ok) {
      if (user?.isActive && user.mustResetPassword) {
        return res.status(403).json({
          success: false,
          mustResetPassword: true,
          message:
            "Password is not set yet. Use Forgot password — OTP will be sent to your registered email.",
        });
      }
      return res.status(401).json({
        success: false,
        message: "Invalid email/mobile or password",
      });
    }

    const token = signStudentToken({
      sub: `student:${user._id.toString()}`,
      email: user.email,
      name: user.name || "Student",
      phone: user.phone,
    });

    User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }).catch(
      (e) => console.error("student lastLoginAt update failed:", e)
    );

    return res.json({
      success: true,
      token,
      user: toPublicStudent(user),
    });
  } catch (err) {
    console.error("student login error:", err);
    if (isMongoTransientError(err)) {
      return mongoUnavailableResponse(res, err);
    }
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || "Login failed",
    });
  }
});

/**
 * GET /api/students/auth/me
 * Authorization: Bearer <student JWT>
 */
router.get("/me", requireStudentJwt, async (req, res) => {
  try {
    const user = await User.findOne({
      type: USER_TYPES.STUDENT,
      email: req.student.email,
    }).select(
      "_id email name phone promoCode heardAbout heardAboutOther emailVerified phoneVerified mustResetPassword type isActive profile erpStudentId"
    );

    if (!user || !user.isActive) {
      return res
        .status(401)
        .json({ success: false, message: "Account not found" });
    }

    const { user: publicUser } = await enrichPublicStudent(toPublicStudent(user), {
      email: user.email,
      user,
    });

    return res.json({
      success: true,
      user: publicUser,
    });
  } catch (err) {
    console.error("student /me error:", err);
    return res.status(500).json({ success: false, message: "Lookup failed" });
  }
});

/**
 * POST /api/students/auth/change-password
 * Body: { currentPassword, newPassword }
 */
router.post("/change-password", requireStudentJwt, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current and new password are required",
      });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    const user = await User.findOne({
      type: USER_TYPES.STUDENT,
      email: req.student.email,
    });
    if (!user || !user.isActive) {
      return res
        .status(401)
        .json({ success: false, message: "Account not found" });
    }

    const ok = await bcrypt.compare(currentPassword, user.passwordHash || DUMMY_HASH);
    if (!ok) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.mustResetPassword = false;
    await user.save();

    return res.json({ success: true, message: "Password updated" });
  } catch (err) {
    console.error("student change-password error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update password",
    });
  }
});

/**
 * PATCH /api/students/auth/me
 * Authorization: Bearer <student JWT>
 * Body: editable profile fields (email is not changeable here)
 */
router.patch("/me", requireStudentJwt, async (req, res) => {
  try {
    const user = await User.findOne({
      type: USER_TYPES.STUDENT,
      email: req.student.email,
    });

    if (!user || !user.isActive) {
      return res
        .status(401)
        .json({ success: false, message: "Account not found" });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const updates = {};

    if (body.name !== undefined) {
      const name = pickTrimmed(body.name, 100);
      if (!name) {
        return res
          .status(400)
          .json({ success: false, message: "Name is required" });
      }
      updates.name = name;
    }

    if (body.mobile !== undefined || body.phone !== undefined) {
      const rawMobile =
        body.mobile !== undefined ? body.mobile : body.phone;
      const mobile = String(rawMobile || "")
        .replace(/\D/g, "")
        .slice(-10);
      if (!isValidMobile(mobile)) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid 10-digit Indian mobile number",
        });
      }
      const phone = `91${mobile}`;
      if (phone !== user.phone) {
        const existingPhone = await User.findOne({
          type: USER_TYPES.STUDENT,
          phone,
          _id: { $ne: user._id },
        });
        if (existingPhone) {
          return res.status(409).json({
            success: false,
            message: "An account with this mobile number already exists",
          });
        }
        updates.phone = phone;
        updates.phoneVerified = false;
      }
    }

    const profile = {
      ...(user.profile?.toObject?.() || user.profile || {}),
    };

    const profileKeys = [
      "dob",
      "gender",
      "bloodGroup",
      "avatar",
      "batch",
      "course",
      "semester",
      "rollNo",
      "enrollmentDate",
      "trainer",
      "trainerEmail",
    ];
    for (const key of profileKeys) {
      if (body[key] !== undefined) {
        profile[key] = pickTrimmed(body[key], key === "avatar" ? 500 : 150);
      }
    }

    if (body.address !== undefined) {
      profile.address = normalizeAddress(body.address);
    }
    if (body.parent !== undefined) {
      profile.parent = normalizeParent(body.parent);
    }
    if (body.emergency !== undefined) {
      profile.emergency = normalizeEmergency(body.emergency);
    }
    if (body.education !== undefined) {
      profile.education = normalizeEducation(body.education);
    }
    if (body.skills !== undefined) {
      profile.skills = normalizeStringList(body.skills);
    }
    if (body.achievements !== undefined) {
      profile.achievements = normalizeStringList(body.achievements, 20, 150);
    }

    // Keep avatar in sync with name when avatar was auto-generated / empty
    const nextName = updates.name || user.name || "Student";
    if (!profile.avatar || String(profile.avatar).includes("ui-avatars.com")) {
      profile.avatar = avatarFromName(nextName);
    }

    updates.profile = profile;

    Object.assign(user, updates);
    user.markModified("profile");
    await user.save();

    const publicUser = toPublicStudent(user);
    const token = signStudentToken({
      sub: `student:${user._id.toString()}`,
      email: user.email,
      name: user.name || "Student",
      phone: user.phone,
    });

    return res.json({
      success: true,
      message: "Profile updated",
      token,
      user: publicUser,
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this mobile number already exists",
      });
    }
    console.error("student patch /me error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to update profile" });
  }
});

export default router;
