export default async function handler(req, res) {
  return res.status(200).json({
    ok: true,
    service: "Broadcom KB Batch Reindex v4.1",
    start: "/api/broadcom/start?token=REINDEX_TOKEN",
    next: "/api/broadcom/next?token=REINDEX_TOKEN",
    status: "/api/broadcom/status?token=REINDEX_TOKEN"
  });
}
