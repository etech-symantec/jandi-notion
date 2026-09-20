import {
  startBodyIndex,
  processNextBodyBatch,
  readBodyState,
  readBodyManifest,
  readTitleIndex
} from "../lib/broadcom-body.js";

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({
      ok: false,
      error: "GET/POST only"
    });
  }

  const token = String(req.query?.token || "");

  if (
    !process.env.REINDEX_TOKEN ||
    token !== process.env.REINDEX_TOKEN
  ) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  const action = String(
    req.query?.action || ""
  ).toLowerCase();

  try {
    if (action === "start") {
      const force = ["1", "true"].includes(
        String(req.query?.force || "").toLowerCase()
      );

      const result = await startBodyIndex(force);

      return res.status(
        result.alreadyRunning ? 409 : 200
      ).json({
        ok: !result.alreadyRunning,
        action: "start",
        ...result
      });
    }

    if (action === "next") {
      const started = Date.now();

      const result = await processNextBodyBatch(
        (stage, data = {}) =>
          console.log(
            `[BROADCOM-BODY][+${Date.now() - started}ms][${stage}]`,
            JSON.stringify(data)
          )
      );

      return res.status(200).json({
        ok: true,
        action: "next",
        ...result,
        durationMs: Date.now() - started
      });
    }

    if (action === "status") {
      const state = await readBodyState();
      const manifest = await readBodyManifest();
      const titleIndex = await readTitleIndex();

      return res.status(200).json({
        ok: true,
        exists: !!state,
        titleIndex: {
          exists: !!titleIndex,
          pageCount:
            titleIndex?.pageCount ||
            titleIndex?.records?.length ||
            0,
          createdAt:
            titleIndex?.createdAt || null
        },
        bodyIndex: {
          exists: !!manifest,
          indexedPages:
            manifest?.indexedPages || 0,
          chunkCount:
            Object.keys(
              manifest?.chunks || {}
            ).length,
          updatedAt:
            manifest?.updatedAt || null
        },
        ...(state || {})
      });
    }

    return res.status(200).json({
      ok: true,
      service: "Broadcom Chunked Body Index v4.6",
      titleIndex:
        "Existing broadcom-index.json is preserved.",
      usage: {
        start:
          "/api/broadcom?action=start&token=REINDEX_TOKEN",
        next:
          "/api/broadcom?action=next&token=REINDEX_TOKEN",
        status:
          "/api/broadcom?action=status&token=REINDEX_TOKEN"
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error:
        error?.message || String(error)
    });
  }
}
