import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      default: "",
      trim: true,
    },
    type: {
      type: String,
      default: "general",
      trim: true,
      index: true,
    },
    read: {
      type: Boolean,
      default: false,
      index: true,
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

notificationSchema.index({ email: 1, createdAt: -1 });
notificationSchema.index({ email: 1, read: 1, createdAt: -1 });

export const Notification = mongoose.model("Notification", notificationSchema);
