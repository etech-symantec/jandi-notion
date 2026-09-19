import {
  FINAL_INDEX_PATH,
  BROADCOM_INDEX_PATH,
  clampNumber,
  formatDate
} from "../lib/common.js";
import { readJsonBlob } from "../lib/blob.js";
import { searchIndex, parseBooleanQuery } from "../lib/search.js";
import { searchBroadcomIndex } from "../lib/broadcom.js";

let memoryCache = { loadedAt: 0, index: null };
let broadcomCache = { loadedAt: 0, index: null };

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "GET only" });
  }

  try {
    const q = String(req.query?.q || "").replace(/\s+/g, " ").trim();
    const requested = Number(req.query?.perPage);
    const perPage = requested === 20 ? 20 : 10;
    const page = clampNumber(req.query?.page, 1, 100000, 1);

    if (!q) {
      return res.status(200).json({
        ok: true,
        query: "",
        page: 1,
        perPage,
        total: 0,
        totalPages: 0,
        results: []
      });
    }

    const index = await loadIndex();
    if (!index) {
      return res.status(503).json({
        ok: false,
        error: "검색 인덱스가 없습니다."
      });
    }

    const notionResults = searchIndex(index, q).map(v => ({
      ...v,
      source: "Notion"
    }));

    const broadcomIndex = await loadBroadcomIndex();
    const broadcomResults = broadcomIndex
      ? searchBroadcomIndex(
          broadcomIndex,
          q,
          parseBooleanQuery(q)
        )
      : [];

    const all = [...notionResults, ...broadcomResults]
      .sort((a, b) => {
        if ((b.score || 0) !== (a.score || 0)) {
          return (b.score || 0) - (a.score || 0);
        }
        return String(a.title).localeCompare(String(b.title), "ko");
      });
    const total = all.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * perPage;
    const pageResults = all.slice(start, start + perPage);

    return res.status(200).json({
      ok: true,
      query: q,
      page: safePage,
      perPage,
      total,
      totalPages,
      searchIndex: {
        pageCount: index.pageCount || index.pages?.length || 0,
        createdAt: index.createdAt,
        createdAtKst: formatDate(index.createdAt),
        broadcomPageCount: broadcomIndex?.pageCount || 0,
        broadcomCreatedAt: broadcomIndex?.createdAt || null
      },
      results: pageResults.map((item, idx) => ({
        rank: start + idx + 1,
        id: item.id,
        title: item.title,
        url: item.url,
        lastEdited: item.lastEdited,
        titleMatch: !!item.titleMatch,
        bodyMatch: !!item.bodyMatch,
        snippet: item.snippet || "",
        score: item.score,
        source: item.source || "Notion",
        articleId: item.articleId || "",
        matchedTerms: item.matchedTerms || [],
        booleanMatch: !!item.booleanMatch
      }))
    });

  } catch (error) {
    console.error("[WEB_SEARCH_ERROR]", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || String(error)
    });
  }
}

async function loadIndex() {
  if (memoryCache.index && Date.now() - memoryCache.loadedAt < 60_000) {
    return memoryCache.index;
  }

  const index = await readJsonBlob(FINAL_INDEX_PATH, true);
  if (!index) return null;

  memoryCache = { loadedAt: Date.now(), index };
  return index;
}


async function loadBroadcomIndex() {
  if (
    broadcomCache.index &&
    Date.now() - broadcomCache.loadedAt < 60_000
  ) {
    return broadcomCache.index;
  }

  try {
    const index = await readJsonBlob(BROADCOM_INDEX_PATH, true);
    if (!index) return null;
    broadcomCache = { loadedAt: Date.now(), index };
    return index;
  } catch {
    return null;
  }
}
