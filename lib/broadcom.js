import {
  BROADCOM_INDEX_PATH,
  normalizeForSearch,
  dateValue
} from "./common.js";
import { writeJsonBlob } from "./blob.js";

const BASE = "https://knowledge.broadcom.com";
const ARTICLE_PREFIX = `${BASE}/external/article/`;

const SITEMAP_CANDIDATES = [
  `${BASE}/sitemap.xml`,
  `${BASE}/sitemap_index.xml`,
  `${BASE}/sitemap-index.xml`
];

export async function buildBroadcomIndex(log = () => {}) {
  const seenSitemaps = new Set();
  const articleUrls = new Set();

  let rootFound = false;

  for (const candidate of SITEMAP_CANDIDATES) {
    try {
      const text = await fetchText(candidate);
      if (!text) continue;

      rootFound = true;
      log("SITEMAP_ROOT", { url: candidate, bytes: text.length });

      await collectFromSitemapXml(
        candidate,
        text,
        seenSitemaps,
        articleUrls,
        log,
        0
      );

      if (articleUrls.size > 0) break;
    } catch (error) {
      log("SITEMAP_ROOT_FAILED", {
        url: candidate,
        error: error?.message || String(error)
      });
    }
  }

  // Optional manual URLs, useful if Broadcom sitemap changes or omits a page.
  const extras = String(process.env.BROADCOM_EXTRA_URLS || "")
    .split(/[\n,]/)
    .map(v => v.trim())
    .filter(Boolean);

  for (const url of extras) {
    const c = canonicalArticleUrl(url);
    if (c) articleUrls.add(c);
  }

  if (!rootFound && articleUrls.size === 0) {
    throw new Error(
      "Broadcom sitemap을 가져오지 못했습니다. BROADCOM_EXTRA_URLS를 사용하거나 sitemap 경로를 확인하세요."
    );
  }

  const records = [];

  for (const url of articleUrls) {
    const item = articleRecordFromUrl(url);
    if (item) records.push(item);
  }

  // Empty/ID-only titles get enhanced by fetching a limited number of pages.
  // This prevents a massive crawl but improves sitemap formats that omit slugs.
  const needTitle = records.filter(v => !v.hasSlugTitle);
  const enhanceLimit = Math.min(
    Number(process.env.BROADCOM_TITLE_FETCH_LIMIT || 200),
    needTitle.length
  );

  log("TITLE_ENRICH_START", {
    totalRecords: records.length,
    withoutSlugTitle: needTitle.length,
    fetchLimit: enhanceLimit
  });

  for (let i = 0; i < enhanceLimit; i += 5) {
    const batch = needTitle.slice(i, i + 5);
    const enhanced = await Promise.all(
      batch.map(async item => {
        try {
          const html = await fetchText(item.url);
          const title = extractHtmlTitle(html);
          if (title) item.title = title;
        } catch {}
        return item;
      })
    );
    if ((i + batch.length) % 50 === 0) {
      log("TITLE_ENRICH_PROGRESS", {
        done: i + batch.length,
        total: enhanceLimit
      });
    }
  }

  records.sort((a, b) =>
    a.title.localeCompare(b.title, "en", { sensitivity: "base" })
  );

  const index = {
    version: 1,
    source: "Broadcom Knowledge",
    baseUrl: ARTICLE_PREFIX,
    createdAt: new Date().toISOString(),
    pageCount: records.length,
    records
  };

  await writeJsonBlob(BROADCOM_INDEX_PATH, index);

  log("BROADCOM_INDEX_SAVED", {
    pageCount: index.pageCount
  });

  return index;
}

