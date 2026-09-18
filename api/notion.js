const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";

let bodyIndexCache = {
  createdAt: 0,
  pages: []
};

export default async function handler(req, res) {
  const requestId = makeRequestId();
  const startedAt = Date.now();
  const stage = makeStageLogger(requestId);

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "JANDI Notion Search v2.1 Debug",
      endpoint: "/api/notion",
      debug: "/api/debug",
      requestId,
      features: [
        "제목 검색",
        "본문 검색",
        "단계별 Vercel 로그",
        "처리시간 측정",
        "본문 인덱스 캐시",
        "Notion API 429 재시도"
      ],
      usage: "JANDI에서 /노션 검색어"
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ body: "지원하지 않는 요청 방식입니다." });
  }

  try {
    stage("01_REQUEST_RECEIVED", {
      method: req.method,
      contentType: req.headers["content-type"] || "",
      hasBody: !!req.body
    });

    const payload =
      typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    stage("02_PAYLOAD_PARSED", {
      keyword: payload.keyword || "",
      dataLength: String(payload.data || "").length,
      hasToken: !!payload.token,
      writerName: payload.writerName || ""
    });

    const expectedJandiToken = process.env.JANDI_TOKEN;
    const notionToken = process.env.NOTION_TOKEN;

    stage("03_ENV_CHECK", {
      JANDI_TOKEN: maskPresence(expectedJandiToken),
      NOTION_TOKEN: maskPresence(notionToken),
      MAX_RESULTS: process.env.MAX_RESULTS || "5(default)",
      MAX_SCAN_PAGES: process.env.MAX_SCAN_PAGES || "50(default)",
      MAX_BLOCKS_PER_PAGE: process.env.MAX_BLOCKS_PER_PAGE || "300(default)",
      MAX_BLOCK_DEPTH: process.env.MAX_BLOCK_DEPTH || "2(default)",
      SEARCH_CONCURRENCY: process.env.SEARCH_CONCURRENCY || "2(default)",
      CACHE_TTL_MINUTES: process.env.CACHE_TTL_MINUTES || "10(default)"
    });

    if (!expectedJandiToken) {
      stage("ERROR_JANDI_TOKEN_MISSING");
      return jandiResponse(
        res,
        "⚠️ 서버 설정 오류: JANDI_TOKEN이 등록되지 않았습니다.",
        requestId,
        startedAt
      );
    }

    if (!payload.token || payload.token !== expectedJandiToken) {
      stage("ERROR_JANDI_TOKEN_MISMATCH");
      return jandiResponse(
        res,
        `⛔ 인증되지 않은 잔디 Webhook 요청입니다.\nRequest ID: \`${requestId}\``,
        requestId,
        startedAt
      );
    }

    stage("04_JANDI_TOKEN_OK");

    if (!notionToken) {
      stage("ERROR_NOTION_TOKEN_MISSING");
      return jandiResponse(
        res,
        "⚠️ 서버 설정 오류: NOTION_TOKEN이 등록되지 않았습니다.",
        requestId,
        startedAt
      );
    }

    const query = String(payload.data || "")
      .replace(/\s+/g, " ")
      .trim();

    stage("05_QUERY_READY", { query });

    if (!query) {
      return jandiResponse(
        res,
        [
          "🔎 **Notion 통합 검색**",
          "",
          "검색어를 입력해주세요.",
          "예: `/노션 tcp auto buffer`",
          "",
          `Request ID: \`${requestId}\``
        ].join("\n"),
        requestId,
        startedAt
      );
    }

    const maxResults = clampNumber(process.env.MAX_RESULTS, 1, 10, 5);

    const titleStarted = Date.now();
    stage("06_TITLE_SEARCH_START");

    const titleResults = await searchNotionByTitle(notionToken, query, stage);

    stage("07_TITLE_SEARCH_DONE", {
      count: titleResults.length,
      ms: Date.now() - titleStarted
    });

    const bodyStarted = Date.now();
    stage("08_BODY_INDEX_START");

    const index = await getOrBuildBodyIndex(notionToken, stage);

    stage("09_BODY_INDEX_DONE", {
      pages: index.pages.length,
      cached: index.cached,
      ms: Date.now() - bodyStarted
    });

    const bodySearchStarted = Date.now();
    const bodyResults = searchBodyIndex(index.pages, query);

    stage("10_BODY_SEARCH_DONE", {
      count: bodyResults.length,
      ms: Date.now() - bodySearchStarted
    });

    const merged = mergeResults(titleResults, bodyResults)
      .slice(0, maxResults);

    stage("11_MERGE_DONE", {
      finalCount: merged.length,
      totalMs: Date.now() - startedAt
    });

    if (merged.length === 0) {
      return jandiResponse(
        res,
        [
          "🔎 **Notion 검색 결과**",
          "",
          `\`${escapeMarkdown(query)}\`에 대한 결과가 없습니다.`,
          "",
          `제목 검색 결과: ${titleResults.length}건`,
          `본문 검색 대상: ${index.pages.length}개 페이지`,
          `본문 일치: ${bodyResults.length}건`,
          `캐시 사용: ${index.cached ? "예" : "아니오"}`,
          `처리시간: ${formatMs(Date.now() - startedAt)}`,
          "",
          `Request ID: \`${requestId}\``
        ].join("\n"),
        requestId,
        startedAt
      );
    }

    const bodyLines = [
      "🔎 **Notion 통합 검색 결과**",
      "",
      `검색어: **${escapeMarkdown(query)}**`,
      `결과: ${merged.length}건`,
      `본문 검색 대상: ${index.pages.length}개 페이지`,
      `캐시: ${index.cached ? "사용" : "새로 생성"}`,
      `처리시간: ${formatMs(Date.now() - startedAt)}`,
      ""
    ];

    const connectInfo = [];

    for (let i = 0; i < merged.length; i++) {
      const item = merged[i];
      const badges = [];
      if (item.titleMatch) badges.push("제목");
      if (item.bodyMatch) badges.push("본문");

      const badgeText = badges.length ? ` [${badges.join("+")}]` : "";
      bodyLines.push(
        `${i + 1}. [${escapeMarkdown(item.title)}](${item.url})${badgeText}`
      );

      let description = "";
      if (item.snippet) description += `${truncate(item.snippet, 350)}\n`;
      if (item.lastEdited) {
        description += `최근 수정: ${formatDate(item.lastEdited)}\n`;
      }
      description += item.url;

      connectInfo.push({
        title: `${i + 1}. ${item.title}${badgeText}`,
        description: truncate(description.trim(), 1000)
      });
    }

    bodyLines.push("");
    bodyLines.push(`Request ID: \`${requestId}\``);

    stage("12_RESPONSE_READY", {
      responseBodyLength: bodyLines.join("\n").length,
      totalMs: Date.now() - startedAt
    });

    return res.status(200).json({
      body: truncate(bodyLines.join("\n"), 4500),
      connectColor: "#000000",
      connectInfo
    });

  } catch (error) {
    stage("99_UNHANDLED_ERROR", {
      name: error?.name || "",
      message: error?.message || String(error),
      stack: String(error?.stack || "").slice(0, 1200),
      totalMs: Date.now() - startedAt
    });

    if (String(error?.message || "").includes("NOTION_RATE_LIMIT")) {
      return jandiResponse(
        res,
        `⚠️ Notion API 요청이 많아 잠시 제한되었습니다.\n몇 초 후 다시 검색해주세요.\n\nRequest ID: \`${requestId}\``,
        requestId,
        startedAt
      );
    }

    return jandiResponse(
      res,
      [
        "⚠️ 검색 처리 중 오류가 발생했습니다.",
        "Vercel Logs에서 아래 Request ID를 검색해주세요.",
        "",
        `Request ID: \`${requestId}\``,
        `처리시간: ${formatMs(Date.now() - startedAt)}`
      ].join("\n"),
      requestId,
      startedAt
    );
  }
}


