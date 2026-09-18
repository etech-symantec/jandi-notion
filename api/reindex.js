export default async function handler(req, res) {
  return res.status(200).json({
    ok: true,
    service: "JANDI Notion Search v3.1 Chunked Reindex",
    usage: {
      ui: "/reindex?token=REINDEX_TOKEN",
      start: "/api/reindex/start?token=REINDEX_TOKEN",
      next: "/api/reindex/next?token=REINDEX_TOKEN",
      status: "/api/reindex/status?token=REINDEX_TOKEN"
    },
    note: "권장: /reindex?token=... 페이지를 열어 자동 분할 인덱싱을 실행하세요."
  });
}
