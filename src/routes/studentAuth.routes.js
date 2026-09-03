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
  enrichPublicStudent,
  toPublicStudent,
} from "../lib/studentPublicProfile.js";
import { studentAvatarUpload } from "../modules/students/profilePhoto.upload.js";
import { bufferToDataUrl } from "../lib/photo.js";
import {
  assertPersonalUnique,
  findStudentUserFromJwt,
  getPendingForUser,
  sanitizeProposed,
  snapshotFromUser,
  toPublicChange,
  upsertPendingRequest,
  validateProposed,
} from "../modules/students/profileChange.service.js";

const router = Router();

const DUMMY_HASH = bcrypt.hashSync(
  `__never_matches_${Date.now()}_${Math.random()}`,
  10
);

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
    console.log(`[student-auth] login attempt identifier="${identifier}"`);

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
        console.log(`[student-auth] login blocked mustResetPassword identifier="${identifier}"`);
        return res.status(403).json({
          success: false,
          mustResetPassword: true,
          message:
            "Password is not set yet. Use Forgot password — OTP will be sent to your registered email.",
        });
      }
      console.log(`[student-auth] login failed identifier="${identifier}"`);
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

    console.log(`[student-auth] login ok identifier="${identifier}"`);
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
    const user = await findStudentUserFromJwt(req);

    if (!user || !user.isActive) {
      return res
        .status(401)
        .json({ success: false, message: "Account not found" });
    }

    const [{ user: publicUser }, pendingProfileChange] = await Promise.all([
      enrichPublicStudent(toPublicStudent(user), {
        email: user.email,
        user,
      }),
      getPendingForUser(user),
    ]);

    const token = signStudentToken({
      sub: `student:${user._id.toString()}`,
      email: user.email,
      name: user.name || "Student",
      phone: user.phone,
    });

    return res.json({
      success: true,
      user: publicUser,
      pendingProfileChange,
      token,
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

    const found = await findStudentUserFromJwt(req);
    if (!found || !found.isActive) {
      return res
        .status(401)
        .json({ success: false, message: "Account not found" });
    }
    const user = await User.findById(found._id);
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
 * POST /api/students/auth/avatar
 * multipart field: file
 */
router.post("/avatar", requireStudentJwt, (req, res, next) => {
  studentAvatarUpload.single("file")(req, res, (err) => {
    if (err) {
      const isSize =
        err.code === "LIMIT_FILE_SIZE" ||
        /File too large/i.test(String(err.message || ""));
      return res.status(400).json({
        success: false,
        message: isSize
          ? "Photo must be 2 MB or smaller"
          : err.message || "Upload failed",
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    const user = await findStudentUserFromJwt(req);
    if (!user || !user.isActive) {
      return res
        .status(401)
        .json({ success: false, message: "Account not found" });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: "No photo received" });
    }
    return res.status(201).json({
      success: true,
      message: "Photo uploaded",
      data: {
        url: bufferToDataUrl(req.file.buffer, req.file.mimetype),
        name: req.file.originalname || "photo",
        size: req.file.size,
        mimeType: req.file.mimetype,
      },
    });
  } catch (err) {
    console.error("student avatar upload error:", err);
    return res.status(500).json({ success: false, message: "Upload failed" });
  }
});

/**
 * PATCH /api/students/auth/me
 * Submits a personal-details change request. Profile updates only after admin approval.
 */
router.patch("/me", requireStudentJwt, async (req, res) => {
  try {
    const user = await findStudentUserFromJwt(req);

    if (!user || !user.isActive) {
      return res
        .status(401)
        .json({ success: false, message: "Account not found" });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const current = snapshotFromUser(user);
    const proposed = sanitizeProposed(body, current);
    const invalid = validateProposed(proposed);
    if (invalid) {
      return res.status(400).json({ success: false, message: invalid });
    }

    await assertPersonalUnique(user, proposed);
    const entry = await upsertPendingRequest(user, proposed);
    const { user: publicUser } = await enrichPublicStudent(toPublicStudent(user), {
      email: user.email,
      user,
    });

    return res.json({
      success: true,
      pending: true,
      message:
        "Profile change submitted. It will update after admin approval.",
      pendingProfileChange: toPublicChange(entry),
      user: publicUser,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this email or mobile already exists",
      });
    }
    console.error("student patch /me error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to submit profile request" });
  }
});

export default router;
