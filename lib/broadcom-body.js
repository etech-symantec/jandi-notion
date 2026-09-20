import {
  BROADCOM_INDEX_PATH,
  BROADCOM_BODY_STATE_PATH,
  BROADCOM_BODY_MANIFEST_PATH,
  BROADCOM_BODY_CHUNK_PREFIX,
  normalizeForSearch
} from "./common.js";

import {
  readJsonBlob,
  writeJsonBlob,
  readGzipJsonBlob,
  writeGzipJsonBlob
} from "./blob.js";

const BLOOM_BYTES = 8192;
const BLOOM_BITS = BLOOM_BYTES * 8;

export function bodyChunkPath(chunkNo) {
  return `${BROADCOM_BODY_CHUNK_PREFIX}/chunk-${String(chunkNo).padStart(5, "0")}.json.gz`;
}

export async function readBodyState() {
  return safeReadJson(BROADCOM_BODY_STATE_PATH);
}

export async function readBodyManifest() {
  return safeReadJson(BROADCOM_BODY_MANIFEST_PATH);
}

export async function readTitleIndex() {
  return safeReadJson(BROADCOM_INDEX_PATH);
}


export async function resetBodyIndexStorage() {
  const now = new Date().toISOString();

  // Old physical chunk blobs may remain in storage, but this brand-new
  // manifest has no references to them, so they are no longer searchable
  // or reused by the new rebuild.
  await writeJsonBlob(
    BROADCOM_BODY_MANIFEST_PATH,
    {
      version: 2,
      titleIndexPages: 0,
      indexedPages: 0,
      chunkSize: envInt(
        "BROADCOM_BODY_CHUNK_SIZE",
        50,
        1000,
        250
      ),
      chunks: {},
      createdAt: now,
      updatedAt: now,
      resetAt: now
    }
  );

  await writeJsonBlob(
    BROADCOM_BODY_STATE_PATH,
    {
      version: 3,
      status: "waiting_for_title",
      titleIndexCreatedAt: null,
      titleIndexPages: 0,
      totalPages: 0,
      processedPages: 0,
      fetchedPages: 0,
      reusedPages: 0,
      skippedNonEnglish: 0,
      failedPages: 0,
      bodyIndexedPages: 0,
      fetchBatchSize: envInt(
        "BROADCOM_BODY_FETCH_BATCH",
        1,
        100,
        50
      ),
      chunkSize: envInt(
        "BROADCOM_BODY_CHUNK_SIZE",
        50,
        1000,
        250
      ),
      progress: 0,
      resetAt: now,
      updatedAt: now
    }
  );

  return {
    ok: true,
    status: "waiting_for_title",
    resetAt: now
  };
}

