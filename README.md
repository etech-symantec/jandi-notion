# JANDI → Notion + Broadcom KB 검색 v4.0

## 핵심 변경

Broadcom Knowledge Base를 제목뿐 아니라 본문까지 인덱싱합니다.

검색 대상:
- Notion 제목 + 본문
- Broadcom KB 제목 + 본문

잔디 결과의 출처 표시는 뒤쪽 `N`, `B` 대신 앞쪽에 표시합니다.

예:

1. [Notion] SSP Sizing Guide
2. [KB] Error Message "Licensing : License key not installed..."

## Broadcom 인덱싱 방식

### 최초 실행
처음에는 Broadcom sitemap에서 `external/article/` URL을 모은 뒤
각 문서의 제목과 본문을 가져와 `broadcom-index.json`에 저장합니다.

### 이후 실행
기존 Broadcom 인덱스를 읽은 뒤 증분 갱신합니다.

- sitemap `lastmod`가 이전 값과 동일하면 기존 본문 재사용
- sitemap에 `lastmod`가 없는 문서는 `BROADCOM_REFRESH_AGE_DAYS` 이내면 기존 본문 재사용
- 신규 또는 변경된 문서만 다시 가져옴
- 갱신 실패 시 기존 레코드가 있으면 기존 내용을 유지

따라서 매번 전체 본문을 다시 다운로드하지 않습니다.

## 기본 환경변수

BROADCOM_MAX_PAGES=10000
BROADCOM_BATCH_SIZE=20
BROADCOM_CONCURRENCY=3
BROADCOM_MAX_BODY_CHARS=30000
BROADCOM_REFRESH_AGE_DAYS=7

필요하면 값을 낮춰 Vercel Hobby 부하를 줄일 수 있습니다.

## Broadcom 최초 인덱싱

증분 모드:
`/api/broadcom/reindex?token=REINDEX_TOKEN`

강제 전체 재수집:
`/api/broadcom/reindex?token=REINDEX_TOKEN&full=true`

일반 운영에서는 증분 모드를 권장합니다.

## 자동 갱신

기존 한국시간:
- 08:00
- 12:00
- 15:00
- 19:00

scheduled workflow에서 Broadcom KB도 증분 갱신합니다.

## 검색 예

`/노션 Licensing`

→ Notion과 Broadcom KB 제목/본문 모두 검색

`/노션 License & ProxySG`

→ 두 단어가 모두 포함된 문서 검색

`/노션 Licensing | Subscription`

→ 둘 중 하나가 포함된 문서 검색

## 출처 표시

- `[Notion]` = Notion
- `[KB]` = Broadcom Knowledge Base

## 기존 Notion 인덱스

기존 Notion 인덱스는 그대로 사용할 수 있습니다.
Broadcom 인덱스만 최초 1회 생성하면 됩니다.
