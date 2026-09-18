import {
  STATE_PATH,
  FINAL_INDEX_PATH,
  formatDate
} from "../lib/common.js";
import { readJsonBlob } from "../lib/blob.js";

export default async function handler(req, res) {
  if (
    process.env.DEBUG_TOKEN &&
    req.query?.token !== process.env.DEBUG_TOKEN
  ) {
    return res.status(401).json({ ok: false, error: "DEBUG_TOKEN required" });
  }

  const report = {
    ok: true,
    service: "JANDI Notion Search v3.1 Chunked",
    checkedAt: new Date().toISOString(),
    env: {
      NOTION_TOKEN: presence(process.env.NOTION_TOKEN),
      JANDI_TOKEN: presence(process.env.JANDI_TOKEN),
      REINDEX_TOKEN: presence(process.env.REINDEX_TOKEN),
      BLOB_READ_WRITE_TOKEN: presence(process.env.BLOB_READ_WRITE_TOKEN),
      VERCEL_OIDC_TOKEN: presence(process.env.VERCEL_OIDC_TOKEN),
      MAX_RESULTS: process.env.MAX_RESULTS || "5(default)",
      MAX_INDEX_PAGES: process.env.MAX_INDEX_PAGES || "1000(default)",
      REINDEX_BATCH_SIZE: process.env.REINDEX_BATCH_SIZE || "15(default)",
      MAX_BLOCKS_PER_PAGE: process.env.MAX_BLOCKS_PER_PAGE || "500(default)",
      MAX_BLOCK_DEPTH: process.env.MAX_BLOCK_DEPTH || "5(default)",
      INDEX_CONCURRENCY: process.env.INDEX_CONCURRENCY || "3(default)"
    },
    reindex: null,
    finalIndex: null
  };

  try {
    const state = await readJsonBlob(STATE_PATH, false);
    if (state) {
      report.reindex = {
        exists: true,
        runId: state.runId,
        status: state.status,
        totalPages: state.totalPages,
        processedPages: state.processedPages,
        failedPages: state.failedPages,
        chunkCount: state.chunkCount,
        batchSize: state.batchSize,
        progress: state.totalPages
          ? Math.round((state.processedPages / state.totalPages) * 1000) / 10
          : 0,
        updatedAt: state.updatedAt
      };
    } else {
      report.reindex = { exists: false };
    }
  } catch (e) {
    report.reindex = { exists: false, error: e?.message || String(e) };
  }

  try {
    const index = await readJsonBlob(FINAL_INDEX_PATH, false);
    if (index) {
      report.finalIndex = {
        exists: true,
        version: index.version,
        pageCount: index.pageCount,
        failedCount: index.failedCount,
        createdAt: index.createdAt,
        createdAtKst: formatDate(index.createdAt),
        sampleTitles: Array.isArray(index.pages)
          ? index.pages.slice(0, 10).map(v => v.title)
          : []
      };
    } else {
      report.finalIndex = { exists: false };
    }
  } catch (e) {
    report.finalIndex = { exists: false, error: e?.message || String(e) };
  }

  return res.status(200).json(report);
}

function presence(value) {
  if (!value) return "MISSING";
  return `SET(length=${String(value).length})`;
}
