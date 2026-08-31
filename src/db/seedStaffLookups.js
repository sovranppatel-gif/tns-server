import { ensureDefaultLookups } from "../modules/staff/staffLookups.service.js";

export async function seedStaffLookups() {
  await ensureDefaultLookups();
  console.log("[staff] lookup defaults ensured");
}
