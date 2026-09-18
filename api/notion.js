const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";

export default async function handler(req, res) {
  // 브라우저에서 URL을 열었을 때 배포 상태 확인용
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "JANDI Notion Search",
      endpoint: "/api/notion",
      usage: "JANDI에서 /notion 검색어"
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ body: "지원하지 않는 요청 방식입니다." });
  }

  try {
    const payload = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    // 잔디 Team Outgoing Webhook 토큰 검증
    const expectedJandiToken = process.env.JANDI_TOKEN;
    if (!expectedJandiToken) {
      console.error("JANDI_TOKEN 환경변수가 없습니다.");
      return jandiResponse(res, "⚠️ 서버 설정 오류: JANDI_TOKEN이 등록되지 않았습니다.");
    }

    if (!payload.token || payload.token !== expectedJandiToken) {
      // 잔디는 200 이외 응답을 표시하지 않으므로 사용자에게 보일 수 있게 200으로 반환
      return jandiResponse(res, "⛔ 인증되지 않은 잔디 Webhook 요청입니다.");
    }

    const notionToken = process.env.NOTION_TOKEN;
    if (!notionToken) {
      console.error("NOTION_TOKEN 환경변수가 없습니다.");
      return jandiResponse(res, "⚠️ 서버 설정 오류: NOTION_TOKEN이 등록되지 않았습니다.");
    }

    const query = String(payload.data || "")
      .replace(/\s+/g, " ")
      .trim();

    if (!query) {
      return jandiResponse(
        res,
        "🔎 **Notion 검색**\n\n검색어를 입력해주세요.\n예: `/notion proxysg ssl`"
      );
    }

    // Notion Search API
    const notionResponse = await fetch(`${NOTION_API}/search`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${notionToken}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query,
        page_size: 20,
        sort: {
          direction: "descending",
          timestamp: "last_edited_time"
        }
      })
    });

    const notionData = await notionResponse.json().catch(() => ({}));

    if (!notionResponse.ok) {
      console.error("Notion API error:", notionResponse.status, notionData);

      let detail = notionData?.message || `HTTP ${notionResponse.status}`;
      if (notionResponse.status === 401) {
        detail = "Notion API 토큰을 확인해주세요.";
      } else if (notionResponse.status === 403) {
        detail = "Integration에 검색 대상 페이지 접근 권한이 있는지 확인해주세요.";
      } else if (notionResponse.status === 429) {
        detail = "Notion API 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
      }

      return jandiResponse(res, `⚠️ **Notion 검색 실패**\n\n${escapeMarkdown(detail)}`);
    }

    const items = Array.isArray(notionData.results) ? notionData.results : [];

    if (items.length === 0) {
      return jandiResponse(
        res,
        `🔎 **Notion 검색 결과**\n\n\`${escapeMarkdown(query)}\`에 대한 결과가 없습니다.\n\nIntegration에 해당 페이지가 공유되어 있는지도 확인해주세요.`
      );
    }

    const maxResults = clampNumber(process.env.MAX_RESULTS, 1, 10, 5);
    const results = items.slice(0, maxResults);

    const connectInfo = results.map((item, index) => {
      const title = getTitle(item);
      const url = item.url || makeNotionUrl(item.id);
      const edited = formatDate(item.last_edited_time);

      return {
        title: `${index + 1}. ${title}`,
        description: `${edited ? `최근 수정: ${edited}\n` : ""}${url}`
      };
    });

    const bodyLines = [
      "🔎 **Notion 검색 결과**",
      "",
      `검색어: **${escapeMarkdown(query)}**`,
      `결과: ${results.length}건`,
      ""
    ];

    // body에도 클릭 가능한 링크 제공
    for (let i = 0; i < results.length; i++) {
      const item = results[i];
      const title = getTitle(item);
      const url = item.url || makeNotionUrl(item.id);
      bodyLines.push(`${i + 1}. [${escapeMarkdown(title)}](${url})`);
    }

    const body = truncate(bodyLines.join("\n"), 4500);

    return res.status(200).json({
      body,
      connectColor: "#000000",
      connectInfo
    });

  } catch (error) {
    console.error("Unhandled error:", error);
    return jandiResponse(
      res,
      "⚠️ 검색 처리 중 오류가 발생했습니다. Vercel Function 로그를 확인해주세요."
    );
  }
}

function jandiResponse(res, body) {
  return res.status(200).json({
    body: truncate(body, 4500),
    connectColor: "#000000"
  });
}

function getTitle(item) {
  // Page: properties 안의 title 타입 속성
  if (item?.properties && typeof item.properties === "object") {
    for (const property of Object.values(item.properties)) {
      if (property?.type === "title" && Array.isArray(property.title)) {
        const text = property.title.map(v => v?.plain_text || "").join("").trim();
        if (text) return text;
      }
    }
  }

  // Data source / database 계열에서 title 배열이 존재하는 경우
  if (Array.isArray(item?.title)) {
    const text = item.title.map(v => v?.plain_text || "").join("").trim();
    if (text) return text;
  }

  // 일부 응답 변형 방어
  if (typeof item?.name === "string" && item.name.trim()) {
    return item.name.trim();
  }

  return "제목 없음";
}

function makeNotionUrl(id) {
  if (!id) return "https://www.notion.so";
  return `https://www.notion.so/${String(id).replace(/-/g, "")}`;
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
  return s.length <= max ? s : s.slice(0, max - 20) + "\n\n…(일부 생략)";
}

function escapeMarkdown(text) {
  return String(text || "").replace(/([\\`*_[\]()])/g, "\\$1");
}
