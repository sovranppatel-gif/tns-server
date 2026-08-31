import mongoose from "mongoose";

const lookupStatus = ["Active", "Inactive"];

function lookupSchema(extra = {}) {
  return new mongoose.Schema(
    {
      name: { type: String, required: true, trim: true },
      description: { type: String, default: "", trim: true },
      status: { type: String, enum: lookupStatus, default: "Active", index: true },
      isArchived: { type: Boolean, default: false, index: true },
      archivedAt: { type: Date, default: null },
      archivedBy: { type: String, default: "", trim: true },
      createdBy: { type: String, default: "master-admin", trim: true },
      updatedBy: { type: String, default: "master-admin", trim: true },
      ...extra,
    },
    { timestamps: true, versionKey: false }
  );
}

const departmentSchema = lookupSchema({
  code: { type: String, default: "", trim: true, uppercase: true },
});
departmentSchema.index({ name: 1, isArchived: 1 });

const designationSchema = lookupSchema({
  department: { type: String, default: "", trim: true },
});
designationSchema.index({ name: 1, isArchived: 1 });

const categorySchema = lookupSchema();
categorySchema.index({ name: 1, isArchived: 1 });

const shiftSchema = lookupSchema({
  startTime: { type: String, default: "", trim: true },
  endTime: { type: String, default: "", trim: true },
  breakMinutes: { type: Number, default: 0, min: 0 },
  workingHours: { type: Number, default: 0, min: 0 },
});
shiftSchema.index({ name: 1, isArchived: 1 });

export const StaffDepartment = mongoose.model("StaffDepartment", departmentSchema);
export const StaffDesignation = mongoose.model("StaffDesignation", designationSchema);
export const StaffCategory = mongoose.model("StaffCategory", categorySchema);
export const StaffShift = mongoose.model("StaffShift", shiftSchema);
