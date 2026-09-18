import {
  STATE_PATH,
  FINAL_INDEX_PATH,
  chunkPath,
  isAuthorized
} from "../../lib/common.js";
import { readJsonBlob, writeJsonBlob } from "../../lib/blob.js";
import { indexPageBatch } from "../../lib/indexer.js";

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ ok: false, error: "GET/POST only" });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const started = Date.now();

  try {
    const state = await readJsonBlob(STATE_PATH, false);

    if (!state) {
      return res.status(404).json({
        ok: false,
        error: "Reindex state not found. Run /api/reindex/start first."
      });
    }

    const runId = state.runId;
    const log = (stage, data = {}) => {
      console.log(
        `[REINDEX-NEXT][${runId}][+${Date.now() - started}ms][${stage}]`,
        JSON.stringify(data)
      );
    };

    if (state.status === "completed") {
      return res.status(200).json({
        ok: true,
        action: "already_completed",
        ...publicState(state),
        durationMs: Date.now() - started
      });
    }

    if (state.nextIndex >= state.totalPages) {
      const finalResult = await finalizeIndex(state, log);
      return res.status(200).json({
        ok: true,
        action: "finalized",
        ...finalResult,
        durationMs: Date.now() - started
      });
    }

    const startIndex = state.nextIndex;
    const endIndex = Math.min(
      startIndex + state.batchSize,
      state.totalPages
    );

    const batch = state.pages.slice(startIndex, endIndex);

    log("BATCH_START", {
      startIndex,
      endIndex,
      batchPages: batch.length,
      totalPages: state.totalPages
    });

    const result = await indexPageBatch(
      process.env.NOTION_TOKEN,
      batch,
      log
    );

    const chunkNo = state.chunkCount + 1;
    const cPath = chunkPath(runId, chunkNo);

    await writeJsonBlob(cPath, {
      runId,
      chunkNo,
      startIndex,
      endIndex,
      createdAt: new Date().toISOString(),
      records: result.records
    });

    state.nextIndex = endIndex;
    state.processedPages = endIndex;
    state.failedPages += result.failed;
    state.chunkCount = chunkNo;
    state.updatedAt = new Date().toISOString();
    state.lastError = null;

    await writeJsonBlob(STATE_PATH, state);

    log("BATCH_SAVED", {
      chunkNo,
      processedPages: state.processedPages,
      failedPages: state.failedPages,
      progress: progress(state)
    });

    // 마지막 배치라면 같은 요청에서 바로 finalize
    if (state.nextIndex >= state.totalPages) {
      const finalResult = await finalizeIndex(state, log);
      return res.status(200).json({
        ok: true,
        action: "batch_and_finalized",
        batch: {
          startIndex,
          endIndex,
          count: batch.length,
          failed: result.failed
        },
        ...finalResult,
        durationMs: Date.now() - started
      });
    }

    return res.status(200).json({
      ok: true,
      action: "batch_completed",
      batch: {
        startIndex,
        endIndex,
        count: batch.length,
        failed: result.failed,
        chunkNo
      },
      ...publicState(state),
      durationMs: Date.now() - started
    });

  } catch (error) {
    console.error("[REINDEX-NEXT][FAILED]", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || String(error),
      durationMs: Date.now() - started
    });
  }
}

async function finalizeIndex(state, log) {
  log("FINALIZE_START", {
    chunkCount: state.chunkCount,
    totalPages: state.totalPages
  });

  const all = [];

  for (let i = 1; i <= state.chunkCount; i++) {
    const chunk = await readJsonBlob(chunkPath(state.runId, i), false);
    if (!chunk?.records) {
      throw new Error(`Missing chunk ${i}`);
    }
    all.push(...chunk.records);
  }

  const finalIndex = {
    version: 3.1,
    createdAt: new Date().toISOString(),
    runId: state.runId,
    pageCount: all.length,
    failedCount: state.failedPages,
    pages: all
  };

  await writeJsonBlob(FINAL_INDEX_PATH, finalIndex);

  state.status = "completed";
  state.completedAt = new Date().toISOString();
  state.updatedAt = new Date().toISOString();
  await writeJsonBlob(STATE_PATH, state);

  log("FINALIZE_DONE", {
    pageCount: finalIndex.pageCount,
    failedCount: finalIndex.failedCount
  });

  return {
    runId: state.runId,
    status: state.status,
    pageCount: finalIndex.pageCount,
    failedPages: finalIndex.failedCount,
    progress: 100,
    completedAt: state.completedAt
  };
}

function progress(state) {
  if (!state.totalPages) return 0;
  return Math.round((state.processedPages / state.totalPages) * 1000) / 10;
}

function publicState(state) {
  return {
    runId: state.runId,
    status: state.status,
    totalPages: state.totalPages,
    processedPages: state.processedPages,
    failedPages: state.failedPages,
    chunkCount: state.chunkCount,
    batchSize: state.batchSize,
    progress: progress(state),
    updatedAt: state.updatedAt
  };
}
