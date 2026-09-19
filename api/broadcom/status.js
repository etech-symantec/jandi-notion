import {
  readBroadcomState,
  readBroadcomIndex
} from "../../lib/broadcom.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "GET only" });
  }

  const token = String(req.query?.token || "");

  if (!process.env.REINDEX_TOKEN || token !== process.env.REINDEX_TOKEN) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const state = await readBroadcomState();
  const index = await readBroadcomIndex();

  return res.status(200).json({
    ok: true,
    exists: !!state,
    ...(state || {}),
    finalIndex: index
      ? {
          exists: true,
          version: index.version,
          pageCount: index.pageCount,
          failedCount: index.failedCount || 0,
          fetchedCount: index.fetchedCount || 0,
          reusedCount: index.reusedCount || 0,
          createdAt: index.createdAt
        }
      : {
          exists: false
        }
  });
}
