import mongoose from "mongoose";
import dns from "node:dns";
import { env } from "../config/env.js";

function configureDns() {
  const PUBLIC_DNS = ["8.8.8.8", "1.1.1.1"];

  if (process.env.MONGO_DNS_SERVERS) {
    try {
      dns.setServers(
        process.env.MONGO_DNS_SERVERS.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      );
      return;
    } catch {
      // ignore — fall back below
    }
  }

  // Prefer public DNS for Atlas SRV lookups — ISP resolvers often ENOTFOUND shard hosts.
  // Do not shell out to `ipconfig /all` (slow on Windows and blocks every boot).
  try {
    const merged = [...new Set([...PUBLIC_DNS, ...dns.getServers()])];
    dns.setServers(merged);
  } catch {
    // ignore
  }
}

configureDns();

async function resolveSrvToDirectUri(srvUri) {
  if (!srvUri.startsWith("mongodb+srv://")) return srvUri;

  const withoutScheme = srvUri.slice("mongodb+srv://".length);
  const atIdx = withoutScheme.indexOf("@");
  const creds = atIdx >= 0 ? withoutScheme.slice(0, atIdx + 1) : "";
  const afterCreds = atIdx >= 0 ? withoutScheme.slice(atIdx + 1) : withoutScheme;
  const slashIdx = afterCreds.indexOf("/");
  const host =
    slashIdx >= 0 ? afterCreds.slice(0, slashIdx) : afterCreds.split("?")[0];
  const pathAndQuery = slashIdx >= 0 ? afterCreds.slice(slashIdx) : "";

  const srvHost = `_mongodb._tcp.${host}`;
  const [srvRecords, txtRecords] = await Promise.all([
    dns.promises.resolve(srvHost, "SRV"),
    dns.promises.resolve(srvHost, "TXT").catch(() => []),
  ]);

  const hosts = srvRecords.map((r) => `${r.name}:${r.port}`).join(",");
  const [dbPath, query = ""] = pathAndQuery.split("?");
  const txtOptions = txtRecords
    .flatMap((record) =>
      (Array.isArray(record) ? record.join("") : String(record))
        .split("&")
        .map((part) => part.trim())
        .filter(Boolean)
    )
    .filter((opt) => !query.includes(opt.split("=")[0] + "="));

  const mergedQuery = [query, "ssl=true", ...txtOptions].filter(Boolean).join("&");
  const needsAuthSource =
    creds && !mergedQuery.split("&").some((part) => part.startsWith("authSource="));
  const finalQuery = needsAuthSource
    ? `${mergedQuery}&authSource=admin`
    : mergedQuery;
  return `mongodb://${creds}${hosts}${dbPath}?${finalQuery}`;
}

export async function connectMongo() {
  console.log("Connecting to MongoDB...");
  const srvUri = env.mongoUri;
  const options = {
    autoIndex: true,
    // Fail faster than default 30s when Atlas DNS/shard hosts flap (common on ISP DNS)
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS) || 8000,
  };

  if (!srvUri.startsWith("mongodb+srv://")) {
    await mongoose.connect(srvUri, options);
    const { host, name } = mongoose.connection;
    console.log(`MongoDB connected: db="${name}" host="${host}"`);
    return;
  }

  try {
    await mongoose.connect(srvUri, options);
  } catch (err) {
    const dnsFailure =
      err.code === "ECONNREFUSED" ||
      err.code === "ENOTFOUND" ||
      err.code === "ETIMEOUT" ||
      String(err.message || "").includes("querySrv");

    if (!dnsFailure) throw err;

    console.warn(
      `MongoDB SRV lookup failed (${err.code || err.message}); using direct host list`
    );
    const directUri = await resolveSrvToDirectUri(srvUri);
    await mongoose.connect(directUri, options);
  }

  const { host, name } = mongoose.connection;
  console.log(`MongoDB connected: db="${name}" host="${host}"`);
}