// -----------------------------------------------------------------------------
// 제목 검색
// -----------------------------------------------------------------------------

async function searchNotionByTitle(token, query, stage) {
  const response = await notionFetch(token, "/search", {
    method: "POST",
    body: {
      query,
      page_size: 50,
      sort: {
        direction: "descending",
        timestamp: "last_edited_time"
      }
    },
    stage,
    label: "TITLE_SEARCH"
  });

  const items = Array.isArray(response.results) ? response.results : [];

  return items
    .filter(item => item?.object === "page")
    .map(item => ({
      id: item.id,
      title: getTitle(item),
      url: item.url || makeNotionUrl(item.id),
      lastEdited: item.last_edited_time || "",
      titleMatch: true,
      bodyMatch: false,
      snippet: "",
      score: 1000
    }));
}


// -----------------------------------------------------------------------------
// 본문 인덱스
// -----------------------------------------------------------------------------

async function getOrBuildBodyIndex(token, stage) {
  const ttlMinutes = clampNumber(process.env.CACHE_TTL_MINUTES, 1, 1440, 10);
  const ttlMs = ttlMinutes * 60 * 1000;
  const now = Date.now();

  if (
    bodyIndexCache.pages.length > 0 &&
    now - bodyIndexCache.createdAt < ttlMs
  ) {
    stage("BODY_INDEX_CACHE_HIT", {
      pages: bodyIndexCache.pages.length,
      ageSeconds: Math.round((now - bodyIndexCache.createdAt) / 1000)
    });

    return {
      pages: bodyIndexCache.pages,
      cached: true
    };
  }

  stage("BODY_INDEX_CACHE_MISS");

  const pages = await listAccessiblePages(token, stage);
  const concurrency = clampNumber(process.env.SEARCH_CONCURRENCY, 1, 3, 2);

  stage("BODY_INDEX_PAGE_LIST_DONE", {
    pages: pages.length,
    concurrency
  });

  let done = 0;
  let failed = 0;

  const indexed = await mapLimit(pages, concurrency, async page => {
    const pageStarted = Date.now();

    try {
      const bodyText = await readPageText(token, page.id, stage);
      done += 1;

      stage("BODY_INDEX_PAGE_DONE", {
        done,
        total: pages.length,
        title: getTitle(page),
        chars: bodyText.length,
        ms: Date.now() - pageStarted
      });

      return {
        id: page.id,
        title: getTitle(page),
        url: page.url || makeNotionUrl(page.id),
        lastEdited: page.last_edited_time || "",
        text: bodyText
      };
    } catch (err) {
      failed += 1;
      stage("BODY_INDEX_PAGE_FAILED", {
        failed,
        total: pages.length,
        pageId: page.id,
        title: getTitle(page),
        message: err?.message || String(err),
        ms: Date.now() - pageStarted
      });

      return {
        id: page.id,
        title: getTitle(page),
        url: page.url || makeNotionUrl(page.id),
        lastEdited: page.last_edited_time || "",
        text: ""
      };
    }
  });

  bodyIndexCache = {
    createdAt: Date.now(),
    pages: indexed
  };

  stage("BODY_INDEX_BUILD_COMPLETE", {
    pages: indexed.length,
    failed
  });

  return {
    pages: indexed,
    cached: false
  };
}

