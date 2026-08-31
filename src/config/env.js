import dotenv from "dotenv";

dotenv.config();

const required = (name, fallback = null) => {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== null) return fallback;
  throw new Error(`Missing required environment variable: ${name}`);
};

export const env = {
  port: Number(process.env.PORT) || 3001,
  nodeEnv: process.env.NODE_ENV || "development",
  mongoUri: required("MONGO_URI", "mongodb://127.0.0.1:27017/tnsDb"),
  jwtSecret: required("JWT_SECRET", "dev-only-change-me-use-strong-secret-in-production"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1d",
  masterAdminEmail: (process.env.MASTER_ADMIN_EMAIL || "masteradmin@tns.com").toLowerCase().trim(),
  masterAdminPassword: process.env.MASTER_ADMIN_PASSWORD || "",
  masterAdminPasswordHash: process.env.MASTER_ADMIN_PASSWORD_HASH || "",
  // Brevo SMTP
  smtpHost: process.env.SMTP_HOST || "smtp-relay.brevo.com",
  smtpPort: Number(process.env.SMTP_PORT) || 587,
  smtpSecure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  emailFrom:
    process.env.EMAIL_FROM || "Grow Skills Tech <noreply@growskillstech.com>",
  clientUrl: process.env.CLIENT_URL || "http://localhost:5177",
  // OTP
  otpLength: Number(process.env.OTP_LENGTH) || 6,
  otpExpiryMinutes: Number(process.env.OTP_EXPIRY_MINUTES) || 5,
};

if (env.jwtSecret.length < 32 && env.nodeEnv === "production") {
  throw new Error("JWT_SECRET must be at least 32 characters in production");
}

if ((!env.smtpUser || !env.smtpPass) && env.nodeEnv === "production") {
  throw new Error("SMTP_USER and SMTP_PASS are required in production for email OTP");
}
