// One-shot migration: copies every collection from a local MongoDB into an Atlas cluster.
//
// Usage (PowerShell, from server/):
//   node src/scripts/migrateToAtlas.js
//
// Optional env overrides:
//   LOCAL_MONGO_URI   default: mongodb://127.0.0.1:27017/growskillstech
//   ATLAS_MONGO_URI   default: read from MONGO_URI in .env (must point to Atlas)
//   ATLAS_DB_NAME     default: same as local DB name
//   WIPE_TARGET       "true" to drop each target collection before importing (default: false)

import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import dns from "node:dns";

dotenv.config();

// Many home/ISP DNS servers can't resolve MongoDB Atlas SRV records.
// Force public resolvers so mongodb+srv URIs work consistently.
try {
  dns.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);
} catch {
  // ignore — fall back to system DNS
}

const LOCAL_URI =
  process.env.LOCAL_MONGO_URI ||
  "mongodb://127.0.0.1:27017/growskillstech";

const ATLAS_URI = process.env.ATLAS_MONGO_URI || process.env.MONGO_URI;

if (!ATLAS_URI) {
  console.error(
    "Missing target URI. Set ATLAS_MONGO_URI or MONGO_URI in .env before running."
  );
  process.exit(1);
}

if (!/mongodb\+srv|mongodb:\/\//.test(ATLAS_URI)) {
  console.error("Target URI does not look like a valid MongoDB connection string.");
  process.exit(1);
}

const WIPE_TARGET = String(process.env.WIPE_TARGET || "false").toLowerCase() === "true";

function getDbNameFromUri(uri, fallback) {
  try {
    // mongodb+srv URIs may not include a db path; mongodb:// usually do.
    const noScheme = uri.replace(/^mongodb(\+srv)?:\/\//, "");
    const afterHost = noScheme.split("/")[1] || "";
    const dbPart = afterHost.split("?")[0];
    return dbPart && dbPart.length > 0 ? dbPart : fallback;
  } catch {
    return fallback;
  }
}

async function migrate() {
  const localDbName = getDbNameFromUri(LOCAL_URI, "growskillstech");
  const targetDbName =
    process.env.ATLAS_DB_NAME ||
    getDbNameFromUri(ATLAS_URI, localDbName);

  console.log("Source URI :", LOCAL_URI);
  console.log("Source DB  :", localDbName);
  console.log("Target URI :", ATLAS_URI.replace(/:\/\/.*@/, "://<redacted>@"));
  console.log("Target DB  :", targetDbName);
  console.log("Wipe target collections before import?", WIPE_TARGET);
  console.log("");

  const localClient = new MongoClient(LOCAL_URI);
  const atlasClient = new MongoClient(ATLAS_URI);

  await localClient.connect();
  await atlasClient.connect();
  console.log("Connected to both clusters.");

  const localDb = localClient.db(localDbName);
  const atlasDb = atlasClient.db(targetDbName);

  const collections = await localDb.listCollections().toArray();
  if (collections.length === 0) {
    console.log("No collections found on local DB — nothing to migrate.");
    await localClient.close();
    await atlasClient.close();
    return;
  }

  for (const { name, type } of collections) {
    if (type && type !== "collection") {
      console.log(`Skipping ${name} (type=${type})`);
      continue;
    }
    if (name.startsWith("system.")) {
      console.log(`Skipping ${name} (system collection)`);
      continue;
    }

    const srcColl = localDb.collection(name);
    const dstColl = atlasDb.collection(name);

    const total = await srcColl.countDocuments();
    console.log(`\n[${name}] local count = ${total}`);

    if (total === 0) {
      console.log(`[${name}] nothing to copy.`);
      continue;
    }

    if (WIPE_TARGET) {
      try {
        await dstColl.drop();
        console.log(`[${name}] dropped target collection.`);
      } catch (err) {
        if (err && err.codeName !== "NamespaceNotFound") {
          throw err;
        }
      }
    }

    const cursor = srcColl.find({});
    const batchSize = 500;
    let batch = [];
    let copied = 0;
    let upserted = 0;

    for await (const doc of cursor) {
      batch.push(doc);
      if (batch.length >= batchSize) {
        const result = await writeBatch(dstColl, batch, WIPE_TARGET);
        copied += result.copied;
        upserted += result.upserted;
        batch = [];
        process.stdout.write(
          `\r[${name}] progress: ${copied + upserted}/${total}`
        );
      }
    }
    if (batch.length > 0) {
      const result = await writeBatch(dstColl, batch, WIPE_TARGET);
      copied += result.copied;
      upserted += result.upserted;
    }

    process.stdout.write("\n");
    console.log(
      `[${name}] done. inserted=${copied}, upserted=${upserted}, target total=${await dstColl.countDocuments()}`
    );
  }

  await localClient.close();
  await atlasClient.close();
  console.log("\nMigration finished successfully.");
}

async function writeBatch(dstColl, docs, useInsert) {
  if (useInsert) {
    const res = await dstColl.insertMany(docs, { ordered: false });
    return { copied: res.insertedCount || docs.length, upserted: 0 };
  }
  // Idempotent path: upsert by _id so re-running the script is safe.
  const ops = docs.map((doc) => ({
    replaceOne: {
      filter: { _id: doc._id },
      replacement: doc,
      upsert: true,
    },
  }));
  const res = await dstColl.bulkWrite(ops, { ordered: false });
  return {
    copied: res.insertedCount || 0,
    upserted: (res.upsertedCount || 0) + (res.modifiedCount || 0),
  };
}

migrate().catch((err) => {
  console.error("\nMigration failed:", err);
  process.exit(1);
});
