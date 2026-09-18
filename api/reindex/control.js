import {
  STATE_PATH,
  isAuthorized
} from "../../lib/common.js";
import { readJsonBlob, writeJsonBlob } from "../../lib/blob.js";

export default async function handler(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const action = String(req.query?.action || "").toLowerCase();

  if (!["pause", "resume"].includes(action)) {
    return res.status(400).json({
      ok: false,
      error: "action must be pause or resume"
    });
  }

  try {
    const state = await readJsonBlob(STATE_PATH, false);

    if (!state) {
      return res.status(404).json({
        ok: false,
        error: "Reindex state not found"
      });
    }

    if (state.status === "completed") {
      return res.status(200).json({
        ok: true,
        action: "already_completed",
        status: state.status
      });
    }

    state.status = action === "pause" ? "paused" : "running";
    state.updatedAt = new Date().toISOString();

    await writeJsonBlob(STATE_PATH, state);

    return res.status(200).json({
      ok: true,
      action,
      status: state.status,
      runId: state.runId,
      processedPages: state.processedPages,
      totalPages: state.totalPages
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || String(error)
    });
  }
}
