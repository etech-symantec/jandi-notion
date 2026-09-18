const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";

// Vercel warm instance에서만 유지되는 간단한 메모리 캐시.
// 인스턴스가 교체되면 자동 초기화되며, 영구 저장소가 필요하지 않습니다.
let bodyIndexCache = {
  createdAt: 0,
  pages: []
};

export default async function handler(req, res) {
  console.log("=== JANDI REQUEST START ===");
  console.log("method:", req.method);
  console.log("body:", JSON.stringify(req.body));
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "JANDI Notion Search v2",
      endpoint: "/api/notion",
      features: [
        "Notion 제목 검색",
        "Notion 페이지 본문 검색",
        "관련도 정렬",
        "warm-instance 메모리 캐시"
      ],
      usage: "JANDI에서 /노션 검색어"
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ body: "지원하지 않는 요청 방식입니다." });
  }

  try {
    const payload =
      typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    const expectedJandiToken = process.env.JANDI_TOKEN;
    const notionToken = process.env.NOTION_TOKEN;

    if (!expectedJandiToken) {
      console.error("JANDI_TOKEN 환경변수가 없습니다.");
      return jandiResponse(
        res,
        "⚠️ 서버 설정 오류: JANDI_TOKEN이 등록되지 않았습니다."
      );
    }

    if (!payload.token || payload.token !== expectedJandiToken) {
      return jandiResponse(
        res,
        "⛔ 인증되지 않은 잔디 Webhook 요청입니다."
      );
    }

    if (!notionToken) {
      console.error("NOTION_TOKEN 환경변수가 없습니다.");
      return jandiResponse(
        res,
        "⚠️ 서버 설정 오류: NOTION_TOKEN이 등록되지 않았습니다."
      );
    }

    const query = String(payload.data || "")
      .replace(/\s+/g, " ")
      .trim();

    if (!query) {
      return jandiResponse(
        res,
        [
          "🔎 **Notion 통합 검색**",
          "",
          "검색어를 입력해주세요.",
          "예: `/노션 tcp auto buffer`",
          "예: `/노션 cyberark duo`"
        ].join("\n")
      );
    }

    const maxResults = clampNumber(process.env.MAX_RESULTS, 1, 10, 5);

    // 1) Notion 공식 Search API: 제목/검색 인덱스 기반 검색
    const titleResults = await searchNotionByTitle(notionToken, query);

    // 2) 접근 가능한 페이지의 본문을 읽어 검색
    //    캐시가 유효하면 Notion 전체 본문을 매번 다시 읽지 않습니다.
    const index = await getOrBuildBodyIndex(notionToken);
    const bodyResults = searchBodyIndex(index.pages, query);

    // 3) 같은 페이지를 합치고 관련도 순으로 정렬
    const merged = mergeResults(titleResults, bodyResults, query)
      .slice(0, maxResults);

    if (merged.length === 0) {
      return jandiResponse(
        res,
        [
          "🔎 **Notion 검색 결과**",
          "",
          `\`${escapeMarkdown(query)}\`에 대한 결과가 없습니다.`,
          "",
          `본문 검색 대상 페이지: ${index.pages.length}개`,
          "",
          "검색 대상 페이지가 Notion Integration에 공유되어 있는지 확인해주세요."
        ].join("\n")
      );
    }

    const bodyLines = [
      "🔎 **Notion 통합 검색 결과**",
      "",
      `검색어: **${escapeMarkdown(query)}**`,
      `결과: ${merged.length}건`,
      `본문 검색 대상: ${index.pages.length}개 페이지`,
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
      if (item.snippet) {
        description += `${truncate(item.snippet, 350)}\n`;
      }
      if (item.lastEdited) {
        description += `최근 수정: ${formatDate(item.lastEdited)}\n`;
      }
      description += item.url;

      connectInfo.push({
        title: `${i + 1}. ${item.title}${badgeText}`,
        description: truncate(description.trim(), 1000)
      });
    }

    return res.status(200).json({
      body: truncate(bodyLines.join("\n"), 4500),
      connectColor: "#000000",
      connectInfo
    });

  } catch (error) {
    console.error("Unhandled error:", error);

    if (String(error?.message || "").includes("NOTION_RATE_LIMIT")) {
      return jandiResponse(
        res,
        "⚠️ Notion API 요청이 많아 잠시 제한되었습니다. 몇 초 후 다시 검색해주세요."
      );
    }

    return jandiResponse(
      res,
      "⚠️ 검색 처리 중 오류가 발생했습니다. Vercel Function 로그를 확인해주세요."
    );
  }
}


// -----------------------------------------------------------------------------
// 제목 검색
// -----------------------------------------------------------------------------

