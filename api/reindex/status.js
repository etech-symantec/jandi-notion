import {
  STATE_PATH,
  FINAL_INDEX_PATH,
  isAuthorized,
  formatDate
} from "../../lib/common.js";
import { readJsonBlob } from "../../lib/blob.js";

export default async function handler(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const state = await readJsonBlob(STATE_PATH, false);

    if (!state) {
      return res.status(200).json({
        ok: true,
        exists: false,
        message: "재인덱싱 상태가 없습니다."
      });
    }

    let finalIndex = null;
    try {
      finalIndex = await readJsonBlob(FINAL_INDEX_PATH, false);
    } catch {}

    const progress = state.totalPages
      ? Math.round((state.processedPages / state.totalPages) * 1000) / 10
      : 0;

    return res.status(200).json({
      ok: true,
      exists: true,
      runId: state.runId,
      status: state.status,
      totalPages: state.totalPages,
      processedPages: state.processedPages,
      failedPages: state.failedPages,
      batchSize: state.batchSize,
      chunkCount: state.chunkCount,
      progress,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      completedAt: state.completedAt,
      finalIndex: finalIndex ? {
        exists: true,
        pageCount: finalIndex.pageCount,
        failedCount: finalIndex.failedCount,
        createdAt: finalIndex.createdAt,
        createdAtKst: formatDate(finalIndex.createdAt)
      } : {
        exists: false
      }
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || String(error)
    });
  }
}