export async function startBodyIndex(force = false) {
  const current = await readBodyState();

  if (
    !force &&
    current &&
    ["running", "paused"].includes(current.status)
  ) {
    return {
      alreadyRunning: true,
      state: current
    };
  }

  const titleIndex = await readTitleIndex();

  if (!titleIndex?.records?.length) {
    throw new Error(
      "Broadcom title index is missing. Keep the existing broadcom-index.json title index."
    );
  }

  const totalPages = Math.min(
    titleIndex.records.length,
    envInt("BROADCOM_BODY_MAX_PAGES", 1, 300000, 250000)
  );

  const oldManifest = force
    ? null
    : await readBodyManifest();

  // A forced body rebuild starts with a completely empty manifest.
  if (force) {
    const now = new Date().toISOString();

    await writeJsonBlob(
      BROADCOM_BODY_MANIFEST_PATH,
      {
        version: 2,
        titleIndexPages: titleIndex.records.length,
        indexedPages: 0,
        chunkSize: envInt(
          "BROADCOM_BODY_CHUNK_SIZE",
          50,
          1000,
          250
        ),
        chunks: {},
        createdAt: now,
        updatedAt: now,
        resetAt: now
      }
    );
  }

  const state = {
    version: 2,
    status: "running",
    titleIndexCreatedAt: titleIndex.createdAt || null,
    titleIndexPages: titleIndex.records.length,
    totalPages,
    processedPages: 0,
    fetchedPages: 0,
    reusedPages: 0,
    skippedNonEnglish: 0,
    failedPages: 0,
    bodyIndexedPages: oldManifest?.indexedPages || 0,
    fetchBatchSize: envInt("BROADCOM_BODY_FETCH_BATCH", 1, 100, 50),
    chunkSize: envInt("BROADCOM_BODY_CHUNK_SIZE", 50, 1000, 250),
    progress: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await writeJsonBlob(BROADCOM_BODY_STATE_PATH, state);

  if (!oldManifest) {
    await writeJsonBlob(BROADCOM_BODY_MANIFEST_PATH, {
      version: 1,
      titleIndexPages: titleIndex.records.length,
      indexedPages: 0,
      chunkSize: state.chunkSize,
      chunks: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  return {
    alreadyRunning: false,
    state
  };
}

export async function processNextBodyBatch(log = () => {}) {
  const state = await readBodyState();

  if (!state) {
    throw new Error("Broadcom body state not found.");
  }

  if (state.status !== "running") {
    return {
      skipped: true,
      state
    };
  }

  const titleIndex = await readTitleIndex();

  if (!titleIndex?.records?.length) {
    throw new Error("Broadcom title index missing.");
  }

  const manifest =
    (await readBodyManifest()) || {
      version: 1,
      titleIndexPages: titleIndex.records.length,
      indexedPages: 0,
      chunkSize: state.chunkSize,
      chunks: {}
    };

  const start = state.processedPages;
  const maxFetch = envInt(
    "BROADCOM_BODY_FETCH_BATCH",
    1,
    100,
    state.fetchBatchSize || 50
  );

  const end = Math.min(
    start + maxFetch,
    state.totalPages
  );

  const slice = titleIndex.records.slice(start, end);

  const concurrency = envInt(
    "BROADCOM_BODY_CONCURRENCY",
    1,
    10,
    5
  );

  const updatesByChunk = new Map();

  let fetched = 0;
  let reused = 0;
  let skippedNonEnglish = 0;
  let failed = 0;

  for (let i = 0; i < slice.length; i += concurrency) {
    const group = slice.slice(i, i + concurrency);

    const results = await Promise.all(
      group.map(async (titleItem, offset) => {
        const globalIndex = start + i + offset;
        const chunkNo = Math.floor(globalIndex / state.chunkSize) + 1;

        if (!isLikelyEnglishTitleRecord(titleItem)) {
          skippedNonEnglish += 1;
          return {
            chunkNo,
            globalIndex,
            record: null,
            removeUrl: titleItem.url
          };
        }

        const existing = await findExistingBodyRecord(
          manifest,
          chunkNo,
          titleItem.url
        );

        const refreshDays = envInt(
          "BROADCOM_BODY_REFRESH_AGE_DAYS",
          1,
          365,
          30
        );

        if (
          existing &&
          existing.checkedAt &&
          Date.now() - Date.parse(existing.checkedAt) <
            refreshDays * 86400000 &&
          existing.title === titleItem.title
        ) {
          reused += 1;
          return {
            chunkNo,
            globalIndex,
            record: existing
          };
        }

        try {
          const html = await fetchText(titleItem.url);
          const parsed = extractArticle(html, titleItem.url, titleItem.title);

          fetched += 1;

          if (
            !isEnglishPage(
              parsed.title,
              parsed.text,
              titleItem.url
            )
          ) {
            skippedNonEnglish += 1;
            return {
              chunkNo,
              globalIndex,
              record: null,
              removeUrl: titleItem.url
            };
          }

          return {
            chunkNo,
            globalIndex,
            record: {
              articleId:
                titleItem.articleId ||
                parseArticleId(titleItem.url),
              title: parsed.title,
              text: trimBody(parsed.text),
              url: titleItem.url,
              checkedAt: new Date().toISOString(),
              language: "en"
            }
          };
        } catch (error) {
          failed += 1;
          log("BODY_FETCH_FAILED", {
            url: titleItem.url,
            error: error?.message || String(error)
          });

          if (existing) {
            return {
              chunkNo,
              globalIndex,
              record: existing
            };
          }

          return {
            chunkNo,
            globalIndex,
            record: null
          };
        }
      })
    );

    for (const result of results) {
      if (!updatesByChunk.has(result.chunkNo)) {
        updatesByChunk.set(result.chunkNo, []);
      }

      updatesByChunk.get(result.chunkNo).push(result);
    }
  }

  for (const [chunkNo, updates] of updatesByChunk.entries()) {
    const path = bodyChunkPath(chunkNo);

    let chunk;
    try {
      chunk = await readGzipJsonBlob(path, false);
    } catch {
      chunk = null;
    }

    if (!chunk) {
      chunk = {
        version: 1,
        chunkNo,
        records: [],
        updatedAt: null
      };
    }

    const byUrl = new Map(
      (chunk.records || []).map(v => [v.url, v])
    );

    for (const update of updates) {
      if (update.removeUrl) {
        byUrl.delete(update.removeUrl);
      } else if (update.record) {
        byUrl.set(update.record.url, update.record);
      }
    }

    const records = [...byUrl.values()];
    const bloom = buildBloom(records);

    chunk = {
      version: 1,
      chunkNo,
      records,
      updatedAt: new Date().toISOString()
    };

    await writeGzipJsonBlob(path, chunk);

    manifest.chunks[String(chunkNo)] = {
      path,
      count: records.length,
      bloom,
      updatedAt: chunk.updatedAt
    };
  }

  state.processedPages = end;
  state.fetchedPages += fetched;
  state.reusedPages += reused;
  state.skippedNonEnglish += skippedNonEnglish;
  state.failedPages += failed;
  state.bodyIndexedPages = Object.values(manifest.chunks)
    .reduce((sum, v) => sum + Number(v.count || 0), 0);
  state.progress = state.totalPages
    ? Math.round((end / state.totalPages) * 1000) / 10
    : 100;
  state.updatedAt = new Date().toISOString();

  manifest.titleIndexPages = titleIndex.records.length;
  manifest.indexedPages = state.bodyIndexedPages;
  manifest.chunkSize = state.chunkSize;
  manifest.updatedAt = new Date().toISOString();

  if (end >= state.totalPages) {
    state.status = "completed";
    state.progress = 100;
    state.completedAt = new Date().toISOString();
  }

  await writeJsonBlob(BROADCOM_BODY_MANIFEST_PATH, manifest);
  await writeJsonBlob(BROADCOM_BODY_STATE_PATH, state);

  return {
    skipped: false,
    batch: {
      start,
      end,
      count: slice.length,
      fetched,
      reused,
      skippedNonEnglish,
      failed,
      chunksTouched: updatesByChunk.size
    },
    state
  };
}

export async function searchBroadcomBodies(
  manifest,
  query,
  parsedBoolean
) {
  if (!manifest?.chunks) return [];

  const groups = queryGroups(query, parsedBoolean);
  const candidateChunkNos = [];

  for (const [chunkNo, meta] of Object.entries(manifest.chunks)) {
    if (!meta?.bloom) continue;

    if (bloomMayMatch(meta.bloom, groups)) {
      candidateChunkNos.push(Number(chunkNo));
    }
  }

  candidateChunkNos.sort((a, b) => a - b);

  const maxChunks = envInt(
    "BROADCOM_BODY_SEARCH_MAX_CHUNKS",
    1,
    200,
    40
  );

  const selected = candidateChunkNos.slice(0, maxChunks);

  const results = [];
  const concurrency = 4;

  for (let i = 0; i < selected.length; i += concurrency) {
    const group = selected.slice(i, i + concurrency);

    const chunks = await Promise.all(
      group.map(async chunkNo => {
        try {
          return await readGzipJsonBlob(
            bodyChunkPath(chunkNo),
            true
          );
        } catch {
          return null;
        }
      })
    );

    for (const chunk of chunks) {
      for (const record of chunk?.records || []) {
        const hit = matchBodyRecord(
          record,
          query,
          parsedBoolean
        );

        if (hit) results.push(hit);
      }
    }
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.title).localeCompare(
      String(b.title),
      "en",
      { sensitivity: "base" }
    );
  });

  return results;
}

export function mergeTitleAndBodyResults(
  titleResults,
  bodyResults
) {
  const map = new Map();

  for (const item of titleResults || []) {
    map.set(item.url, { ...item });
  }

  for (const item of bodyResults || []) {
    const current = map.get(item.url);

    if (!current) {
      map.set(item.url, { ...item });
      continue;
    }

    map.set(item.url, {
      ...current,
      bodyMatch: current.bodyMatch || item.bodyMatch,
      snippet: item.snippet || current.snippet || "",
      score: Math.max(current.score || 0, item.score || 0) +
        (item.bodyMatch ? 250 : 0)
    });
  }

  return [...map.values()].sort((a, b) => {
    if ((b.score || 0) !== (a.score || 0)) {
      return (b.score || 0) - (a.score || 0);
    }

    return String(a.title).localeCompare(
      String(b.title),
      "en",
      { sensitivity: "base" }
    );
  });
}

async function findExistingBodyRecord(
  manifest,
  chunkNo,
  url
) {
  const meta = manifest?.chunks?.[String(chunkNo)];
  if (!meta?.path) return null;

  try {
    const chunk = await readGzipJsonBlob(
      meta.path,
      false
    );

    return (chunk?.records || [])
      .find(v => v.url === url) || null;
  } catch {
    return null;
  }
}

function buildBloom(records) {
  const bytes = Buffer.alloc(BLOOM_BYTES);

  for (const record of records || []) {
    const tokens = extractTokens(
      `${record.title || ""} ${record.text || ""}`
    );

    for (const token of tokens) {
      for (const pos of bloomPositions(token)) {
        bytes[pos >> 3] |= 1 << (pos & 7);
      }
    }
  }

  return bytes.toString("base64");
}

function bloomMayMatch(base64, groups) {
  const bytes = Buffer.from(base64, "base64");

  for (const group of groups) {
    let all = true;

    for (const term of group) {
      const tokens = extractTokens(term);

      for (const token of tokens) {
        if (!bloomHas(bytes, token)) {
          all = false;
          break;
        }
      }

      if (!all) break;
    }

    if (all) return true;
  }

  return false;
}

function bloomHas(bytes, token) {
  for (const pos of bloomPositions(token)) {
    if ((bytes[pos >> 3] & (1 << (pos & 7))) === 0) {
      return false;
    }
  }

  return true;
}

function bloomPositions(token) {
  const a = hash32(token, 2166136261);
  const b = hash32(token, 0x9e3779b9) | 1;

  return [
    a % BLOOM_BITS,
    (a + b) % BLOOM_BITS,
    (a + 2 * b) % BLOOM_BITS,
    (a + 3 * b) % BLOOM_BITS
  ];
}

function hash32(text, seed) {
  let h = seed >>> 0;

  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return h >>> 0;
}

function extractTokens(text) {
  return [...new Set(
    normalizeForSearch(text)
      .split(/[^a-z0-9._+-]+/i)
      .map(v => v.trim())
      .filter(v => v.length >= 2 && v.length <= 64)
      .slice(0, 3000)
  )];
}

function queryGroups(query, parsedBoolean) {
  if (parsedBoolean?.hasOperators) {
    return parsedBoolean.groups
      .map(group => group.filter(Boolean))
      .filter(group => group.length);
  }

  return [[String(query || "").trim()]];
}

function matchBodyRecord(
  record,
  query,
  parsedBoolean
) {
  const titleNorm = normalizeForSearch(record.title);
  const bodyNorm = normalizeForSearch(record.text);
  const whole = `${titleNorm}\n${bodyNorm}`;

  let matched = false;
  let score = 0;
  let snippetTerm = "";

  if (parsedBoolean?.hasOperators) {
    for (const group of parsedBoolean.groups || []) {
      const terms = group
        .map(v => ({
          raw: v,
          norm: normalizeForSearch(v)
        }))
        .filter(v => v.norm);

      if (
        terms.length &&
        terms.every(v => whole.includes(v.norm))
      ) {
        matched = true;

        for (const term of terms) {
          if (bodyNorm.includes(term.norm)) {
            score += 900;
            if (!snippetTerm) snippetTerm = term.raw;
          }

          if (titleNorm.includes(term.norm)) {
            score += 500;
          }
        }

        score += terms.length * 300;
        break;
      }
    }
  } else {
    const q = normalizeForSearch(query);

    // v4.12: 일반 검색은 전체 입력 phrase가 연속으로 존재할 때만 매치.
    if (bodyNorm.includes(q)) {
      matched = true;
      score += 1600;
      snippetTerm = query;
    }
  }

  if (!matched) return null;

  return {
    id: `broadcom-body-${record.articleId || record.url}`,
    title: record.title,
    url: record.url,
    lastEdited: record.checkedAt || "",
    titleMatch: false,
    bodyMatch: true,
    snippet: makeSnippet(
      record.text,
      snippetTerm || query
    ),
    score,
    source: "Broadcom",
    articleId: record.articleId || ""
  };
}

function makeSnippet(text, query) {
  const source = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!source) return "";

  const norm = normalizeForSearch(source);
  const q = normalizeForSearch(query);
  const pos = q ? norm.indexOf(q) : -1;

  if (pos < 0) {
    return source.slice(0, 260);
  }

  const start = Math.max(0, pos - 100);
  const end = Math.min(
    source.length,
    pos + Math.max(q.length, 1) + 180
  );

  return `${start > 0 ? "…" : ""}${source.slice(start, end)}${end < source.length ? "…" : ""}`;
}

function isLikelyEnglishTitleRecord(item) {
  const title = decodeText(item?.title || "");

  if (!title || /%[0-9a-f]{2}/i.test(title)) {
    return false;
  }

  return !containsLocalizedScript(title);
}

function isEnglishPage(title, body, url) {
  let path = "";

  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    path = String(url || "");
  }

  if (containsLocalizedScript(path)) return false;

  const cleanTitle = decodeText(title);
  const sample = decodeText(body).slice(0, 8000);

  if (containsLocalizedScript(cleanTitle)) {
    return false;
  }

  const latin =
    (sample.match(/[A-Za-z]/g) || []).length;

  const localized =
    (sample.match(
      /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\u0400-\u04ff]/gu
    ) || []).length;

  const letters = latin + localized;

  if (letters === 0) return true;

  const ratio = localized / letters;

  if (localized >= 12 && ratio >= 0.08) {
    return false;
  }

  if (letters >= 80 && latin / letters < 0.85) {
    return false;
  }

  return true;
}

