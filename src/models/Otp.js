import mongoose from "mongoose";

export const OTP_PURPOSES = Object.freeze({
  SIGNUP: "signup",
  RESET_PASSWORD: "reset-password",
});

const otpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    purpose: {
      type: String,
      required: true,
      enum: Object.values(OTP_PURPOSES),
      default: OTP_PURPOSES.SIGNUP,
    },
    // bcrypt hash of the OTP — never store plain OTP
    codeHash: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    attempts: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

otpSchema.index({ email: 1, purpose: 1 });
// Auto-delete expired docs (MongoDB TTL)
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Otp = mongoose.model("Otp", otpSchema);
