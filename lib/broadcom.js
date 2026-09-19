import {
  BROADCOM_INDEX_PATH,
  BROADCOM_STATE_PATH,
  BROADCOM_PLAN_PREFIX,
  normalizeForSearch
} from "./common.js";
import { readJsonBlob, writeJsonBlob } from "./blob.js";

const BASE = "https://knowledge.broadcom.com";
const ARTICLE_PREFIX = `${BASE}/external/article/`;

const SITEMAP_CANDIDATES = [
  `${BASE}/sitemap.xml`,
  `${BASE}/sitemap_index.xml`,
  `${BASE}/sitemap-index.xml`
];

export function broadcomPlanPath(runId) {
  return `${BROADCOM_PLAN_PREFIX}/${runId}/plan.json`;
}

export function broadcomChunkPath(runId, chunkNo) {
  return `${BROADCOM_PLAN_PREFIX}/${runId}/chunk-${String(chunkNo).padStart(4, "0")}.json`;
}

export async function createBroadcomPlan(log = () => {}) {
  const items = await collectArticleItems(log);

  const extras = String(process.env.BROADCOM_EXTRA_URLS || "")
    .split(/[\n,]/)
    .map(v => v.trim())
    .filter(Boolean);

  for (const url of extras) {
    const c = canonicalArticleUrl(url);
    if (c && !items.some(v => v.url === c)) {
      items.push({ url: c, lastmod: null });
    }
  }

  const maxPages = clampEnv("BROADCOM_MAX_PAGES", 1, 50000, 10000);
  return items.slice(0, maxPages);
}

export async function processBroadcomBatch(items, previousIndex, log = () => {}) {
  const previousByUrl = new Map(
    (previousIndex?.records || []).map(v => [v.url, v])
  );

  const concurrency = clampEnv("BROADCOM_CONCURRENCY", 1, 8, 3);
  const records = [];

  let fetched = 0;
  let reused = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i += concurrency) {
    const group = items.slice(i, i + concurrency);

    const results = await Promise.all(
      group.map(async item => {
        const prev = previousByUrl.get(item.url);

        if (
          prev &&
          isEnglishRecord(prev) &&
          item.lastmod &&
          prev.sourceLastmod &&
          item.lastmod === prev.sourceLastmod
        ) {
          reused += 1;
          return prev;
        }

        if (prev && isEnglishRecord(prev) && !item.lastmod) {
          const refreshDays = clampEnv(
            "BROADCOM_REFRESH_AGE_DAYS",
            1,
            365,
            7
          );

          const checked = prev.checkedAt
            ? new Date(prev.checkedAt).getTime()
            : 0;

          if (
            checked &&
            Date.now() - checked < refreshDays * 86400000
          ) {
            reused += 1;
            return prev;
          }
        }

        try {
          const html = await fetchText(item.url);
          const parsed = extractArticle(html, item.url);

          fetched += 1;

          if (!isEnglishPage(html, parsed.title, parsed.text, item.url)) {
            log("NON_ENGLISH_SKIPPED", {
              url: item.url,
              title: parsed.title
            });
            return null;
          }

          return {
            articleId: parsed.articleId,
            title: parsed.title,
            text: parsed.text,
            url: item.url,
            sourceLastmod: item.lastmod || null,
            checkedAt: new Date().toISOString(),
            language: "en"
          };
        } catch (error) {
          failed += 1;

          log("ARTICLE_FAILED", {
            url: item.url,
            error: error?.message || String(error)
          });

          if (prev && isEnglishRecord(prev)) return prev;

          const fallback = articleRecordFromUrl(item.url);

          return {
            articleId: fallback?.articleId || "",
            title: fallback?.title || item.url,
            text: "",
            url: item.url,
            sourceLastmod: item.lastmod || null,
            checkedAt: new Date().toISOString()
          };
        }
      })
    );

    records.push(...results.filter(Boolean));
  }

  return { records, fetched, reused, failed };
}