export function searchBroadcomIndex(index, query, parsedBoolean) {
  if (!index?.records?.length) return [];

  const parsed = parsedBoolean || parseBoolean(query);
  const results = [];

  for (const item of index.records) {
    const hay = normalizeForSearch(`${item.title} ${item.articleId || ""}`);

    let matched = false;
    let score = 0;

    if (parsed.hasOperators) {
      let bestGroup = null;

      for (const group of parsed.groups) {
        const terms = group.map(v => normalizeForSearch(v)).filter(Boolean);
        if (terms.length && terms.every(term => hay.includes(term))) {
          bestGroup = terms;
          break;
        }
      }

      if (bestGroup) {
        matched = true;
        score = 1200 + bestGroup.length * 500;
      }
    } else {
      const q = normalizeForSearch(query);
      if (!q) continue;

      if (hay.includes(q)) {
        matched = true;
        score += 2000;
      } else {
        const tokens = q.split(/\s+/).filter(v => v.length >= 2);
        const hits = tokens.filter(t => hay.includes(t)).length;
        if (hits) {
          matched = true;
          score += hits * 350;
        }
      }
    }

    if (!matched) continue;

    results.push({
      id: `broadcom-${item.articleId || item.url}`,
      title: item.title,
      url: item.url,
      lastEdited: "",
      titleMatch: true,
      bodyMatch: false,
      snippet: "",
      score,
      source: "Broadcom",
      articleId: item.articleId || ""
    });
  }

  return results.sort((a, b) => {
    if (b.score != a.score) return b.score - a.score;
    return a.title.localeCompare(b.title, "en", { sensitivity: "base" });
  });
}

function parseBoolean(query) {
  const raw = String(query || "").trim();
  const hasOperators = raw.includes("&") || raw.includes("|");

  if (!hasOperators) return { hasOperators: false, groups: [] };

  return {
    hasOperators: true,
    groups: raw
      .split("|")
      .map(part =>
        part.split("&").map(v => v.trim()).filter(Boolean)
      )
      .filter(v => v.length)
  };
}

async function collectFromSitemapXml(
  url,
  xml,
  seenSitemaps,
  articleUrls,
  log,
  depth
) {
  if (depth > 3 || seenSitemaps.has(url)) return;
  seenSitemaps.add(url);

  const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map(m => decodeXml(m[1].trim()));

  const sitemapLinks = [];
  let added = 0;

  for (const loc of locs) {
    const article = canonicalArticleUrl(loc);
    if (article) {
      const before = articleUrls.size;
      articleUrls.add(article);
      if (articleUrls.size > before) added += 1;
      continue;
    }

    if (/sitemap/i.test(loc) && /\.xml(?:$|\?)/i.test(loc)) {
      sitemapLinks.push(loc);
    }
  }

  log("SITEMAP_PARSED", {
    url,
    depth,
    locs: locs.length,
    articlesAdded: added,
    nestedSitemaps: sitemapLinks.length,
    articleTotal: articleUrls.size
  });

  for (const nested of sitemapLinks) {
    if (seenSitemaps.has(nested)) continue;
    try {
      const child = await fetchText(nested);
      await collectFromSitemapXml(
        nested,
        child,
        seenSitemaps,
        articleUrls,
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

    if (u.hostname !== "knowledge.broadcom.com") return null;

    // Canonical path form.
    if (u.pathname.startsWith("/external/article/")) {
      return `${u.origin}${u.pathname}`;
    }

    // Query form: /external/article?articleId=168282
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
    const m = u.pathname.match(/^\/external\/article\/(\d+)(?:\/([^/?#]+))?/i);

    if (!m) return null;

    const articleId = m[1];
    const slug = m[2] || "";
    const title = slug ? titleFromSlug(slug) : `Broadcom KB ${articleId}`;

    return {
      articleId,
      title,
      url,
      hasSlugTitle: !!slug
    };
  } catch {
    return null;
  }
}

function titleFromSlug(slug) {
  let s = String(slug || "")
    .replace(/\.html?$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function extractHtmlTitle(html) {
  const text = String(html || "");

  // Broadcom article pages commonly expose an h3 article heading.
  let m = text.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
  if (m) {
    const title = stripTags(m[1]).trim();
    if (title) return title;
  }

  m = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m) {
    const title = stripTags(m[1])
      .replace(/\s*-\s*Support Portal.*$/i, "")
      .trim();
    if (title) return title;
  }

  return "";
}

function stripTags(v) {
  return decodeXml(
    String(v || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  );
}

function decodeXml(v) {
  return String(v || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; JandiNotionBroadcomSearch/1.0)"
    },
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}`);
  }

  return response.text();
}
