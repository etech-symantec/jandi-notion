import {
  startFreshTitleRebuild,
  processNextTitleBatch,
  readTitleState,
  readFinalTitleIndex,
  startDailyIncremental,
  processNextDailyIncremental,
  readDailyState
} from "../lib/broadcom-title.js";

import {
  startBodyIndex,
  processNextBodyBatch,
  readBodyState,
  readBodyManifest,
  resetBodyIndexStorage
} from "../lib/broadcom-body.js";

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({
      ok: false,
      error: "GET/POST only"
    });
  }

  const token = String(
    req.query?.token || ""
  );

  if (
    !process.env.REINDEX_TOKEN ||
    token !== process.env.REINDEX_TOKEN
  ) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  const action = String(
    req.query?.action || ""
  ).toLowerCase();

  try {
    if (action === "reset") {
      const started = Date.now();

      // True full reset: clear the active body state and manifest first.
      // Old orphaned physical chunk blobs are no longer referenced and
      // therefore cannot affect search or the new rebuild.
      const bodyReset =
        await resetBodyIndexStorage();

      const result =
        await startFreshTitleRebuild(
          true,
          (stage, data = {}) =>
            console.log(
              `[BROADCOM-RESET][+${Date.now() - started}ms][${stage}]`,
              JSON.stringify(data)
            )
        );

      return res.status(200).json({
        ok: true,
        action: "reset",
        message:
          "True full reset completed. Fresh English title rebuild started; body index is empty and waiting for title completion.",
        bodyReset,
        ...result
      });
    }

    if (action === "title_next") {
      const result =
        await processNextTitleBatch(
          (stage, data = {}) =>
            console.log(
              `[BROADCOM-TITLE][${stage}]`,
              JSON.stringify(data)
            )
        );

      if (
        result?.state?.status ===
        "completed"
      ) {
        const bodyState =
          await readBodyState();

        if (
          !bodyState ||
          bodyState.status !== "running"
        ) {
          await startBodyIndex(
            true
          );
        }
      }

      return res.status(200).json({
        ok: true,
        action: "title_next",
        ...result
      });
    }

    if (action === "body_next") {
      const result =
        await processNextBodyBatch(
          (stage, data = {}) =>
            console.log(
              `[BROADCOM-BODY][${stage}]`,
              JSON.stringify(data)
            )
        );

      return res.status(200).json({
        ok: true,
        action: "body_next",
        ...result
      });
    }

    if (action === "start") {
      const titleState =
        await readTitleState();

      if (
        !titleState ||
        titleState.status !== "completed"
      ) {
        const result =
          await startFreshTitleRebuild(
            false
          );

        return res.status(
          result.alreadyRunning ? 409 : 200
        ).json({
          ok:
            !result.alreadyRunning,
          action: "start_title",
          ...result
        });
      }

      const result =
        await startBodyIndex(
          false
        );

      return res.status(
        result.alreadyRunning ? 409 : 200
      ).json({
        ok:
          !result.alreadyRunning,
        action: "start_body",
        ...result
      });
    }

    if (action === "next") {
      const titleState =
        await readTitleState();

      if (
        titleState?.status ===
        "running"
      ) {
        const result =
          await processNextTitleBatch();

        if (
          result?.state?.status ===
          "completed"
        ) {
          await startBodyIndex(
            true
          );
        }

        return res.status(200).json({
          ok: true,
          phase: "title",
          ...result
        });
      }

      const bodyState =
        await readBodyState();

      if (
        bodyState?.status ===
        "running"
      ) {
        const result =
          await processNextBodyBatch();

        return res.status(200).json({
          ok: true,
          phase: "body",
          ...result
        });
      }

      return res.status(200).json({
        ok: true,
        skipped: true,
        reason:
          "No active Broadcom rebuild."
      });
    }

    if (action === "daily_start") {
      const result =
        await startDailyIncremental(
          (stage, data = {}) =>
            console.log(
              `[BROADCOM-DAILY][${stage}]`,
              JSON.stringify(data)
            )
        );

      return res.status(200).json({
        ok: true,
        action: "daily_start",
        ...result
      });
    }

    if (action === "daily_next") {
      const result =
        await processNextDailyIncremental(
          (stage, data = {}) =>
            console.log(
              `[BROADCOM-DAILY][${stage}]`,
              JSON.stringify(data)
            )
        );

      return res.status(200).json({
        ok: true,
        action: "daily_next",
        ...result
      });
    }

    if (action === "status") {
      const [
        titleState,
        titleIndex,
        bodyState,
        bodyManifest,
        dailyState
      ] = await Promise.all([
        readTitleState(),
        readFinalTitleIndex(),
        readBodyState(),
        readBodyManifest(),
        readDailyState()
      ]);

      let phase = "idle";

      if (
        titleState?.status ===
        "running"
      ) {
        phase = "title";
      } else if (
        bodyState?.status ===
        "running"
      ) {
        phase = "body";
      } else if (
        titleState?.status ===
          "completed" &&
        bodyState?.status ===
          "completed"
      ) {
        phase = "completed";
      }

      return res.status(200).json({
        ok: true,
        phase,
        title: {
          state: titleState || null,
          finalIndex: {
            exists: !!titleIndex,
            pageCount:
              titleIndex?.pageCount ||
              titleIndex?.records?.length ||
              0,
            createdAt:
              titleIndex?.createdAt ||
              null,
            language:
              titleIndex?.language ||
              null
          }
        },
        daily: dailyState || null,
        body: {
          state: bodyState || null,
          index: {
            exists: !!bodyManifest,
            indexedPages:
              bodyManifest?.indexedPages ||
              0,
            chunkCount:
              Object.keys(
                bodyManifest?.chunks ||
                {}
              ).length,
            updatedAt:
              bodyManifest?.updatedAt ||
              null
          }
        }
      });
    }

    return res.status(200).json({
      ok: true,
      service:
        "Broadcom Local Bootstrap + Daily Incremental v4.11",
      usage: {
        reset:
          "/api/broadcom?action=reset&token=REINDEX_TOKEN",
        next:
          "/api/broadcom?action=next&token=REINDEX_TOKEN",
        status:
          "/api/broadcom?action=status&token=REINDEX_TOKEN"
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        String(error)
    });
  }
}
