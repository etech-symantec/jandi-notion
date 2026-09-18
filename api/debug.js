import { get } from "@vercel/blob";
import { INDEX_PATH, formatDate } from "../lib/common.js";

export default async function handler(req, res) {
  if (
    process.env.DEBUG_TOKEN &&
    req.query?.token !== process.env.DEBUG_TOKEN
  ) {
    return res.status(401).json({ ok: false, error: "DEBUG_TOKEN required" });
  }

  const report = {
    ok: true,
    service: "JANDI Notion Search v3 Indexed",
    checkedAt: new Date().toISOString(),
    env: {
      NOTION_TOKEN: presence(process.env.NOTION_TOKEN),
      JANDI_TOKEN: presence(process.env.JANDI_TOKEN),
      REINDEX_TOKEN: presence(process.env.REINDEX_TOKEN),
      CRON_SECRET: presence(process.env.CRON_SECRET),
      BLOB_READ_WRITE_TOKEN: presence(process.env.BLOB_READ_WRITE_TOKEN),
      VERCEL_OIDC_TOKEN: presence(process.env.VERCEL_OIDC_TOKEN),
      MAX_RESULTS: process.env.MAX_RESULTS || "5(default)",
      MAX_INDEX_PAGES: process.env.MAX_INDEX_PAGES || "1000(default)",
      MAX_BLOCKS_PER_PAGE: process.env.MAX_BLOCKS_PER_PAGE || "500(default)",
      MAX_BLOCK_DEPTH: process.env.MAX_BLOCK_DEPTH || "5(default)",
      INDEX_CONCURRENCY: process.env.INDEX_CONCURRENCY || "3(default)"
    },
    index: null
  };

  try {
    const result = await get(INDEX_PATH, {
      access: "private",
      useCache: false
    });

    const text = await new Response(result.stream).text();
    const index = JSON.parse(text);

    report.index = {
      exists: true,
      version: index.version,
      createdAt: index.createdAt,
      createdAtKst: formatDate(index.createdAt),
      pageCount: index.pageCount,
      failedCount: index.failedCount,
      config: index.config,
      jsonBytes: Buffer.byteLength(text, "utf8"),
      sampleTitles: Array.isArray(index.pages)
        ? index.pages.slice(0, 10).map(v => v.title)
        : []
    };
  } catch (error) {
    report.ok = false;
    report.index = {
      exists: false,
      error: error?.message || String(error),
      nextStep: "먼저 /api/reindex?token=REINDEX_TOKEN 을 실행하세요."
    };
  }

  return res.status(200).json(report);
}

function presence(value) {
  if (!value) return "MISSING";
  return `SET(length=${String(value).length})`;
}
