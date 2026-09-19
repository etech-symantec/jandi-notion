export const NOTION_API = "https://api.notion.com/v1";
export const NOTION_VERSION = "2026-03-11";

export const FINAL_INDEX_PATH = "jandi-notion/notion-index.json";
export const STATE_PATH = "jandi-notion/reindex-state.json";

export function chunkPath(runId, chunkNo) {
  return `jandi-notion/chunks/${runId}/chunk-${String(chunkNo).padStart(4, "0")}.json`;
}

export function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function normalizeSpace(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeForSearch(text) {
  return normalizeSpace(text)
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR");
}

export function tokenize(text) {
  return [...new Set(
    normalizeForSearch(text)
      .split(/\s+/)
      .map(v => v.trim())
      .filter(v => v.length >= 2)
  )];
}

export function richTextToPlain(richText) {
  if (!Array.isArray(richText)) return "";
  return normalizeSpace(
    richText.map(v => v?.plain_text || v?.text?.content || "").join("")
  );
}

export function getTitle(item) {
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

export function makeNotionUrl(id) {
  if (!id) return "https://www.notion.so";
  return `https://www.notion.so/${String(id).replace(/-/g, "")}`;
}

export function formatDate(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(value));
  } catch {
    return "";
  }
}

export function truncate(text, max) {
  const s = String(text || "");
  return s.length <= max ? s : s.slice(0, max - 12) + " …(생략)";
}

export function escapeMarkdown(text) {
  return String(text || "").replace(/([\\`*_[\]()])/g, "\\$1");
}

export function dateValue(value) {
  const n = Date.parse(value || "");
  return Number.isFinite(n) ? n : 0;
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function mapLimit(items, limit, fn) {
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

export async function notionFetch(token, path, options = {}) {
  const method = options.method || "GET";
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json"
  };

  let lastStatus = 0;

  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(`${NOTION_API}${path}`, {
      method,
      headers,
      body:
        method === "GET" || options.body === undefined
          ? undefined
          : JSON.stringify(options.body)
    });

    lastStatus = response.status;

    if (response.status !== 429) {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.message || `Notion API HTTP ${response.status}`);
      }
      return data;
    }

    const retryAfter = Number(response.headers.get("retry-after") || "1");
    await sleep(Math.max(1000, retryAfter * 1000));
  }

  throw new Error(`NOTION_RATE_LIMIT_HTTP_${lastStatus || 429}`);
}

export function blockToText(block) {
  if (!block || !block.type) return "";
  const data = block[block.type];

  if (data && Array.isArray(data.rich_text)) {
    const parts = [richTextToPlain(data.rich_text)];
    if (Array.isArray(data.caption)) parts.push(richTextToPlain(data.caption));
    return normalizeSpace(parts.filter(Boolean).join(" "));
  }

  if (block.type === "child_page") return normalizeSpace(data?.title || "");
  if (block.type === "child_database") return normalizeSpace(data?.title || "");

  if (
    ["bookmark", "embed", "link_preview"].includes(block.type) &&
    typeof data?.url === "string"
  ) return data.url;

  if (block.type === "equation" && typeof data?.expression === "string") {
    return data.expression;
  }

  return "";
}

export function makeSnippet(text, query) {
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

  const start = Math.max(0, pos - 80);
  const end = Math.min(source.length, pos + Math.max(q.length, 1) + 180);
  return `${start > 0 ? "…" : ""}${source.slice(start, end)}${end < source.length ? "…" : ""}`;
}

export function isAuthorized(req) {
  const q = typeof req.query?.token === "string" ? req.query.token : "";
  return !!process.env.REINDEX_TOKEN && q === process.env.REINDEX_TOKEN;
}

export function makeRunId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}


export function escapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function highlightMarkdown(text, query) {
  const source = normalizeSpace(text);
  if (!source) return "";

  const phrases = [normalizeSpace(query), ...tokenize(query)]
    .filter(Boolean)
    .filter(v => v.length >= 2)
    .sort((a, b) => b.length - a.length);

  if (!phrases.length) return source;

  const pattern = phrases.map(escapeRegExp).join("|");
  return source.replace(new RegExp(`(${pattern})`, "gi"), "**$1**");
}