function containsLocalizedScript(text) {
  return /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\u0400-\u04ff]/u.test(
    String(text || "")
  );
}

function extractArticle(html, url, fallbackTitle) {
  const source = String(html || "");

  const title =
    extractTitle(source) ||
    fallbackTitle ||
    `Broadcom KB ${parseArticleId(url)}`;

  const text = extractBody(source);

  return {
    title: decodeText(title),
    text: decodeText(text)
  };
}

function extractTitle(html) {
  for (const re of [
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<h2[^>]*>([\s\S]*?)<\/h2>/i,
    /<h3[^>]*>([\s\S]*?)<\/h3>/i
  ]) {
    const m = html.match(re);
    const text = m ? stripTags(m[1]) : "";

    if (
      text &&
      !/^support portal$/i.test(text) &&
      !/^knowledge base$/i.test(text)
    ) {
      return text;
    }
  }

  return (
    html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
    )?.[1] ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
    ""
  );
}

function extractBody(html) {
  let source = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ");

  const candidates = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]+class=["'][^"']*(?:article|knowledge|content|body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  ];

  for (const re of candidates) {
    const m = source.match(re);

    if (m) {
      const text = stripTags(m[1]);
      if (text.length >= 200) return text;
    }
  }

  return stripTags(source);
}

function trimBody(text) {
  const maxChars = envInt(
    "BROADCOM_BODY_MAX_CHARS",
    1000,
    20000,
    4000
  );

  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function stripTags(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function decodeText(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function parseArticleId(url) {
  return String(url || "")
    .match(/\/external\/article\/(\d+)/i)?.[1] || "";
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; JandiNotionBroadcomBody/4.6)"
    },
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

async function safeReadJson(path) {
  try {
    return await readJsonBlob(path, true);
  } catch {
    return null;
  }
}

function envInt(name, min, max, fallback) {
  const value = Number(process.env[name]);

  if (!Number.isFinite(value)) return fallback;

  return Math.max(
    min,
    Math.min(max, Math.floor(value))
  );
}