async function searchNotionByTitle(token, query) {
  const response = await notionFetch(token, "/search", {
    method: "POST",
    body: {
      query,
      page_size: 50,
      sort: {
        direction: "descending",
        timestamp: "last_edited_time"
      }
    }
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
// 본문 인덱스 생성/캐시
// -----------------------------------------------------------------------------

async function getOrBuildBodyIndex(token) {
  const ttlMinutes = clampNumber(process.env.CACHE_TTL_MINUTES, 1, 1440, 10);
  const ttlMs = ttlMinutes * 60 * 1000;
  const now = Date.now();

  if (
    bodyIndexCache.pages.length > 0 &&
    now - bodyIndexCache.createdAt < ttlMs
  ) {
    return {
      pages: bodyIndexCache.pages,
      cached: true
    };
  }

  const pages = await listAccessiblePages(token);
  const concurrency = clampNumber(process.env.SEARCH_CONCURRENCY, 1, 3, 2);
  const indexed = await mapLimit(pages, concurrency, async page => {
    try {
      const bodyText = await readPageText(token, page.id);

      return {
        id: page.id,
        title: getTitle(page),
        url: page.url || makeNotionUrl(page.id),
        lastEdited: page.last_edited_time || "",
        text: bodyText
      };
    } catch (err) {
      console.error(`페이지 본문 조회 실패: ${page.id}`, err?.message || err);
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

  return {
    pages: indexed,
    cached: false
  };
}

async function listAccessiblePages(token) {
  const maxPages = clampNumber(process.env.MAX_SCAN_PAGES, 5, 200, 50);

  const pages = [];
  let cursor = undefined;

  while (pages.length < maxPages) {
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
      body
    });

    const results = Array.isArray(data.results) ? data.results : [];

    for (const item of results) {
      if (item?.object === "page") {
        pages.push(item);
        if (pages.length >= maxPages) break;
      }
    }

    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }

  return dedupeById(pages);
}


// -----------------------------------------------------------------------------
// 페이지 블록 본문 읽기
// -----------------------------------------------------------------------------

async function readPageText(token, pageId) {
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
    counter
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
  counter
) {
  if (counter.value >= maxBlocks) return;

  let cursor = undefined;

  do {
    const qs = new URLSearchParams({
      page_size: "100"
    });

    if (cursor) qs.set("start_cursor", cursor);

    const data = await notionFetch(
      token,
      `/blocks/${encodeURIComponent(blockId)}/children?${qs.toString()}`,
      { method: "GET" }
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
          counter
        );
      }
    }

    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor && counter.value < maxBlocks);
}

function blockToText(block) {
  if (!block || !block.type) return "";

  const data = block[block.type];

  // 대부분의 텍스트 블록
  if (data && Array.isArray(data.rich_text)) {
    const rich = richTextToPlain(data.rich_text);
    const extras = [];

    if (typeof data.caption === "object" && Array.isArray(data.caption)) {
      const caption = richTextToPlain(data.caption);
      if (caption) extras.push(caption);
    }

    return normalizeSpace([rich, ...extras].filter(Boolean).join(" "));
  }

  // child_page / child_database 제목
  if (block.type === "child_page") {
    return normalizeSpace(data?.title || "");
  }

  if (block.type === "child_database") {
    return normalizeSpace(data?.title || "");
  }

  // bookmark/embed/link_preview URL도 검색 가능하게 포함
  if (
    ["bookmark", "embed", "link_preview"].includes(block.type) &&
    typeof data?.url === "string"
  ) {
    return data.url;
  }

  // equation
  if (block.type === "equation" && typeof data?.expression === "string") {
    return data.expression;
  }

  return "";
}


// -----------------------------------------------------------------------------
// 본문 검색 / 점수
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

    // 구문 또는 토큰 하나라도 맞으면 후보
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

function mergeResults(titleResults, bodyResults, query) {
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

  if (pos < 0) {
    return truncate(source, 220);
  }

  const before = 80;
  const after = 180;
  const start = Math.max(0, pos - before);
  const end = Math.min(source.length, pos + q.length + after);

  return `${start > 0 ? "…" : ""}${source.slice(start, end)}${end < source.length ? "…" : ""}`;
}


// -----------------------------------------------------------------------------
// Notion API 공통 호출 + 429 재시도
// -----------------------------------------------------------------------------

async function notionFetch(token, path, options = {}) {
  const method = options.method || "GET";
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json"
  };

  let lastResponse;

  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`${NOTION_API}${path}`, {
      method,
      headers,
      body:
        method === "GET" || options.body === undefined
          ? undefined
          : JSON.stringify(options.body)
    });

    lastResponse = response;

    if (response.status !== 429) {
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = data?.message || `Notion API HTTP ${response.status}`;
        throw new Error(message);
      }

      return data;
    }

    const retryAfter = Number(response.headers.get("retry-after") || "1");
    await sleep(Math.max(1000, retryAfter * 1000));
  }

  console.error("Notion rate limit:", lastResponse?.status);
  throw new Error("NOTION_RATE_LIMIT");
}


// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

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