export async function finalizeBroadcomRun(state, log = () => {}) {
  const records = [];

  for (let i = 1; i <= state.chunkCount; i++) {
    const chunk = await safeReadJson(
      broadcomChunkPath(state.runId, i)
    );

    if (chunk?.records?.length) {
      records.push(...chunk.records);
    }
  }

  const englishRecords = records.filter(isEnglishRecord);

  englishRecords.sort((a, b) =>
    String(a.title).localeCompare(String(b.title), "en", {
      sensitivity: "base"
    })
  );

  const index = {
    version: 3,
    source: "Broadcom Knowledge",
    baseUrl: ARTICLE_PREFIX,
    createdAt: new Date().toISOString(),
    pageCount: englishRecords.length,
    failedCount: state.failedPages || 0,
    fetchedCount: state.fetchedPages || 0,
    reusedCount: state.reusedPages || 0,
    language: "en",
    records: englishRecords
  };

  await writeJsonBlob(BROADCOM_INDEX_PATH, index);

  log("BROADCOM_FINALIZED", {
    pageCount: index.pageCount,
    failedCount: index.failedCount,
    fetchedCount: index.fetchedCount,
    reusedCount: index.reusedCount
  });

  return index;
}

export function searchBroadcomIndex(index, query, parsedBoolean) {
  if (!index?.records?.length) return [];

  const parsed = parsedBoolean || parseBoolean(query);
  const results = [];

  for (const item of index.records) {
    const titleNorm = normalizeForSearch(item.title);
    const bodyNorm = normalizeForSearch(item.text);
    const wholeNorm =
      `${titleNorm}\n${bodyNorm}\n${normalizeForSearch(item.articleId || "")}`;

    let matched = false;
    let score = 0;
    let titleMatch = false;
    let bodyMatch = false;
    let snippetTerm = "";

    if (parsed.hasOperators) {
      for (const group of parsed.groups) {
        const terms = group
          .map(v => ({
            raw: v,
            norm: normalizeForSearch(v)
          }))
          .filter(v => v.norm);

        if (
          terms.length &&
          terms.every(term => wholeNorm.includes(term.norm))
        ) {
          matched = true;

          for (const term of terms) {
            if (titleNorm.includes(term.norm)) {
              titleMatch = true;
              score += 900;
            }

            if (bodyNorm.includes(term.norm)) {
              bodyMatch = true;
              score += 450;
            }

            if (!snippetTerm && bodyNorm.includes(term.norm)) {
              snippetTerm = term.raw;
            }
          }

          score += terms.length * 300;
          break;
        }
      }
    } else {
      const q = normalizeForSearch(query);

      if (!q) continue;

      if (titleNorm.includes(q)) {
        matched = true;
        titleMatch = true;
        score += 2200;
      }

      if (bodyNorm.includes(q)) {
        matched = true;
        bodyMatch = true;
        score += 1200;
        snippetTerm = query;
      }

      if (!matched) {
        const tokens = q.split(/\s+/).filter(v => v.length >= 2);

        let tokenHits = 0;

        for (const token of tokens) {
          if (titleNorm.includes(token)) {
            tokenHits += 1;
            titleMatch = true;
            score += 400;
          } else if (bodyNorm.includes(token)) {
            tokenHits += 1;
            bodyMatch = true;
            score += 150;
          }
        }

        matched = tokenHits > 0;
      }
    }

    if (!matched) continue;

    results.push({
      id: `broadcom-${item.articleId || item.url}`,
      title: item.title,
      url: item.url,
      lastEdited: item.sourceLastmod || item.checkedAt || "",
      titleMatch,
      bodyMatch,
      snippet: bodyMatch
        ? makeSnippet(item.text, snippetTerm || query)
        : "",
      score,
      source: "Broadcom",
      articleId: item.articleId || ""
    });
  }

  return results.sort((a, b) => {
    if ((b.score || 0) !== (a.score || 0)) {
      return (b.score || 0) - (a.score || 0);
    }

    return String(a.title).localeCompare(String(b.title), "en", {
      sensitivity: "base"
    });
  });
}

export async function readBroadcomState() {
  return safeReadJson(BROADCOM_STATE_PATH);
}

export async function readBroadcomIndex() {
  return safeReadJson(BROADCOM_INDEX_PATH);
}

