const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";

export default async function handler(req, res) {
  const startedAt = Date.now();

  // debug endpoint 보호. DEBUG_TOKEN이 설정되어 있으면 ?token=... 필요
  const debugToken = process.env.DEBUG_TOKEN;
  if (debugToken && req.query?.token !== debugToken) {
    return res.status(401).json({
      ok: false,
      message: "DEBUG_TOKEN이 필요합니다."
    });
  }

  const report = {
    ok: true,
    service: "JANDI Notion Search v2.1 Debug",
    checkedAt: new Date().toISOString(),
    environment: {},
    tests: []
  };

  const add = (name, ok, detail = {}, ms = 0) => {
    report.tests.push({ name, ok, ms, ...detail });
    if (!ok) report.ok = false;
  };

  const notionToken = process.env.NOTION_TOKEN;
  const jandiToken = process.env.JANDI_TOKEN;

  report.environment = {
    NOTION_TOKEN: presence(notionToken),
    JANDI_TOKEN: presence(jandiToken),
    MAX_RESULTS: process.env.MAX_RESULTS || "5(default)",
    MAX_SCAN_PAGES: process.env.MAX_SCAN_PAGES || "50(default)",
    MAX_BLOCKS_PER_PAGE: process.env.MAX_BLOCKS_PER_PAGE || "300(default)",
    MAX_BLOCK_DEPTH: process.env.MAX_BLOCK_DEPTH || "2(default)",
    SEARCH_CONCURRENCY: process.env.SEARCH_CONCURRENCY || "2(default)",
    CACHE_TTL_MINUTES: process.env.CACHE_TTL_MINUTES || "10(default)",
    DEBUG_TOKEN: debugToken ? "SET" : "NOT_SET (debug endpoint is public)"
  };

  add(
    "Environment variables",
    !!notionToken && !!jandiToken,
    {
      detail:
        notionToken && jandiToken
          ? "필수 환경변수가 설정되어 있습니다."
          : "NOTION_TOKEN 또는 JANDI_TOKEN이 누락되었습니다."
    }
  );

  if (!notionToken) {
    report.totalMs = Date.now() - startedAt;
    return res.status(200).json(report);
  }

  // 1. Notion /search auth + response test
  let firstPage = null;

  try {
    const t = Date.now();

    const r = await notionRequest(notionToken, "/search", {
      method: "POST",
      body: {
        page_size: 10,
        sort: {
          direction: "descending",
          timestamp: "last_edited_time"
        }
      }
    });

    const results = Array.isArray(r.results) ? r.results : [];
    const pages = results.filter(v => v?.object === "page");
    firstPage = pages[0] || null;

    add(
      "Notion authentication + search",
      true,
      {
        httpStatus: 200,
        returnedObjects: results.length,
        returnedPages: pages.length,
        hasMore: !!r.has_more,
        samplePageTitle: firstPage ? getTitle(firstPage) : null
      },
      Date.now() - t
    );
  } catch (e) {
    add(
      "Notion authentication + search",
      false,
      { error: e.message },
      0
    );
  }

  // 2. Count accessible pages up to configured limit
  try {
    const t = Date.now();
    const limit = clampNumber(process.env.MAX_SCAN_PAGES, 5, 200, 50);

    const result = await countAccessiblePages(notionToken, limit);

    add(
      "Accessible page scan",
      true,
      {
        configuredLimit: limit,
        scannedPages: result.pages.length,
        hasMoreBeyondLimit: result.hasMore
      },
      Date.now() - t
    );

    if (!firstPage && result.pages.length) firstPage = result.pages[0];
  } catch (e) {
    add(
      "Accessible page scan",
      false,
      { error: e.message },
      0
    );
  }

  // 3. Sample page block read
  if (firstPage) {
    try {
      const t = Date.now();

      const pageId = firstPage.id;
      const blocks = await notionRequest(
        notionToken,
        `/blocks/${encodeURIComponent(pageId)}/children?page_size=20`,
        { method: "GET" }
      );

      const rows = Array.isArray(blocks.results) ? blocks.results : [];
      const textSamples = rows
        .map(blockToText)
        .filter(Boolean)
        .slice(0, 5);

      add(
        "Sample page body read",
        true,
        {
          pageTitle: getTitle(firstPage),
          returnedBlocks: rows.length,
          hasMore: !!blocks.has_more,
          textSampleCount: textSamples.length,
          textSamples
        },
        Date.now() - t
      );
    } catch (e) {
      add(
        "Sample page body read",
        false,
        {
          pageTitle: getTitle(firstPage),
          error: e.message
        },
        0
      );
    }
  } else {
    add(
      "Sample page body read",
      false,
      { detail: "읽을 수 있는 Page 객체를 찾지 못했습니다." },
      0
    );
  }

  // 4. JANDI endpoint information
  add(
    "JANDI Webhook endpoint",
    true,
    {
      endpoint: "/api/notion",
      note:
        "이 항목은 JANDI가 실제 POST를 보냈는지는 확인하지 않습니다. 실제 수신 여부는 Vercel Logs에서 [01_REQUEST_RECEIVED] 로그로 확인하세요."
    }
  );

  report.totalMs = Date.now() - startedAt;
  return res.status(200).json(report);
}

async function countAccessiblePages(token, maxPages) {
  const pages = [];
  let cursor = undefined;
  let hasMore = false;

  while (pages.length < maxPages) {
    const body = {
      page_size: Math.min(100, maxPages - pages.length),
      sort: {
        direction: "descending",
        timestamp: "last_edited_time"
      }
    };

    if (cursor) body.start_cursor = cursor;

    const data = await notionRequest(token, "/search", {
      method: "POST",
      body
    });

    const results = Array.isArray(data.results) ? data.results : [];

    for (const item of results) {
      if (item?.object === "page") {
        pages.push(item);
        if (pages.length >= maxPages) break;
      }
    }

    hasMore = !!data.has_more;
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }

  return { pages, hasMore };
}

async function notionRequest(token, path, options = {}) {
  const method = options.method || "GET";

  const response = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json"
    },
    body:
      method === "GET" || options.body === undefined
        ? undefined
        : JSON.stringify(options.body)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${data?.message || "Unknown Notion API error"}`
    );
  }

  return data;
}

function blockToText(block) {
  if (!block || !block.type) return "";

  const data = block[block.type];

  if (data && Array.isArray(data.rich_text)) {
    return data.rich_text.map(v => v?.plain_text || "").join("").trim();
  }

  if (block.type === "child_page") return String(data?.title || "").trim();
  if (block.type === "child_database") return String(data?.title || "").trim();

  return "";
}

function getTitle(item) {
  if (item?.properties && typeof item.properties === "object") {
    for (const property of Object.values(item.properties)) {
      if (property?.type === "title" && Array.isArray(property.title)) {
        const text = property.title
          .map(v => v?.plain_text || "")
          .join("")
          .trim();

        if (text) return text;
      }
    }
  }

  if (Array.isArray(item?.title)) {
    const text = item.title.map(v => v?.plain_text || "").join("").trim();
    if (text) return text;
  }

  return "제목 없음";
}

function presence(value) {
  if (!value) return "MISSING";
  return `SET(length=${String(value).length})`;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
