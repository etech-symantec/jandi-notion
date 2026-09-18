import { get } from "@vercel/blob";
import {
  INDEX_PATH,
  clampNumber,
  escapeMarkdown,
  formatDate,
  truncate
} from "../lib/common.js";
import { searchIndex } from "../lib/search.js";

let memoryCache = {
  loadedAt: 0,
  index: null
};

export default async function handler(req, res) {
  const started = Date.now();

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "JANDI Notion Search v3 Indexed",
      endpoint: "/api/notion",
      reindex: "/api/reindex",
      debug: "/api/debug",
      usage: "JANDI에서 /노션 검색어"
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
        "🔎 **Notion 검색**\n\n검색어를 입력해주세요.\n예: `/노션 tcp auto buffer`"
      );
    }

    const index = await loadIndex();

    if (!index) {
      return jandi(
        res,
        [
          "⚠️ **검색 인덱스가 아직 없습니다.**",
          "",
          "관리자가 `/api/reindex`를 한 번 실행해야 합니다."
        ].join("\n")
      );
    }

    const maxResults = clampNumber(process.env.MAX_RESULTS, 1, 10, 5);
    const results = searchIndex(index, query).slice(0, maxResults);

    if (!results.length) {
      return jandi(
        res,
        [
          "🔎 **Notion 검색 결과**",
          "",
          `\`${escapeMarkdown(query)}\`에 대한 결과가 없습니다.`,
          "",
          `인덱스 페이지: ${index.pageCount || index.pages?.length || 0}개`,
          `마지막 인덱싱: ${formatDate(index.createdAt) || index.createdAt || "-"}`
        ].join("\n")
      );
    }

    const lines = [
      "🔎 **Notion 검색 결과**",
      "",
      `검색어: **${escapeMarkdown(query)}**`,
      `결과: ${results.length}건`,
      `검색시간: ${Date.now() - started}ms`,
      ""
    ];

    const connectInfo = [];

    for (let i = 0; i < results.length; i++) {
      const item = results[i];
      const badges = [];
      if (item.titleMatch) badges.push("제목");
      if (item.bodyMatch) badges.push("본문");
      const badge = badges.length ? ` [${badges.join("+")}]` : "";

      lines.push(
        `${i + 1}. [${escapeMarkdown(item.title)}](${item.url})${badge}`
      );

      connectInfo.push({
        title: `${i + 1}. ${item.title}${badge}`,
        description: [
          item.snippet ? truncate(item.snippet, 350) : "",
          item.lastEdited ? `최근 수정: ${formatDate(item.lastEdited)}` : "",
          item.url
        ].filter(Boolean).join("\n")
      });
    }

    lines.push("");
    lines.push(`인덱스: ${index.pageCount || index.pages?.length || 0}개 페이지`);
    lines.push(`마지막 갱신: ${formatDate(index.createdAt) || index.createdAt}`);

    return res.status(200).json({
      body: truncate(lines.join("\n"), 4500),
      connectColor: "#000000",
      connectInfo
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
  // 같은 warm instance 내에서는 60초 메모리 캐시
  if (
    memoryCache.index &&
    Date.now() - memoryCache.loadedAt < 60_000
  ) {
    return memoryCache.index;
  }

  try {
    const result = await get(INDEX_PATH, {
      access: "private",
      useCache: true
    });

    if (!result?.stream) return null;

    const text = await new Response(result.stream).text();
    const index = JSON.parse(text);

    memoryCache = {
      loadedAt: Date.now(),
      index
    };

    return index;
  } catch (error) {
    const msg = String(error?.message || error);
    if (
      msg.includes("404") ||
      msg.toLowerCase().includes("not found") ||
      msg.toLowerCase().includes("does not exist")
    ) {
      return null;
    }
    throw error;
  }
}

function jandi(res, body) {
  return res.status(200).json({
    body: truncate(body, 4500),
    connectColor: "#000000"
  });
}
