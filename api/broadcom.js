import {
  BROADCOM_STATE_PATH
} from "../lib/common.js";

import {
  readJsonBlob,
  writeJsonBlob
} from "../lib/blob.js";

import {
  createBroadcomPlan,
  broadcomPlanPath,
  broadcomChunkPath,
  processBroadcomBatch,
  finalizeBroadcomRun,
  readBroadcomState,
  readBroadcomIndex
} from "../lib/broadcom.js";

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

  const action = String(req.query?.action || "").toLowerCase();

  if (action === "start") {
    return startBroadcom(req, res);
  }

  if (action === "next") {
    return nextBroadcom(req, res);
  }

  if (action === "status") {
    return statusBroadcom(req, res);
  }

  return res.status(200).json({
    ok: true,
    service: "Broadcom KB Batch API v4.2",
    usage: {
      start: "/api/broadcom?action=start&token=REINDEX_TOKEN",
      next: "/api/broadcom?action=next&token=REINDEX_TOKEN",
      status: "/api/broadcom?action=status&token=REINDEX_TOKEN"
    }
  });
}

async function startBroadcom(req, res) {
  const force = ["1", "true"].includes(
    String(req.query?.force || "").toLowerCase()
  );

  try {
    const current = await readBroadcomState();

    if (
      !force &&
      current &&
      ["running", "paused"].includes(current.status)
    ) {
      return res.status(409).json({
        ok: false,
        error: "Broadcom reindex already active",
        state: current
      });
    }

    const started = Date.now();

    const log = (stage, data = {}) =>
      console.log(
        `[BROADCOM-START][+${Date.now() - started}ms][${stage}]`,
        JSON.stringify(data)
      );

    const items = await createBroadcomPlan(log);

    const runId =
      `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    const batchSize = clamp(
      Number(process.env.BROADCOM_BATCH_SIZE),
      1,
      100,
      15
    );

    await writeJsonBlob(
      broadcomPlanPath(runId),
      {
        runId,
        createdAt: new Date().toISOString(),
        items
      }
    );

    const state = {
      version: 1,
      runId,
      status: "running",
      totalPages: items.length,
      processedPages: 0,
      fetchedPages: 0,
      reusedPages: 0,
      failedPages: 0,
      chunkCount: 0,
      batchSize,
      progress: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await writeJsonBlob(
      BROADCOM_STATE_PATH,
      state
    );

    return res.status(200).json({
      ok: true,
      ...state
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || String(error)
    });
  }
}

async function nextBroadcom(req, res) {
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
      fetchedPages:
        state.fetchedPages + result.fetched,
      reusedPages:
        state.reusedPages + result.reused,
      failedPages:
        state.failedPages + result.failed,
      chunkCount: chunkNo,
      progress: state.totalPages
        ? Math.round(
            (end / state.totalPages) * 1000
          ) / 10
        : 100,
      updatedAt: new Date().toISOString()
    };

    if (end >= state.totalPages) {
      const finalIndex =
        await finalizeBroadcomRun(
          nextState,
          log
        );

      nextState.status = "completed";
      nextState.progress = 100;
      nextState.completedAt =
        new Date().toISOString();
      nextState.finalPageCount =
        finalIndex.pageCount;
    }

    await writeJsonBlob(
      BROADCOM_STATE_PATH,
      nextState
    );

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

async function statusBroadcom(req, res) {
  try {
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
            failedCount:
              index.failedCount || 0,
            fetchedCount:
              index.fetchedCount || 0,
            reusedCount:
              index.reusedCount || 0,
            createdAt: index.createdAt
          }
        : {
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

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(
    min,
    Math.min(max, Math.floor(value))
  );
}
