# JANDI → Notion + Broadcom KB 검색 v4.2
## Vercel Hobby Serverless Function 제한 대응

v4.1의 Broadcom API 4개를 1개로 통합했습니다.

기존:
- api/broadcom/start.js
- api/broadcom/next.js
- api/broadcom/status.js
- api/broadcom/reindex.js

v4.2:
- api/broadcom.js

사용법:

시작:
`/api/broadcom?action=start&token=REINDEX_TOKEN`

다음 배치:
`/api/broadcom?action=next&token=REINDEX_TOKEN`

상태:
`/api/broadcom?action=status&token=REINDEX_TOKEN`

GitHub Actions workflow도 새 URL을 사용하도록 수정되어 있습니다.

## 중요한 배포 주의

GitHub 저장소에서 예전 API 파일이 남아 있으면 Vercel은 그대로 Serverless Function으로 계산합니다.

특히 다음 경로가 남아 있으면 삭제하세요:

- api/broadcom/start.js
- api/broadcom/next.js
- api/broadcom/status.js
- api/broadcom/reindex.js
- 과거 버전의 api/reindex/cron.js

v4.2 ZIP으로 저장소를 완전히 맞춘 뒤 배포하는 것을 권장합니다.

## 기능 유지

- Broadcom 제목+본문 배치 인덱싱
- Notion + Broadcom 통합 검색
- JANDI: Notion 5개 + KB 5개
- 웹 필터: 전체 / Notion / KB
- Notion 태그: 흰 배경 + 검은 글씨
- KB 태그: Broadcom 빨강 + 흰 글씨
- 태그 클릭 필터
- AND `&` / OR `|`
- 08:00 / 12:00 / 15:00 / 19:00 KST 자동 갱신
