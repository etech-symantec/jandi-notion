import {
  FINAL_INDEX_PATH,
  clampNumber,
  escapeMarkdown,
  formatDate,
  truncate
} from "../lib/common.js";
import { readJsonBlob } from "../lib/blob.js";
import { searchIndex, parseBooleanQuery } from "../lib/search.js";

let memoryCache = { loadedAt: 0, index: null };

export default async function handler(req, res) {
  const started = Date.now();

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "JANDI Notion Search v3.5",
      endpoint: "/api/notion",
      searchPage: "/search",
      syntax: { and: "&", or: "|", precedence: "& before |" }
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ body: "지원하지 않는 요청 방식입니다." });
  }

  try {
    const payload =
      typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    if (!process.env.JANDI_TOKEN) {
      return jandi(res, "⚠️ JANDI_TOKEN이 설정되지 않았습니다.");
    }

    if (payload.token !== process.env.JANDI_TOKEN) {
      return jandi(res, "⛔ 인증되지 않은 JANDI Webhook 요청입니다.");
    }

    const query = String(payload.data || "").replace(/\s+/g, " ").trim();

    if (!query) {
      return jandi(
        res,
        [
          "🔎 **Notion 검색**",
          "",
          "검색어를 입력해주세요.",
          "예: `/노션 ELK`",
          "AND: `/노션 ELK & Ubuntu`",
          "OR: `/노션 ELK | Kibana`"
        ].join("\n")
      );
    }

    const index = await loadIndex();

    if (!index) {
      return jandi(
        res,
        "⚠️ 검색 인덱스가 없습니다.\n관리자가 `/reindex` 페이지에서 최초 인덱싱을 실행해야 합니다."
      );
    }

    const maxResults = clampNumber(process.env.MAX_RESULTS, 1, 10, 10);
    const allResults = searchIndex(index, query);
    const results = allResults.slice(0, maxResults);
    const total = allResults.length;

    const baseUrl = getBaseUrl(req);
    const searchUrl =
      `${baseUrl}/search?q=${encodeURIComponent(query)}&perPage=10&page=1`;

    const parsed = parseBooleanQuery(query);
    const mode = parsed.hasOperators ? "조건 검색" : "일반 검색";

    const lines = [
      "🔎 **Notion 검색 결과**",
      "",
      "| 검색어 | 결과 | 방식 |",
      "|---|---:|---|",
      `| ${escapeMarkdown(query)} | ${total}건 | ${mode} |`,
      "",
      "| 인덱스 | 마지막 갱신 |",
      "|---:|---|",
      `| ${index.pageCount || index.pages?.length || 0}개 | ${formatDate(index.createdAt)} |`,
      ""
    ];

    if (!results.length) {
      lines.push("검색 결과가 없습니다.");
    } else {
      for (let i = 0; i < results.length; i++) {
        const item = results[i];
        lines.push(`${i + 1}. [${escapeMarkdown(item.title)}](${item.url})`);
      }
    }

    if (total > 0) {
      lines.push("");
      if (total > results.length) {
        lines.push(`🌐 [전체 결과 ${total}건 보기](${searchUrl})`);
      } else {
        lines.push(`🌐 [웹에서 보기](${searchUrl})`);
      }
    }

    return res.status(200).json({
      body: truncate(lines.join("\n"), 4500),
      connectColor: "#2563EB"
    });

  } catch (error) {
    console.error("[SEARCH_ERROR]", error);
    return jandi(
      res,
      `⚠️ 검색 오류가 발생했습니다.\n${String(error?.message || error)}`
    );
  }
}

async function loadIndex() {
  if (memoryCache.index && Date.now() - memoryCache.loadedAt < 60_000) {
    return memoryCache.index;
  }

  try {
    const index = await readJsonBlob(FINAL_INDEX_PATH, true);
    if (!index) return null;
    memoryCache = { loadedAt: Date.now(), index };
    return index;
  } catch (error) {
    const msg = String(error?.message || error).toLowerCase();
    if (msg.includes("not found") || msg.includes("404")) return null;
    throw error;
  }
}

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host =
    req.headers["x-forwarded-host"] ||
    req.headers.host ||
    "jandi-notion-search.vercel.app";
  return `${proto}://${host}`;
}

function jandi(res, body) {
  return res.status(200).json({
    body: truncate(body, 4500),
    connectColor: "#2563EB"
  });
}
