import {
  BROADCOM_INDEX_PATH,
  BROADCOM_TITLE_STATE_PATH,
  BROADCOM_TITLE_PLAN_PATH,
  BROADCOM_TITLE_CHUNK_PREFIX
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
    10,
    500,
    100
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
        if (!isLikelyEnglishUrl(item.url)) {
          skippedNonEnglish += 1;
          return null;
        }

        // If the URL slug is already clean English, use it without fetching.
        const slugTitle = titleFromUrl(item.url);

        if (
          slugTitle &&
          isEnglishTitle(slugTitle)
        ) {
          englishPages += 1;
          return {
            articleId: parseArticleId(item.url),
            title: slugTitle,
            url: item.url,
            sourceLastmod: item.lastmod || null,
            language: "en",
            checkedAt: new Date().toISOString()
          };
        }

        try {
          const html = await fetchText(item.url);
          const title = extractTitle(html);

          if (!title || !isEnglishTitle(title)) {
            skippedNonEnglish += 1;
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

function isLikelyEnglishUrl(url) {
  try {
    let path =
      decodeURIComponent(
        new URL(url).pathname
      );

    return !containsLocalizedScript(path);
  } catch {
    return false;
  }
}

function isEnglishTitle(title) {
  const text = decodeXml(
    String(title || "")
  )
    .normalize("NFKC")
    .trim();

  if (!text) return false;

  if (
    /%[0-9A-Fa-f]{2}/.test(text)
  ) {
    return false;
  }

  return !containsLocalizedScript(text);
}

function containsLocalizedScript(text) {
  return /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\u0400-\u04ff]/u.test(
    String(text || "")
  );
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
