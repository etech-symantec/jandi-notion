import {
  BROADCOM_STATE_PATH
} from "../../lib/common.js";
import {
  readJsonBlob,
  writeJsonBlob
} from "../../lib/blob.js";
import {
  broadcomPlanPath,
  broadcomChunkPath,
  processBroadcomBatch,
  finalizeBroadcomRun,
  readBroadcomState,
  readBroadcomIndex
} from "../../lib/broadcom.js";

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ ok: false, error: "GET/POST only" });
  }

  const token = String(req.query?.token || "");

  if (!process.env.REINDEX_TOKEN || token !== process.env.REINDEX_TOKEN) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const state = await readBroadcomState();

    if (!state) {
      return res.status(404).json({
        ok: false,
        error: "Broadcom reindex state not found"
      });
    }

    if (state.status !== "running") {
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: `status=${state.status}`,
        state
      });
    }

    const plan = await readJsonBlob(
      broadcomPlanPath(state.runId),
      true
    );

    if (!plan?.items?.length) {
      return res.status(500).json({
        ok: false,
        error: "Broadcom reindex plan not found"
      });
    }

    const start = state.processedPages;
    const end = Math.min(
      start + state.batchSize,
      state.totalPages
    );

    const items = plan.items.slice(start, end);
    const previousIndex = await readBroadcomIndex();

    const started = Date.now();
    const log = (stage, data = {}) =>
      console.log(
        `[BROADCOM-NEXT][+${Date.now() - started}ms][${stage}]`,
        JSON.stringify(data)
      );

    const result = await processBroadcomBatch(
      items,
      previousIndex,
      log
    );

    const chunkNo = state.chunkCount + 1;

    await writeJsonBlob(
      broadcomChunkPath(state.runId, chunkNo),
      {
        runId: state.runId,
        chunkNo,
        start,
        end,
        records: result.records,
        createdAt: new Date().toISOString()
      }
    );

    const nextState = {
      ...state,
      processedPages: end,
      fetchedPages: state.fetchedPages + result.fetched,
      reusedPages: state.reusedPages + result.reused,
      failedPages: state.failedPages + result.failed,
      chunkCount: chunkNo,
      progress: state.totalPages
        ? Math.round((end / state.totalPages) * 1000) / 10
        : 100,
      updatedAt: new Date().toISOString()
    };

    if (end >= state.totalPages) {
      const finalIndex = await finalizeBroadcomRun(nextState, log);

      nextState.status = "completed";
      nextState.progress = 100;
      nextState.completedAt = new Date().toISOString();
      nextState.finalPageCount = finalIndex.pageCount;
    }

    await writeJsonBlob(BROADCOM_STATE_PATH, nextState);

    return res.status(200).json({
      ok: true,
      batch: {
        start,
        end,
        count: items.length,
        fetched: result.fetched,
        reused: result.reused,
        failed: result.failed
      },
      state: nextState
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || String(error)
    });
  }
}
