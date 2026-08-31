import { syncBatchesAndAttendance } from "../modules/batches/batches.service.js";
import {
  seedBatchStudentsRoster,
  BATCH_ROSTER_SEED_TAG,
} from "./seedBatchStudentsDemo.js";
import { Admission } from "../models/Admission.js";

/**
 * Ensures every Active course has an Aug-1-2026 batch and
 * seeds last-7-days attendance for Approved students.
 * Then fills each batch with 20–25 demo approved students + fees.
 * Safe to re-run (upserts / skips filled batches).
 */
export async function seedBatchesAndAttendance() {
  try {
    const result = await syncBatchesAndAttendance("system-seed");
    console.log(
      `[batches] sync ok — courses=${result.courses} created=${result.batchesCreated} updated=${result.batchesUpdated} attendance=${result.attendanceUpserts}`
    );

    const seededCount = await Admission.countDocuments({
      "details.seedTag": BATCH_ROSTER_SEED_TAG,
      status: "Approved",
    }).maxTimeMS(8000);

    // Skip heavy roster seed if already populated (~14 batches × 20)
    if (seededCount >= 14 * 20) {
      console.log(
        `[batch-roster] skipped — ${seededCount} seeded students already exist`
      );
      return { ...result, roster: { skipped: true, seededCount } };
    }

    const roster = await seedBatchStudentsRoster({ editor: "system-seed" });
    console.log(
      `[batch-roster] ${roster.message} | fees=${roster.feesSynced} attendance=${roster.attendanceUpserts}`
    );
    return { ...result, roster };
  } catch (err) {
    console.error("[batches] seed/sync failed:", err?.message || err);
    return null;
  }
}
