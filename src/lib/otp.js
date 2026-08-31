import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { Otp, OTP_PURPOSES } from "../models/Otp.js";
import { sendResetPasswordOtpEmail, sendSignupOtpEmail } from "./mailer.js";

const MAX_VERIFY_ATTEMPTS = 5;

function generateOtpCode(length = env.otpLength) {
  const digits = "0123456789";
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += digits[Math.floor(Math.random() * 10)];
  }
  return code;
}

async function issueOtp(email, purpose, sendEmail) {
  const normalized = String(email || "").toLowerCase().trim();
  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + env.otpExpiryMinutes * 60 * 1000);

  await Otp.deleteMany({ email: normalized, purpose });

  await Otp.create({
    email: normalized,
    purpose,
    codeHash,
    expiresAt,
  });

  await sendEmail(normalized, code, env.otpExpiryMinutes);

  return {
    email: normalized,
    expiresInMinutes: env.otpExpiryMinutes,
    resendAfterSeconds: 60,
  };
}

async function verifyOtp(email, otp, purpose) {
  const normalized = String(email || "").toLowerCase().trim();
  const code = String(otp || "").trim();

  const record = await Otp.findOne({
    email: normalized,
    purpose,
  }).sort({ createdAt: -1 });

  if (!record) {
    const err = new Error("No OTP found. Please request a new one.");
    err.statusCode = 400;
    throw err;
  }

  if (record.expiresAt.getTime() < Date.now()) {
    await Otp.deleteOne({ _id: record._id });
    const err = new Error("OTP expired. Please request a new one.");
    err.statusCode = 400;
    throw err;
  }

  if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
    await Otp.deleteOne({ _id: record._id });
    const err = new Error("Too many invalid attempts. Please request a new OTP.");
    err.statusCode = 429;
    throw err;
  }

  // Already verified — allow reuse within expiry for the next step
  if (record.verifiedAt) {
    return { email: normalized, verified: true };
  }

  const ok = await bcrypt.compare(code, record.codeHash);
  if (!ok) {
    record.attempts += 1;
    await record.save();
    const err = new Error("Invalid OTP. Please try again.");
    err.statusCode = 400;
    throw err;
  }

  record.verifiedAt = new Date();
  await record.save();

  return { email: normalized, verified: true };
}

async function assertEmailVerified(email, purpose, missingMessage) {
  const normalized = String(email || "").toLowerCase().trim();
  const record = await Otp.findOne({
    email: normalized,
    purpose,
    verifiedAt: { $ne: null },
  }).sort({ createdAt: -1 });

  if (!record) {
    const err = new Error(missingMessage);
    err.statusCode = 400;
    throw err;
  }

  if (record.expiresAt.getTime() < Date.now()) {
    await Otp.deleteOne({ _id: record._id });
    const err = new Error("Email verification expired. Please request a new OTP.");
    err.statusCode = 400;
    throw err;
  }

  return record;
}

/**
 * Create + email a signup OTP for the given address.
 * Replaces any previous unverified signup OTP for that email.
 */
export async function issueSignupOtp(email) {
  return issueOtp(email, OTP_PURPOSES.SIGNUP, sendSignupOtpEmail);
}

/**
 * Verify a signup OTP. On success, marks the record verified.
 */
export async function verifySignupOtp(email, otp) {
  return verifyOtp(email, otp, OTP_PURPOSES.SIGNUP);
}

/**
 * Ensure email has a recently verified signup OTP (within expiry window).
 * Used at final register step.
 */
export async function assertSignupEmailVerified(email) {
  return assertEmailVerified(
    email,
    OTP_PURPOSES.SIGNUP,
    "Please verify your email with OTP first"
  );
}

/**
 * Clear signup OTPs after successful registration.
 */
export async function clearSignupOtps(email) {
  const normalized = String(email || "").toLowerCase().trim();
  await Otp.deleteMany({ email: normalized, purpose: OTP_PURPOSES.SIGNUP });
}

/**
 * Create + email a password-reset OTP for the given address.
 */
export async function issueResetPasswordOtp(email) {
  return issueOtp(
    email,
    OTP_PURPOSES.RESET_PASSWORD,
    sendResetPasswordOtpEmail
  );
}

/**
 * Verify a password-reset OTP. On success, marks the record verified.
 */
export async function verifyResetPasswordOtp(email, otp) {
  return verifyOtp(email, otp, OTP_PURPOSES.RESET_PASSWORD);
}

/**
 * Ensure email has a recently verified reset OTP (within expiry window).
 */
export async function assertResetPasswordEmailVerified(email) {
  return assertEmailVerified(
    email,
    OTP_PURPOSES.RESET_PASSWORD,
    "Please verify your email with OTP first"
  );
}

/**
 * Clear reset-password OTPs after successful password change.
 */
export async function clearResetPasswordOtps(email) {
  const normalized = String(email || "").toLowerCase().trim();
  await Otp.deleteMany({
    email: normalized,
    purpose: OTP_PURPOSES.RESET_PASSWORD,
  });
}