async function listAccessiblePages(token, stage) {
  const maxPages = clampNumber(process.env.MAX_SCAN_PAGES, 5, 200, 50);

  const pages = [];
  let cursor = undefined;
  let call = 0;

  while (pages.length < maxPages) {
    call += 1;

    const body = {
      page_size: Math.min(100, maxPages - pages.length),
      sort: {
        direction: "descending",
        timestamp: "last_edited_time"
      }
    };

    if (cursor) body.start_cursor = cursor;

    const data = await notionFetch(token, "/search", {
      method: "POST",
      body,
      stage,
      label: `PAGE_LIST_${call}`
    });

    const results = Array.isArray(data.results) ? data.results : [];

    for (const item of results) {
      if (item?.object === "page") {
        pages.push(item);
        if (pages.length >= maxPages) break;
      }
    }

    stage("PAGE_LIST_BATCH", {
      call,
      returned: results.length,
      pageObjects: pages.length,
      hasMore: !!data.has_more
    });

    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }

  return dedupeById(pages);
}


// -----------------------------------------------------------------------------
// 페이지 본문 읽기
// -----------------------------------------------------------------------------

async function readPageText(token, pageId, stage) {
  const maxDepth = clampNumber(process.env.MAX_BLOCK_DEPTH, 0, 5, 2);
  const maxBlocks = clampNumber(process.env.MAX_BLOCKS_PER_PAGE, 50, 1000, 300);

  const collected = [];
  const counter = { value: 0 };

  await readChildrenRecursive(
    token,
    pageId,
    0,
    maxDepth,
    maxBlocks,
    collected,
    counter,
    stage
  );

  return normalizeSpace(collected.join("\n"));
}

