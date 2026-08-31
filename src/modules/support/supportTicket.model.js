import mongoose from "mongoose";

export const TICKET_STATUSES = ["Open", "In Progress", "Resolved"];

const ticketSchema = new mongoose.Schema(
  {
    ticketId: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    studentName: { type: String, default: "", trim: true },
    subject: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: TICKET_STATUSES,
      default: "Open",
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

ticketSchema.index({ email: 1, createdAt: -1 });

export const SupportTicket = mongoose.model("SupportTicket", ticketSchema);
