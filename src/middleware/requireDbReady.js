import mongoose from "mongoose";
import { waitForMongo } from "../db/connectMongo.js";

async function isMongoResponsive(timeoutMs = 1500) {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return false;
  try {
    await Promise.race([
      mongoose.connection.db.command({ ping: 1 }, { maxTimeMS: timeoutMs }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Mongo ping timeout")), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fail fast when Mongo is down/reconnecting so login doesn't hang
 * on Atlas DNS flaps (ENOTFOUND / ReplicaSetNoPrimary).
 * On Vercel cold start, wait briefly for the first connection instead of
 * immediately 503-ing the request that woke the function.
 */
export async function requireDbReady(req, res, next) {
  // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  if (mongoose.connection.readyState === 1) {
    if (await isMongoResponsive()) return next();
    return mongoUnavailableResponse(res, new Error("Mongo ping failed"));
  }

  try {
    await waitForMongo(Number(process.env.MONGO_WAIT_MS) || 8000);
    return next();
  } catch {
    res.setHeader("Retry-After", "3");
    return res.status(503).json({
      success: false,
      message:
        "Server is connecting to the database. Please wait a few seconds and try again.",
      retryAfter: 3,
    });
  }
}

export function isMongoTransientError(err) {
  if (!err) return false;
  const name = String(err.name || "");
  const msg = String(err.message || "");
  return (
    name === "MongoServerSelectionError" ||
    name === "MongoNetworkError" ||
    name === "MongoTimeoutError" ||
    err.code === "ENOTFOUND" ||
    err.code === "ETIMEOUT" ||
    msg.includes("Server selection timed out") ||
    msg.includes("getaddrinfo") ||
    msg.includes("ECONNREFUSED")
  );
}

export function mongoUnavailableResponse(res, err) {
  console.error("Mongo transient error:", err?.message || err);
  res.setHeader("Retry-After", "3");
  return res.status(503).json({
    success: false,
    message:
      "Database is temporarily unavailable. Please wait a few seconds and try again.",
    retryAfter: 3,
  });
}
