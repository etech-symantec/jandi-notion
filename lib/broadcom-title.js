import {
  BROADCOM_INDEX_PATH,
  BROADCOM_TITLE_STATE_PATH,
  BROADCOM_TITLE_PLAN_PATH,
  BROADCOM_TITLE_CHUNK_PREFIX,
  BROADCOM_DAILY_STATE_PATH,
  BROADCOM_DAILY_PLAN_PATH
} from "./common.js";

import {
  readJsonBlob,
  writeJsonBlob
} from "./blob.js";

const BASE = "https://knowledge.broadcom.com";

const SITEMAP_CANDIDATES = [
  `${BASE}/sitemap.xml`,
  `${BASE}/sitemap_index.xml`,
  `${BASE}/sitemap-index.xml`
];

export function titleChunkPath(chunkNo) {
  return `${BROADCOM_TITLE_CHUNK_PREFIX}/chunk-${String(chunkNo).padStart(5, "0")}.json`;
}

export async function readTitleState() {
  return safeReadJson(BROADCOM_TITLE_STATE_PATH);
}

export async function readFinalTitleIndex() {
  return safeReadJson(BROADCOM_INDEX_PATH);
}

export async function startFreshTitleRebuild(force = false, log = () => {}) {
  const current = await readTitleState();

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

  const urls = await collectAllArticleUrls(log);

  const maxPages = envInt(
    "BROADCOM_TITLE_MAX_PAGES",
    1,
    300000,
    250000
  );

  const selected = urls.slice(0, maxPages);

  await writeJsonBlob(
    BROADCOM_TITLE_PLAN_PATH,
    {
      version: 1,
      createdAt: new Date().toISOString(),
      totalPages: selected.length,
      items: selected
    }
  );

  const state = {
    version: 1,
    status: "running",
    totalPages: selected.length,
    processedPages: 0,
    englishPages: 0,
    skippedNonEnglish: 0,
    failedPages: 0,
    chunkCount: 0,
    batchSize: envInt(
      "BROADCOM_TITLE_BATCH_SIZE",
      10,
      500,
      200
    ),
    progress: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await writeJsonBlob(
    BROADCOM_TITLE_STATE_PATH,
    state
  );

  return {
    alreadyRunning: false,
    state
  };
}

export async function processNextTitleBatch(log = () => {}) {
  const state = await readTitleState();

  if (!state) {
    throw new Error("Broadcom title state not found.");
  }

  if (state.status !== "running") {
    return {
      skipped: true,
      state
    };
  }

  const plan = await readJsonBlob(
    BROADCOM_TITLE_PLAN_PATH,
    false
  );

  if (!plan?.items?.length) {
    throw new Error("Broadcom title plan is missing.");
  }

  const start = state.processedPages;
  const batchSize = envInt(
    "BROADCOM_TITLE_RUNTIME_BATCH_SIZE",
    5,
    100,
    20
  );

  const end = Math.min(
    start + batchSize,
    state.totalPages
  );

  const items = plan.items.slice(start, end);
  const concurrency = envInt(
    "BROADCOM_TITLE_CONCURRENCY",
    1,
    10,
    5
  );

  const records = [];
  let englishPages = 0;
  let skippedNonEnglish = 0;
  let failedPages = 0;

  for (let i = 0; i < items.length; i += concurrency) {
    const group = items.slice(i, i + concurrency);

    const results = await Promise.all(
      group.map(async item => {
        try {
          // v4.9: NEVER trust URL slug or <html lang>.
          // Always fetch the actual Broadcom page.
          const html = await fetchText(item.url);

          const title = extractTitle(html);
          const bodySample = extractBodySample(html);

          if (
            !title ||
            !isActualEnglishPage(
              title,
              bodySample,
              item.url
            )
          ) {
            skippedNonEnglish += 1;

            log("TITLE_NON_ENGLISH_SKIPPED", {
              url: item.url,
              title: title || ""
            });

            return null;
          }

          englishPages += 1;

          return {
            articleId: parseArticleId(item.url),
            title,
            url: item.url,
            sourceLastmod: item.lastmod || null,
            language: "en",
            checkedAt: new Date().toISOString()
          };
        } catch (error) {
          failedPages += 1;

          log("TITLE_FETCH_FAILED", {
            url: item.url,
            error: error?.message || String(error)
          });

          return null;
        }
      })
    );

    records.push(...results.filter(Boolean));
  }

  const chunkNo = state.chunkCount + 1;

  await writeJsonBlob(
    titleChunkPath(chunkNo),
    {
      version: 1,
      chunkNo,
      start,
      end,
      records,
      createdAt: new Date().toISOString()
    }
  );

  state.processedPages = end;
  state.englishPages += englishPages;
  state.skippedNonEnglish += skippedNonEnglish;
  state.failedPages += failedPages;
  state.chunkCount = chunkNo;
  state.progress = state.totalPages
    ? Math.round((end / state.totalPages) * 1000) / 10
    : 100;
  state.updatedAt = new Date().toISOString();

  if (end >= state.totalPages) {
    const finalIndex = await finalizeTitleIndex(
      state,
      log
    );

    state.status = "completed";
    state.progress = 100;
    state.completedAt = new Date().toISOString();
    state.finalPageCount = finalIndex.pageCount;
  }

  await writeJsonBlob(
    BROADCOM_TITLE_STATE_PATH,
    state
  );

  return {
    skipped: false,
    batch: {
      start,
      end,
      count: items.length,
      englishPages,
      skippedNonEnglish,
      failedPages,
      chunkNo
    },
    state
  };
}

async function finalizeTitleIndex(state, log) {
  const all = [];

  for (let i = 1; i <= state.chunkCount; i++) {
    const chunk = await readJsonBlob(
      titleChunkPath(i),
      false
    );

    if (chunk?.records?.length) {
      all.push(...chunk.records);
    }
  }

  const byUrl = new Map();

  for (const record of all) {
    if (!record?.url) continue;
    if (!isEnglishTitle(record.title)) continue;
    byUrl.set(record.url, record);
  }

  const records = [...byUrl.values()].sort(
    (a, b) =>
      String(a.title).localeCompare(
        String(b.title),
        "en",
        { sensitivity: "base" }
      )
  );

  const finalIndex = {
    version: 4,
    source: "Broadcom Knowledge",
    language: "en",
    createdAt: new Date().toISOString(),
    pageCount: records.length,
    failedCount: state.failedPages,
    records
  };

  await writeJsonBlob(
    BROADCOM_INDEX_PATH,
    finalIndex
  );

  log("TITLE_INDEX_FINALIZED", {
    pageCount: finalIndex.pageCount,
    skippedNonEnglish:
      state.skippedNonEnglish,
    failedCount: finalIndex.failedCount
  });

  return finalIndex;
}

async function collectAllArticleUrls(log) {
  const seenSitemaps = new Set();
  const byUrl = new Map();

  for (const candidate of SITEMAP_CANDIDATES) {
    try {
      const xml = await fetchText(candidate);

      await collectSitemap(
        candidate,
        xml,
        seenSitemaps,
        byUrl,
        log,
        0
      );

      if (byUrl.size > 0) break;
    } catch (error) {
      log("SITEMAP_ROOT_FAILED", {
        url: candidate,
        error: error?.message || String(error)
      });
    }
  }

  if (!byUrl.size) {
    throw new Error("Broadcom sitemap에서 article URL을 찾지 못했습니다.");
  }

  return [...byUrl.values()];
}

async function collectSitemap(
  url,
  xml,
  seen,
  byUrl,
  log,
  depth
) {
  if (depth > 4 || seen.has(url)) return;
  seen.add(url);

  const urlBlocks = [
    ...String(xml || "").matchAll(
      /<url>([\s\S]*?)<\/url>/gi
    )
  ];

  for (const match of urlBlocks) {
    const block = match[1];
    const loc =
      block.match(
        /<loc>\s*([^<]+?)\s*<\/loc>/i
      )?.[1];

    if (!loc) continue;

    const decoded = decodeXml(loc.trim());
    const article = canonicalArticleUrl(decoded);

    if (!article) continue;

    const lastmod =
      block.match(
        /<lastmod>\s*([^<]+?)\s*<\/lastmod>/i
      )?.[1]?.trim() || null;

    byUrl.set(article, {
      url: article,
      lastmod
    });
  }

  const sitemapLocs = [
    ...String(xml || "").matchAll(
      /<sitemap>([\s\S]*?)<\/sitemap>/gi
    )
  ]
    .map(match =>
      match[1]
        .match(
          /<loc>\s*([^<]+?)\s*<\/loc>/i
        )?.[1]
    )
    .filter(Boolean)
    .map(v => decodeXml(v.trim()));

  if (!urlBlocks.length && !sitemapLocs.length) {
    const locs = [
      ...String(xml || "").matchAll(
        /<loc>\s*([^<]+?)\s*<\/loc>/gi
      )
    ].map(m => decodeXml(m[1].trim()));

    for (const loc of locs) {
      const article = canonicalArticleUrl(loc);

      if (article) {
        byUrl.set(article, {
          url: article,
          lastmod: null
        });
      } else if (
        /sitemap/i.test(loc) &&
        /\.xml(?:$|\?)/i.test(loc)
      ) {
        sitemapLocs.push(loc);
      }
    }
  }

  log("SITEMAP_PARSED", {
    url,
    depth,
    articleTotal: byUrl.size,
    nestedSitemaps: sitemapLocs.length
  });

  for (const nested of sitemapLocs) {
    if (seen.has(nested)) continue;

    try {
      const child = await fetchText(nested);

      await collectSitemap(
        nested,
        child,
        seen,
        byUrl,
        log,
        depth + 1
      );
    } catch (error) {
      log("SITEMAP_CHILD_FAILED", {
        url: nested,
        error: error?.message || String(error)
      });
    }
  }
}

function canonicalArticleUrl(input) {
  try {
    const u = new URL(input);

    if (
      u.hostname !==
      "knowledge.broadcom.com"
    ) {
      return null;
    }

    if (
      u.pathname.startsWith(
        "/external/article/"
      )
    ) {
      return `${u.origin}${u.pathname}`;
    }

    if (
      u.pathname === "/external/article"
    ) {
      const id =
        u.searchParams.get("articleId") ||
        u.searchParams.get(
          "articleNumber"
        );

      if (id && /^\d+$/.test(id)) {
        return `${u.origin}/external/article/${id}`;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function titleFromUrl(url) {
  try {
    const u = new URL(url);

    const m = u.pathname.match(
      /^\/external\/article\/\d+\/([^/?#]+)/i
    );

    if (!m) return "";

    let slug = m[1];

    try {
      slug = decodeURIComponent(slug);
    } catch {}

    const title = slug
      .replace(/\.html?$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!title) return "";

    return title.charAt(0).toUpperCase() +
      title.slice(1);
  } catch {
    return "";
  }
}

function isActualEnglishPage(title, bodySample, url) {
  const cleanTitle = cleanText(title);
  const cleanBody = cleanText(bodySample).slice(0, 8000);

  if (!cleanTitle) {
    return false;
  }

  // Broken percent-encoded title should never enter the final index.
  if (/%[0-9A-Fa-f]{2}/.test(cleanTitle)) {
    return false;
  }

  // Actual visible title is the strongest signal.
  // Any localized script in the title means this is not an English article.
  if (containsLocalizedScript(cleanTitle)) {
    return false;
  }

  // URL is only a negative hint now, never a positive proof.
  try {
    const path = decodeURIComponent(
      new URL(url).pathname
    );

    if (containsLocalizedScript(path)) {
      return false;
    }
  } catch {}

  // Inspect actual article content because Broadcom localized pages may
  // incorrectly declare <html lang="en">.
  return hasEnglishDominantContent(
    `${cleanTitle}\n${cleanBody}`
  );
}

function isEnglishTitle(title) {
  const text = cleanText(title);

  if (!text) return false;

  if (/%[0-9A-Fa-f]{2}/.test(text)) {
    return false;
  }

  return !containsLocalizedScript(text);
}

function hasEnglishDominantContent(text) {
  const sample = String(text || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .slice(0, 8000);

  if (!sample.trim()) {
    return true;
  }

  const latin =
    (sample.match(/[A-Za-z]/g) || []).length;

  const japanese =
    (sample.match(
      /[\u3040-\u30ff\u31f0-\u31ff]/gu
    ) || []).length;

  const cjk =
    (sample.match(
      /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu
    ) || []).length;

  const korean =
    (sample.match(
      /[\uac00-\ud7af]/gu
    ) || []).length;

  const cyrillic =
    (sample.match(
      /[\u0400-\u04ff]/gu
    ) || []).length;

  const localized =
    japanese + cjk + korean + cyrillic;

  const letters = latin + localized;

  if (letters === 0) {
    return true;
  }

  const localizedRatio =
    localized / letters;

  const latinRatio =
    latin / letters;

  // Clearly localized article.
  if (
    localized >= 12 &&
    localizedRatio >= 0.08
  ) {
    return false;
  }

  // Smaller sample but localized text dominates.
  if (
    localized >= 5 &&
    localizedRatio >= 0.20
  ) {
    return false;
  }

  // For a meaningful sample, English/Latin must dominate.
  if (
    letters >= 80 &&
    latinRatio < 0.85
  ) {
    return false;
  }

  return true;
}

function containsLocalizedScript(text) {
  return /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\u0400-\u04ff]/u.test(
    String(text || "")
  );
}

function extractBodySample(html) {
  let source = String(html || "")
    .replace(
      /<script[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(
      /<style[\s\S]*?<\/style>/gi,
      " "
    )
    .replace(
      /<noscript[\s\S]*?<\/noscript>/gi,
      " "
    )
    .replace(
      /<svg[\s\S]*?<\/svg>/gi,
      " "
    )
    .replace(
      /<header[\s\S]*?<\/header>/gi,
      " "
    )
    .replace(
      /<footer[\s\S]*?<\/footer>/gi,
      " "
    )
    .replace(
      /<nav[\s\S]*?<\/nav>/gi,
      " "
    );

  const candidates = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]+class=["'][^"']*(?:article|knowledge|content|body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  ];

  for (const re of candidates) {
    const match = source.match(re);

    if (match) {
      const value = cleanText(match[1]);

      if (value.length >= 200) {
        return value.slice(0, 8000);
      }
    }
  }

  return cleanText(source).slice(0, 8000);
}

function extractTitle(html) {
  const source = String(html || "");

  for (const re of [
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<h2[^>]*>([\s\S]*?)<\/h2>/i,
    /<h3[^>]*>([\s\S]*?)<\/h3>/i
  ]) {
    const m = source.match(re);

    if (m) {
      const title = cleanText(m[1]);

      if (
        title &&
        !/^support portal$/i.test(title) &&
        !/^knowledge base$/i.test(title)
      ) {
        return title;
      }
    }
  }

  return cleanText(
    source.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
    )?.[1] ||
    source.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    )?.[1] ||
    ""
  );
}

function cleanText(value) {
  return decodeXml(
    String(value || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  )
    .normalize("NFKC")
    .trim();
}

function decodeXml(v) {
  return String(v || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function parseArticleId(url) {
  return String(url || "")
    .match(
      /\/external\/article\/(\d+)/i
    )?.[1] || "";
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; JandiNotionBroadcomTitle/4.7)"
    },
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}`
    );
  }

  return response.text();
}

async function safeReadJson(path) {
  try {
    return await readJsonBlob(
      path,
      true
    );
  } catch {
    return null;
  }
}

function envInt(name, min, max, fallback) {
  const value = Number(
    process.env[name]
  );

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(
    min,
    Math.min(
      max,
      Math.floor(value)
    )
  );
}


export async function readDailyState() {
  return safeReadJson(BROADCOM_DAILY_STATE_PATH);
}

export async function startDailyIncremental(log = () => {}) {
  const finalIndex = await readFinalTitleIndex();

  if (
    !finalIndex?.records?.length ||
    finalIndex.language !== "en"
  ) {
    return {
      ok: false,
      phase: "idle",
      reason: "Initial English title index is not complete yet."
    };
  }

  const current = await readDailyState();

  if (current?.status === "running") {
    return {
      ok: true,
      phase: "daily",
      resumed: true,
      state: current
    };
  }

  const sitemapItems = await collectAllArticleUrls(log);
  const previousByUrl = new Map(
    finalIndex.records.map(v => [v.url, v])
  );

  const changed = [];

  for (const item of sitemapItems) {
    const prev = previousByUrl.get(item.url);

    if (!prev) {
      changed.push({ ...item, reason: "new" });
      continue;
    }

    if (
      item.lastmod &&
      prev.sourceLastmod &&
      item.lastmod !== prev.sourceLastmod
    ) {
      changed.push({ ...item, reason: "lastmod" });
    }
  }

  const sitemapUrls = new Set(
    sitemapItems.map(v => v.url)
  );

  const removed = finalIndex.records
    .filter(v => !sitemapUrls.has(v.url))
    .map(v => ({
      url: v.url,
      articleId: v.articleId,
      reason: "removed"
    }));

  await writeJsonBlob(
    BROADCOM_DAILY_PLAN_PATH,
    {
      version: 1,
      createdAt: new Date().toISOString(),
      totalChanged: changed.length,
      totalRemoved: removed.length,
      changed,
      removed
    }
  );

  const state = {
    version: 1,
    status:
      changed.length || removed.length
        ? "running"
        : "completed",
    totalChanged: changed.length,
    totalRemoved: removed.length,
    processedChanged: 0,
    processedRemoved: 0,
    englishUpdated: 0,
    skippedNonEnglish: 0,
    failedPages: 0,
    progress:
      changed.length || removed.length
        ? 0
        : 100,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (state.status === "completed") {
    state.completedAt = new Date().toISOString();
  }

  await writeJsonBlob(
    BROADCOM_DAILY_STATE_PATH,
    state
  );

  return {
    ok: true,
    phase:
      state.status === "running"
        ? "daily"
        : "idle",
    resumed: false,
    state
  };
}

export async function processNextDailyIncremental(log = () => {}) {
  const state = await readDailyState();

  if (!state) {
    throw new Error("Broadcom daily state not found.");
  }

  if (state.status !== "running") {
    return {
      ok: true,
      completed: state.status === "completed",
      state
    };
  }

  const plan = await readJsonBlob(
    BROADCOM_DAILY_PLAN_PATH,
    false
  );

  const finalIndex = await readFinalTitleIndex();

  if (!plan || !finalIndex?.records) {
    throw new Error(
      "Broadcom daily plan or final title index is missing."
    );
  }

  const batchSize = envInt(
    "BROADCOM_DAILY_BATCH_SIZE",
    1,
    100,
    20
  );

  const start = state.processedChanged;
  const end = Math.min(
    start + batchSize,
    state.totalChanged
  );

  const items = plan.changed.slice(start, end);
  const concurrency = envInt(
    "BROADCOM_TITLE_CONCURRENCY",
    1,
    10,
    5
  );

  const updates = [];
  let englishUpdated = 0;
  let skippedNonEnglish = 0;
  let failedPages = 0;

  for (let i = 0; i < items.length; i += concurrency) {
    const group = items.slice(i, i + concurrency);

    const results = await Promise.all(
      group.map(async item => {
        try {
          const html = await fetchText(item.url);
          const pageTitle = extractTitle(html);
          const bodySample = extractBodySample(html);

          if (
            !pageTitle ||
            !isActualEnglishPage(
              pageTitle,
              bodySample,
              item.url
            )
          ) {
            skippedNonEnglish += 1;

            return {
              action: "remove",
              url: item.url
            };
          }

          englishUpdated += 1;

          return {
            action: "upsert",
            record: {
              articleId: parseArticleId(item.url),
              title: pageTitle,
              url: item.url,
              sourceLastmod: item.lastmod || null,
              language: "en",
              checkedAt: new Date().toISOString()
            }
          };
        } catch (error) {
          failedPages += 1;

          log("DAILY_FETCH_FAILED", {
            url: item.url,
            error: error?.message || String(error)
          });

          return {
            action: "keep",
            url: item.url
          };
        }
      })
    );

    updates.push(...results.filter(Boolean));
  }

  const byUrl = new Map(
    finalIndex.records.map(v => [v.url, v])
  );

  for (const update of updates) {
    if (update.action === "remove") {
      byUrl.delete(update.url);
    } else if (
      update.action === "upsert" &&
      update.record
    ) {
      byUrl.set(
        update.record.url,
        update.record
      );
    }
  }

  let removedNow = 0;

  if (end >= state.totalChanged) {
    const removeStart = state.processedRemoved;
    const removeEnd = Math.min(
      removeStart + batchSize,
      state.totalRemoved
    );

    for (
      const item of plan.removed.slice(
        removeStart,
        removeEnd
      )
    ) {
      byUrl.delete(item.url);
      removedNow += 1;
    }

    state.processedRemoved = removeEnd;
  }

  const records = [...byUrl.values()]
    .filter(v => isEnglishTitle(v.title))
    .sort(
      (a, b) =>
        String(a.title).localeCompare(
          String(b.title),
          "en",
          { sensitivity: "base" }
        )
    );

  const updatedIndex = {
    ...finalIndex,
    version: 4.1,
    language: "en",
    createdAt: new Date().toISOString(),
    pageCount: records.length,
    records
  };

  await writeJsonBlob(
    BROADCOM_INDEX_PATH,
    updatedIndex
  );

  state.processedChanged = end;
  state.englishUpdated += englishUpdated;
  state.skippedNonEnglish += skippedNonEnglish;
  state.failedPages += failedPages;

  const totalWork =
    state.totalChanged + state.totalRemoved;

  const doneWork =
    state.processedChanged + state.processedRemoved;

  state.progress = totalWork
    ? Math.round((doneWork / totalWork) * 1000) / 10
    : 100;

  state.updatedAt = new Date().toISOString();

  const completed =
    state.processedChanged >= state.totalChanged &&
    state.processedRemoved >= state.totalRemoved;

  if (completed) {
    state.status = "completed";
    state.progress = 100;
    state.completedAt = new Date().toISOString();
  }

  await writeJsonBlob(
    BROADCOM_DAILY_STATE_PATH,
    state
  );

  return {
    ok: true,
    completed,
    batch: {
      changedStart: start,
      changedEnd: end,
      changedCount: items.length,
      englishUpdated,
      skippedNonEnglish,
      failedPages,
      removedNow
    },
    state
  };
}
