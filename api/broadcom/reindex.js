import {
  buildBroadcomIndex,
  readBroadcomState
} from "../../lib/broadcom.js";

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ ok: false, error: "GET/POST only" });
  }

  const token =
    typeof req.query?.token === "string" ? req.query.token : "";

  if (
    !process.env.REINDEX_TOKEN ||
    token !== process.env.REINDEX_TOKEN
  ) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  const forceFull =
    String(req.query?.full || "").toLowerCase() === "true" ||
    String(req.query?.full || "") === "1";

  const started = Date.now();

  const log = (stage, data = {}) => {
    console.log(
      `[BROADCOM-INDEX][+${Date.now() - started}ms][${stage}]`,
      JSON.stringify(data)
    );
  };

  try {
    const current = await readBroadcomState();

    if (
      current?.status === "running" &&
      !forceFull
    ) {
      return res.status(409).json({
        ok: false,
        error: "Broadcom indexing is already running.",
        state: current
      });
    }

    const index = await buildBroadcomIndex(log, {
      forceFull
    });

    return res.status(200).json({
      ok: true,
      mode: forceFull ? "full" : "incremental",
      pageCount: index.pageCount,
      fetchedCount: index.fetchedCount,
      reusedCount: index.reusedCount,
      failedCount: index.failedCount,
      createdAt: index.createdAt,
      durationMs: Date.now() - started,
      sampleTitles: index.records
        .slice(0, 10)
        .map(v => v.title)
    });
  } catch (error) {
    log("FAILED", {
      error: error?.message || String(error)
    });

    return res.status(500).json({
      ok: false,
      error: error?.message || String(error),
      durationMs: Date.now() - started
    });
  }
}
