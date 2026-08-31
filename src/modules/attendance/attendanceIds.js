import { Attendance } from "./attendance.model.js";

/**
 * True max of ATT-N sequence. Lexicographic sort breaks once N reaches 1000
 * (e.g. "ATT-999" > "ATT-1000" as strings), which caused E11000 duplicates.
 */
export async function maxAttendanceNumericSeq() {
  const [result] = await Attendance.aggregate([
    { $match: { attendanceId: { $regex: "^ATT-[0-9]+$", $options: "i" } } },
    {
      $project: {
        seq: {
          $convert: {
            input: { $substrCP: ["$attendanceId", 4, 20] },
            to: "int",
            onError: 0,
            onNull: 0,
          },
        },
      },
    },
    { $group: { _id: null, maxSeq: { $max: "$seq" } } },
  ]);
  return Number(result?.maxSeq) || 0;
}

/**
 * Allocate next ATT-{n}. Pass a mutable `{ value: 0 }` seqRef to avoid
 * re-aggregating on every row during bulk seed/sync.
 */
export async function allocateAttendanceId(seqRef = null) {
  if (seqRef && Number(seqRef.value) > 0) {
    seqRef.value += 1;
    return `ATT-${seqRef.value}`;
  }
  const next = (await maxAttendanceNumericSeq()) + 1;
  if (seqRef) seqRef.value = next;
  return `ATT-${next}`;
}