async function collectArticleItems(log) {
  const seenSitemaps = new Set();
  const byUrl = new Map();
  let rootFound = false;

  for (const candidate of SITEMAP_CANDIDATES) {
    try {
      const text = await fetchText(candidate);
      if (!text) continue;

      rootFound = true;

      log("SITEMAP_ROOT", {
        url: candidate,
        bytes: text.length
      });

      await collectFromSitemapXml(
        candidate,
        text,
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

  if (!rootFound && byUrl.size === 0) {
    throw new Error("Broadcom sitemap을 가져오지 못했습니다.");
  }

  return [...byUrl.values()];
}

async function collectFromSitemapXml(
  url,
  xml,
  seenSitemaps,
  byUrl,
  log,
  depth
) {
  if (depth > 3 || seenSitemaps.has(url)) return;

  seenSitemaps.add(url);

  const urlBlocks = [
    ...xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)
  ];

  for (const match of urlBlocks) {
    const block = match[1];

    const loc =
      block.match(/<loc>\s*([^<]+?)\s*<\/loc>/i)?.[1];

    if (!loc) continue;

    const decoded = decodeXml(loc.trim());
    const article = canonicalArticleUrl(decoded);

    if (!article || !isLikelyEnglishUrl(article)) continue;

    const lastmod =
      block.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i)?.[1]?.trim() ||
      null;

    byUrl.set(article, {
      url: article,
      lastmod
    });
  }

  const sitemapLocs = [
    ...xml.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/gi)
  ]
    .map(match =>
      match[1]
        .match(/<loc>\s*([^<]+?)\s*<\/loc>/i)?.[1]
    )
    .filter(Boolean)
    .map(v => decodeXml(v.trim()));

  if (!urlBlocks.length && !sitemapLocs.length) {
    const locs = [
      ...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)
    ].map(m => decodeXml(m[1].trim()));

    for (const loc of locs) {
      const article = canonicalArticleUrl(loc);

      if (article && isLikelyEnglishUrl(article)) {
        byUrl.set(article, { url: article, lastmod: null });
      } else if (/sitemap/i.test(loc) && /\.xml(?:$|\?)/i.test(loc)) {
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
    if (seenSitemaps.has(nested)) continue;

    try {
      const child = await fetchText(nested);

      await collectFromSitemapXml(
        nested,
        child,
        seenSitemaps,
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

function extractArticle(html, url) {
  const fallback = articleRecordFromUrl(url);

  const title = extractArticleTitle(html) ||
    fallback?.title ||
    fallback?.articleId ||
    url;

  const text = extractArticleBody(html);

  return {
    articleId: fallback?.articleId || "",
    title,
    text
  };
}

function extractArticleTitle(html) {
  const source = String(html || "");

  const headingSelectors = [
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<h2[^>]*>([\s\S]*?)<\/h2>/i,
    /<h3[^>]*>([\s\S]*?)<\/h3>/i
  ];

  for (const re of headingSelectors) {
    const m = source.match(re);

    if (m) {
      const text = cleanText(m[1]);

      if (
        text &&
        !/^support portal$/i.test(text) &&
        !/^knowledge base$/i.test(text)
      ) {
        return text;
      }
    }
  }

  const metaTitle =
    source.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
    )?.[1] ||
    source.match(
      /<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["']/i
    )?.[1];

  if (metaTitle) return decodeXml(metaTitle).trim();

  const title =
    source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];

  if (title) {
    return cleanText(title)
      .replace(/\s*-\s*Support Portal.*$/i, "")
      .trim();
  }

  return "";
}

function extractArticleBody(html) {
  let source = String(html || "");

  source = source
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
      const text = cleanText(m[1]);

      if (text.length >= 200) {
        return trimBody(text);
      }
    }
  }

  return trimBody(cleanText(source));
}

function trimBody(text) {
  const maxChars = clampEnv(
    "BROADCOM_MAX_BODY_CHARS",
    1000,
    200000,
    30000
  );

  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function makeSnippet(text, query) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  if (!source) return "";

  const q = normalizeForSearch(query);
  const norm = normalizeForSearch(source);

  const pos = q ? norm.indexOf(q) : -1;
  const radius = 110;

  if (pos < 0) return source.slice(0, 220);

  const start = Math.max(0, pos - radius);
  const end = Math.min(source.length, pos + q.length + radius);

  return `${start > 0 ? "…" : ""}${source.slice(start, end)}${end < source.length ? "…" : ""}`;
}

function canonicalArticleUrl(input) {
  try {
    const u = new URL(input);

    if (u.hostname !== "knowledge.broadcom.com") return null;

    if (u.pathname.startsWith("/external/article/")) {
      return `${u.origin}${u.pathname}`;
    }

    if (u.pathname === "/external/article") {
      const id =
        u.searchParams.get("articleId") ||
        u.searchParams.get("articleNumber");

      if (id && /^\d+$/.test(id)) {
        return `${ARTICLE_PREFIX}${id}`;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function articleRecordFromUrl(url) {
  try {
    const u = new URL(url);

    const m = u.pathname.match(
      /^\/external\/article\/(\d+)(?:\/([^/?#]+))?/i
    );

    if (!m) return null;

    const articleId = m[1];
    const slug = m[2] || "";

    return {
      articleId,
      title: slug
        ? titleFromSlug(slug)
        : `Broadcom KB ${articleId}`,
      url
    };
  } catch {
    return null;
  }
}

function titleFromSlug(slug) {
  let decoded = String(slug || "");
  try {
    decoded = decodeURIComponent(decoded);
  } catch {}

  const s = decoded
    .replace(/\.html?$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!s) return "";

  return s.charAt(0).toUpperCase() + s.slice(1);
}

function cleanText(value) {
  return decodeXml(
    String(value || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
  ).trim();
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


function isLikelyEnglishUrl(url) {
  try {
    const u = new URL(url);
    let path = u.pathname;

    try {
      path = decodeURIComponent(path);
    } catch {}

    // Reject obvious localized slugs before fetching.
    return !containsNonLatinScript(path);
  } catch {
    return false;
  }
}

function isEnglishRecord(record) {
  if (!record) return false;

  const title = String(record.title || "");
  const text = String(record.text || "");

  if (!title) return false;

  if (containsNonLatinScript(title)) return false;

  // Broken percent-encoded CJK/Japanese slug should never become a title.
  if (/%[0-9A-Fa-f]{2}/.test(title)) return false;

  if (record.language && String(record.language).toLowerCase() !== "en") {
    return false;
  }

  // Body may legitimately contain product names/symbols. Only reject when
  // non-Latin script is clearly dominant in a useful sample.
  return isEnglishTextSample(`${title} ${text.slice(0, 3000)}`);
}

function isEnglishPage(html, title, body, url) {
  if (!isLikelyEnglishUrl(url)) return false;

  const lang = extractHtmlLanguage(html);

  // If the page explicitly declares a language, only English is accepted.
  if (lang && !/^en(?:-|$)/i.test(lang)) {
    return false;
  }

  if (containsNonLatinScript(title)) return false;
  if (/%[0-9A-Fa-f]{2}/.test(String(title || ""))) return false;

  return isEnglishTextSample(
    `${String(title || "")} ${String(body || "").slice(0, 5000)}`
  );
}

function extractHtmlLanguage(html) {
  const source = String(html || "");

  return (
    source.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1] ||
    source.match(/<meta[^>]+http-equiv=["']content-language["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    source.match(/<meta[^>]+name=["']language["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    ""
  ).trim();
}

function containsNonLatinScript(text) {
  return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff]/u.test(
    String(text || "")
  );
}

function isEnglishTextSample(text) {
  const sample = String(text || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .slice(0, 6000);

  if (!sample.trim()) return true;

  const nonLatin =
    (sample.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff]/gu) || []).length;

  const latin =
    (sample.match(/[A-Za-z]/g) || []).length;

  // Explicitly reject even modest localized-script content when it dominates.
  if (nonLatin >= 8 && nonLatin > latin * 0.08) {
    return false;
  }

  return true;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; JandiNotionBroadcomSearch/3.0)"
    },
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}`);
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

function clampEnv(name, min, max, fallback) {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
