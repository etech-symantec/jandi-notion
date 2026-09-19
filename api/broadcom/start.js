import {
  BROADCOM_STATE_PATH
} from "../../lib/common.js";
import { writeJsonBlob } from "../../lib/blob.js";
import {
  createBroadcomPlan,
  broadcomPlanPath,
  readBroadcomState
} from "../../lib/broadcom.js";

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ ok: false, error: "GET/POST only" });
  }

  const token = String(req.query?.token || "");

  if (!process.env.REINDEX_TOKEN || token !== process.env.REINDEX_TOKEN) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

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
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const batchSize = clamp(
      Number(process.env.BROADCOM_BATCH_SIZE),
      1,
      100,
      20
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

    await writeJsonBlob(BROADCOM_STATE_PATH, state);

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

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
