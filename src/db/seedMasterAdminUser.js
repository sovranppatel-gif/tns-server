import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { User, USER_TYPES } from "../models/User.js";

// Creates the master-admin user in the `users` collection from .env credentials
// if it doesn't exist yet. Idempotent: safe to call on every server start.
export async function seedMasterAdminUser() {
  const email = env.masterAdminEmail;
  if (!email) {
    console.warn(
      "[seedMasterAdminUser] MASTER_ADMIN_EMAIL is missing — skipping seed."
    );
    return;
  }

  const existing = await User.findOne({
    type: USER_TYPES.MASTER_ADMIN,
    email,
  }).lean();

  if (existing) {
    return;
  }

  // Prefer a precomputed bcrypt hash when provided; otherwise hash the plain
  // password from .env. We never store the plain password in the DB.
  let passwordHash = "";
  if (env.masterAdminPasswordHash) {
    passwordHash = env.masterAdminPasswordHash;
  } else if (env.masterAdminPassword) {
    passwordHash = await bcrypt.hash(env.masterAdminPassword, 10);
  } else {
    console.warn(
      "[seedMasterAdminUser] No MASTER_ADMIN_PASSWORD or MASTER_ADMIN_PASSWORD_HASH set — skipping seed."
    );
    return;
  }

  await User.create({
    email,
    name: "Master Admin",
    passwordHash,
    type: USER_TYPES.MASTER_ADMIN,
    isActive: true,
  });

  console.log(`Seeded master-admin user: ${email}`);
}