async function readChildrenRecursive(
  token,
  blockId,
  depth,
  maxDepth,
  maxBlocks,
  collected,
  counter,
  stage
) {
  if (counter.value >= maxBlocks) return;

  let cursor = undefined;

  do {
    const qs = new URLSearchParams({ page_size: "100" });
    if (cursor) qs.set("start_cursor", cursor);

    const data = await notionFetch(
      token,
      `/blocks/${encodeURIComponent(blockId)}/children?${qs.toString()}`,
      {
        method: "GET",
        stage,
        label: "BLOCK_CHILDREN"
      }
    );

    const blocks = Array.isArray(data.results) ? data.results : [];

    for (const block of blocks) {
      if (counter.value >= maxBlocks) break;
      counter.value += 1;

      const text = blockToText(block);
      if (text) collected.push(text);

      if (
        block?.has_children &&
        depth < maxDepth &&
        counter.value < maxBlocks
      ) {
        await readChildrenRecursive(
          token,
          block.id,
          depth + 1,
          maxDepth,
          maxBlocks,
          collected,
          counter,
          stage
        );
      }
    }

    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor && counter.value < maxBlocks);
}

function blockToText(block) {
  if (!block || !block.type) return "";

  const data = block[block.type];

  if (data && Array.isArray(data.rich_text)) {
    const rich = richTextToPlain(data.rich_text);
    const extras = [];

    if (Array.isArray(data.caption)) {
      const caption = richTextToPlain(data.caption);
      if (caption) extras.push(caption);
    }

    return normalizeSpace([rich, ...extras].filter(Boolean).join(" "));
  }

  if (block.type === "child_page") return normalizeSpace(data?.title || "");
  if (block.type === "child_database") return normalizeSpace(data?.title || "");

  if (
    ["bookmark", "embed", "link_preview"].includes(block.type) &&
    typeof data?.url === "string"
  ) {
    return data.url;
  }

  if (block.type === "equation" && typeof data?.expression === "string") {
    return data.expression;
  }

  return "";
}


// -----------------------------------------------------------------------------
// 본문 검색
// -----------------------------------------------------------------------------

function searchBodyIndex(pages, query) {
  const q = normalizeForSearch(query);
  const tokens = tokenize(query);

  if (!q) return [];

  const results = [];

  for (const page of pages) {
    const titleNorm = normalizeForSearch(page.title);
    const bodyNorm = normalizeForSearch(page.text);

    const titlePhrase = titleNorm.includes(q);
    const bodyPhrase = bodyNorm.includes(q);

    const titleTokenHits = tokens.filter(t => titleNorm.includes(t)).length;
    const bodyTokenHits = tokens.filter(t => bodyNorm.includes(t)).length;

    if (
      !titlePhrase &&
      !bodyPhrase &&
      titleTokenHits === 0 &&
      bodyTokenHits === 0
    ) {
      continue;
    }

    let score = 0;

    if (titlePhrase) score += 900;
    if (bodyPhrase) score += 500;

    score += titleTokenHits * 150;
    score += bodyTokenHits * 40;

    if (tokens.length > 1 && titleTokenHits === tokens.length) score += 300;
    if (tokens.length > 1 && bodyTokenHits === tokens.length) score += 200;

    results.push({
      id: page.id,
      title: page.title,
      url: page.url,
      lastEdited: page.lastEdited,
      titleMatch: titlePhrase || titleTokenHits > 0,
      bodyMatch: bodyPhrase || bodyTokenHits > 0,
      snippet: makeSnippet(page.text, query),
      score
    });
  }

  return results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return dateValue(b.lastEdited) - dateValue(a.lastEdited);
  });
}

function mergeResults(titleResults, bodyResults) {
  const map = new Map();

  for (const item of bodyResults) {
    map.set(item.id, { ...item });
  }

  for (const item of titleResults) {
    const existing = map.get(item.id);

    if (existing) {
      existing.titleMatch = true;
      existing.score += 1000;
      if (!existing.title || existing.title === "제목 없음") {
        existing.title = item.title;
      }
      if (!existing.url) existing.url = item.url;
      if (!existing.lastEdited) existing.lastEdited = item.lastEdited;
    } else {
      map.set(item.id, { ...item });
    }
  }

  return [...map.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return dateValue(b.lastEdited) - dateValue(a.lastEdited);
  });
}

function makeSnippet(text, query) {
  const source = normalizeSpace(text);
  if (!source) return "";

  const sourceLower = source.toLocaleLowerCase("ko-KR");
  const q = normalizeSpace(query).toLocaleLowerCase("ko-KR");

  let pos = sourceLower.indexOf(q);

  if (pos < 0) {
    for (const token of tokenize(query)) {
      pos = sourceLower.indexOf(token);
      if (pos >= 0) break;
    }
  }

  if (pos < 0) return truncate(source, 220);

  const before = 80;
  const after = 180;
  const start = Math.max(0, pos - before);
  const end = Math.min(source.length, pos + q.length + after);

  return `${start > 0 ? "…" : ""}${source.slice(start, end)}${end < source.length ? "…" : ""}`;
}


