import { FinanceSequence } from "./finance.models.js";

export async function nextFinanceId(key, prefix, pad = 4) {
  const row = await FinanceSequence.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  return `${prefix}${String(row.seq).padStart(pad, "0")}`;
}
