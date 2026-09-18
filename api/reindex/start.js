import {
  STATE_PATH,
  clampNumber,
  isAuthorized,
  makeRunId
} from "../../lib/common.js";
import { writeJsonBlob } from "../../lib/blob.js";
import { listAllPages } from "../../lib/indexer.js";

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ ok: false, error: "GET/POST only" });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  if (!process.env.NOTION_TOKEN) {
    return res.status(500).json({ ok: false, error: "NOTION_TOKEN missing" });
  }

  const started = Date.now();
  const runId = makeRunId();

  const log = (stage, data = {}) => {
    console.log(
      `[REINDEX-START][${runId}][+${Date.now() - started}ms][${stage}]`,
      JSON.stringify(data)
    );
  };

  try {
    const maxPages = clampNumber(process.env.MAX_INDEX_PAGES, 10, 5000, 1000);
    const batchSize = clampNumber(process.env.REINDEX_BATCH_SIZE, 1, 50, 15);

    log("START", { maxPages, batchSize });

    const pages = await listAllPages(
      process.env.NOTION_TOKEN,
      maxPages,
      log
    );

    const state = {
      version: 3.1,
      runId,
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      totalPages: pages.length,
      nextIndex: 0,
      processedPages: 0,
      failedPages: 0,
      batchSize,
      chunkCount: 0,
      pages,
      lastError: null
    };

    await writeJsonBlob(STATE_PATH, state);

    log("STATE_SAVED", {
      totalPages: state.totalPages,
      batchSize
    });

    return res.status(200).json({
      ok: true,
      action: "started",
      runId,
      totalPages: state.totalPages,
      batchSize,
      processedPages: 0,
      progress: 0,
      next: `/api/reindex/next?token=***`,
      durationMs: Date.now() - started
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
