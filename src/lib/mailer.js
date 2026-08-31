import nodemailer from "nodemailer";
import { env } from "../config/env.js";

const transporter = nodemailer.createTransport({
  host: env.smtpHost,
  port: env.smtpPort,
  secure: env.smtpSecure,
  auth: {
    user: env.smtpUser,
    pass: env.smtpPass,
  },
});

/**
 * Send a plain/HTML email via Brevo SMTP.
 * @param {{ to: string, subject: string, text: string, html?: string }} opts
 */
export async function sendMail({ to, subject, text, html }) {
  if (!env.smtpUser || !env.smtpPass) {
    const err = new Error("SMTP is not configured on the server");
    err.statusCode = 500;
    throw err;
  }

  return transporter.sendMail({
    from: env.emailFrom,
    to,
    subject,
    text,
    html: html || text,
  });
}

/**
 * Send signup OTP email.
 */
export async function sendSignupOtpEmail(to, otp, expiryMinutes) {
  const subject = "Your Grow Skills Tech signup OTP";
  const text = `Your OTP for Grow Skills Tech signup is ${otp}. It expires in ${expiryMinutes} minutes. Do not share this code with anyone.`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a">
      <h2 style="margin:0 0 12px;color:#06151C">Grow Skills Tech</h2>
      <p style="margin:0 0 16px;color:#334155">Use this OTP to verify your email and complete signup:</p>
      <p style="margin:0 0 16px;font-size:28px;letter-spacing:6px;font-weight:700;color:#FF5E14">${otp}</p>
      <p style="margin:0;color:#64748b;font-size:13px">This code expires in ${expiryMinutes} minutes. Do not share it with anyone.</p>
    </div>
  `;
  return sendMail({ to, subject, text, html });
}

/**
 * Send forgot-password / reset OTP email.
 */
export async function sendResetPasswordOtpEmail(to, otp, expiryMinutes) {
  const subject = "Your Grow Skills Tech password reset OTP";
  const text = `Your OTP to reset your Grow Skills Tech password is ${otp}. It expires in ${expiryMinutes} minutes. Do not share this code with anyone.`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a">
      <h2 style="margin:0 0 12px;color:#06151C">Grow Skills Tech</h2>
      <p style="margin:0 0 16px;color:#334155">Use this OTP to reset your student account password:</p>
      <p style="margin:0 0 16px;font-size:28px;letter-spacing:6px;font-weight:700;color:#FF5E14">${otp}</p>
      <p style="margin:0;color:#64748b;font-size:13px">This code expires in ${expiryMinutes} minutes. Do not share it with anyone. If you did not request a password reset, you can ignore this email.</p>
    </div>
  `;
  return sendMail({ to, subject, text, html });
}

export default transporter;
