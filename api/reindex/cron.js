import {
  STATE_PATH,
  FINAL_INDEX_PATH,
  chunkPath
} from "../../lib/common.js";
import { readJsonBlob, writeJsonBlob } from "../../lib/blob.js";
import { indexPageBatch } from "../../lib/indexer.js";

export default async function handler(req, res) {
  const started = Date.now();

  if (!isCronAuthorized(req)) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized cron request"
    });
  }

  try {
    const state = await readJsonBlob(STATE_PATH, false);

    if (!state) {
      return res.status(200).json({
        ok: true,
        action: "no_state",
        message: "재인덱싱 상태가 없습니다."
      });
    }

    if (state.status === "completed") {
      return res.status(200).json({
        ok: true,
        action: "already_completed",
        runId: state.runId,
        progress: 100
      });
    }

    if (state.status === "paused") {
      return res.status(200).json({
        ok: true,
        action: "paused",
        runId: state.runId
      });
    }

    // 중복 Cron 실행 방지용 lock
    const now = Date.now();
    const lockUntil = state.lockUntil ? Date.parse(state.lockUntil) : 0;

    if (lockUntil && lockUntil > now) {
      return res.status(200).json({
        ok: true,
        action: "locked",
        runId: state.runId,
        lockUntil: state.lockUntil
      });
    }

    // 최대 4분 lock
    state.lockUntil = new Date(now + 4 * 60 * 1000).toISOString();
    state.updatedAt = new Date().toISOString();
    await writeJsonBlob(STATE_PATH, state);

    const log = (stage, data = {}) => {
      console.log(
        `[REINDEX-CRON][${state.runId}][+${Date.now() - started}ms][${stage}]`,
        JSON.stringify(data)
      );
    };

    log("START", {
      processedPages: state.processedPages,
      totalPages: state.totalPages,
      batchSize: state.batchSize
    });

    // 이미 전부 처리했는데 finalize만 남은 경우
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
      count: batch.length
    });

    const result = await indexPageBatch(
      process.env.NOTION_TOKEN,
      batch,
      log
    );

    const chunkNo = state.chunkCount + 1;
    const cPath = chunkPath(state.runId, chunkNo);

    await writeJsonBlob(cPath, {
      runId: state.runId,
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
    state.lockUntil = null;
    state.lastError = null;

    await writeJsonBlob(STATE_PATH, state);

    log("BATCH_SAVED", {
      processedPages: state.processedPages,
      failedPages: state.failedPages,
      progress: progress(state)
    });

    if (state.nextIndex >= state.totalPages) {
      const finalResult = await finalizeIndex(state, log);

      return res.status(200).json({
        ok: true,
        action: "batch_and_finalized",
        ...finalResult,
        durationMs: Date.now() - started
      });
    }

    return res.status(200).json({
      ok: true,
      action: "batch_completed",
      runId: state.runId,
      totalPages: state.totalPages,
      processedPages: state.processedPages,
      failedPages: state.failedPages,
      chunkCount: state.chunkCount,
      progress: progress(state),
      durationMs: Date.now() - started
    });

  } catch (error) {
    // lock 해제 시도
    try {
      const state = await readJsonBlob(STATE_PATH, false);
      if (state) {
        state.lockUntil = null;
        state.lastError = error?.message || String(error);
        state.updatedAt = new Date().toISOString();
        await writeJsonBlob(STATE_PATH, state);
      }
    } catch {}

    console.error("[REINDEX-CRON][FAILED]", error);

    return res.status(500).json({
      ok: false,
      error: error?.message || String(error),
      durationMs: Date.now() - started
    });
  }
}

function isCronAuthorized(req) {
  const auth = req.headers.authorization || "";
  return (
    !!process.env.CRON_SECRET &&
    auth === `Bearer ${process.env.CRON_SECRET}`
  );
}

async function finalizeIndex(state, log) {
  log("FINALIZE_START", {
    chunkCount: state.chunkCount,
    totalPages: state.totalPages
  });

  const all = [];

  for (let i = 1; i <= state.chunkCount; i++) {
    const chunk = await readJsonBlob(
      chunkPath(state.runId, i),
      false
    );

    if (!chunk?.records) {
      throw new Error(`Missing chunk ${i}`);
    }

    all.push(...chunk.records);
  }

  const finalIndex = {
    version: 3.2,
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
  state.lockUntil = null;

  await writeJsonBlob(STATE_PATH, state);

  log("FINALIZE_DONE", {
    pageCount: finalIndex.pageCount,
    failedCount: finalIndex.failedCount
  });

  return {
    runId: state.runId,
    status: "completed",
    pageCount: finalIndex.pageCount,
    failedPages: finalIndex.failedCount,
    progress: 100,
    completedAt: state.completedAt
  };
}

function progress(state) {
  if (!state.totalPages) return 0;
  return Math.round(
    (state.processedPages / state.totalPages) * 1000
  ) / 10;
}