// -----------------------------------------------------------------------------
// Notion API
// -----------------------------------------------------------------------------

async function notionFetch(token, path, options = {}) {
  const method = options.method || "GET";
  const stage = options.stage || (() => {});
  const label = options.label || path;

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json"
  };

  let lastResponse;

  for (let attempt = 0; attempt < 4; attempt++) {
    const started = Date.now();

    stage("NOTION_API_CALL", {
      label,
      method,
      path: sanitizeNotionPath(path),
      attempt: attempt + 1
    });

    const response = await fetch(`${NOTION_API}${path}`, {
      method,
      headers,
      body:
        method === "GET" || options.body === undefined
          ? undefined
          : JSON.stringify(options.body)
    });

    lastResponse = response;

    stage("NOTION_API_RESPONSE", {
      label,
      status: response.status,
      ms: Date.now() - started,
      attempt: attempt + 1
    });

    if (response.status !== 429) {
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = data?.message || `Notion API HTTP ${response.status}`;
        throw new Error(`${label}: ${message}`);
      }

      return data;
    }

    const retryAfter = Number(response.headers.get("retry-after") || "1");

    stage("NOTION_RATE_LIMIT_RETRY", {
      label,
      retryAfterSeconds: retryAfter
    });

    await sleep(Math.max(1000, retryAfter * 1000));
  }

  console.error("Notion rate limit:", lastResponse?.status);
  throw new Error("NOTION_RATE_LIMIT");
}


// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function makeStageLogger(requestId) {
  const zero = Date.now();

  return (name, data = undefined) => {
    const ms = Date.now() - zero;
    const prefix = `[JANDI-NOTION][${requestId}][+${ms}ms][${name}]`;

    if (data === undefined) {
      console.log(prefix);
    } else {
      console.log(prefix, safeJson(data));
    }
  };
}

function jandiResponse(res, body, requestId, startedAt) {
  console.log(
    `[JANDI-NOTION][${requestId}][RESPONSE]`,
    safeJson({ totalMs: Date.now() - startedAt, bodyLength: String(body || "").length })
  );

  return res.status(200).json({
    body: truncate(body, 4500),
    connectColor: "#000000"
  });
}

function makeRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function maskPresence(value) {
  if (!value) return "MISSING";
  return `SET(length=${String(value).length})`;
}

function safeJson(data) {
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

function sanitizeNotionPath(path) {
  return String(path).replace(
    /\/blocks\/([0-9a-f-]{20,})\/children/i,
    "/blocks/{block_id}/children"
  );
}

function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}초`;
}

function getTitle(item) {
  if (item?.properties && typeof item.properties === "object") {
    for (const property of Object.values(item.properties)) {
      if (property?.type === "title" && Array.isArray(property.title)) {
        const text = richTextToPlain(property.title);
        if (text) return text;
      }
    }
  }

  if (Array.isArray(item?.title)) {
    const text = richTextToPlain(item.title);
    if (text) return text;
  }

  if (typeof item?.name === "string" && item.name.trim()) {
    return item.name.trim();
  }

  return "제목 없음";
}

function richTextToPlain(richText) {
  if (!Array.isArray(richText)) return "";

  return normalizeSpace(
    richText
      .map(v => v?.plain_text || v?.text?.content || "")
      .join("")
  );
}

function normalizeForSearch(text) {
  return normalizeSpace(text)
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR");
}

function tokenize(text) {
  return [...new Set(
    normalizeForSearch(text)
      .split(/\s+/)
      .map(v => v.trim())
      .filter(v => v.length >= 2)
  )];
}

function normalizeSpace(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function makeNotionUrl(id) {
  if (!id) return "https://www.notion.so";
  return `https://www.notion.so/${String(id).replace(/-/g, "")}`;
}

function dedupeById(items) {
  const map = new Map();
  for (const item of items) {
    if (item?.id && !map.has(item.id)) {
      map.set(item.id, item);
    }
  }
  return [...map.values()];
}

function dateValue(value) {
  const n = Date.parse(value || "");
  return Number.isFinite(n) ? n : 0;
}

function formatDate(value) {
  if (!value) return "";

  try {
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function truncate(text, max) {
  const s = String(text || "");
  return s.length <= max ? s : s.slice(0, max - 12) + " …(생략)";
}

function escapeMarkdown(text) {
  return String(text || "").replace(/([\\`*_[\]()])/g, "\\$1");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length || 1) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}
