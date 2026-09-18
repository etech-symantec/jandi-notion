import { put } from "@vercel/blob";
import { INDEX_PATH } from "../lib/common.js";
import { buildNotionIndex } from "../lib/indexer.js";

export default async function handler(req, res) {
  const started = Date.now();

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ ok: false, error: "GET/POST only" });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  if (!process.env.NOTION_TOKEN) {
    return res.status(500).json({
      ok: false,
      error: "NOTION_TOKEN is missing"
    });
  }

  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  const log = (stage, data = {}) => {
    console.log(
      `[REINDEX][${runId}][+${Date.now() - started}ms][${stage}]`,
      JSON.stringify(data)
    );
  };

  try {
    log("START");

    const index = await buildNotionIndex(process.env.NOTION_TOKEN, log);

    log("INDEX_BUILT", {
      pageCount: index.pageCount,
      failedCount: index.failedCount,
      bytes: Buffer.byteLength(JSON.stringify(index), "utf8")
    });

    const blob = await put(
      INDEX_PATH,
      JSON.stringify(index),
      {
        access: "private",
        allowOverwrite: true,
        contentType: "application/json"
      }
    );

    log("BLOB_SAVED", {
      pathname: blob.pathname,
      url: blob.url
    });

    return res.status(200).json({
      ok: true,
      runId,
      pageCount: index.pageCount,
      failedCount: index.failedCount,
      createdAt: index.createdAt,
      durationMs: Date.now() - started,
      blob: {
        pathname: blob.pathname,
        size: blob.size ?? null
      }
    });

  } catch (error) {
    log("FAILED", {
      error: error?.message || String(error),
      stack: String(error?.stack || "").slice(0, 1500)
    });

    return res.status(500).json({
      ok: false,
      runId,
      durationMs: Date.now() - started,
      error: error?.message || String(error)
    });
  }
}

function isAuthorized(req) {
  const manualToken =
    typeof req.query?.token === "string" ? req.query.token : "";

  if (
    process.env.REINDEX_TOKEN &&
    manualToken === process.env.REINDEX_TOKEN
  ) {
    return true;
  }

  const auth = req.headers.authorization || "";
  if (
    process.env.CRON_SECRET &&
    auth === `Bearer ${process.env.CRON_SECRET}`
  ) {
    return true;
  }

  return false;
}
