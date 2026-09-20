# JANDI → Notion + Broadcom KB 검색 v4.6
## 180,000+ Broadcom KB 대응 구조

Broadcom 제목 인덱스와 본문 인덱스를 분리했습니다.

### 제목 인덱스
기존:
`jandi-notion/broadcom-index.json`

을 그대로 사용합니다.

현재 약 180,477개 제목이 들어 있어도 v4.6에서 절대
10,000개짜리 본문 인덱스로 덮어쓰지 않습니다.

따라서 Broadcom 본문 구축이 오래 걸려도 제목 검색은 처음부터
기존 전체 KB를 계속 검색합니다.

### 본문 인덱스

본문은 별도 gzip chunk로 저장됩니다.

경로:
`jandi-notion/broadcom-body/chunks/chunk-xxxxx.json.gz`

기본:
- chunk당 250개 문서
- 문서당 본문 최대 4,000자
- gzip 압축
- 영어 문서만 저장

각 chunk에는 별도 Bloom filter를 만들어 manifest에 저장합니다.

검색 시 전체 본문 chunk를 읽지 않고 검색어가 존재할 가능성이 있는
chunk만 골라서 읽습니다.

manifest:
`jandi-notion/broadcom-body/manifest.json`

## 최초 시작

배포 후:

`/api/broadcom?action=start&token=REINDEX_TOKEN&force=true`

상태:

`/api/broadcom?action=status&token=REINDEX_TOKEN`

GitHub 5분 worker가 기존과 같이:

`/api/broadcom?action=next&token=REINDEX_TOKEN`

를 호출하면서 진행합니다.

## 상태 예

- titleIndex.pageCount = 180477
- bodyIndex.indexedPages = 현재까지 본문 저장 완료된 영어 KB 수
- processedPages = 제목 인덱스에서 검사 완료한 위치
- progress = 전체 본문 구축 진행률

본문 구축 중에도 제목 인덱스 180,477개는 계속 사용됩니다.

## 검색

검색 순서:
1. Notion 제목+본문
2. Broadcom 제목 전체 인덱스
3. Broadcom 본문 Bloom filter로 후보 chunk 선택
4. 후보 body chunk 검색
5. URL 기준 중복 제거/결과 병합

잔디:
- Notion 최대 5개
- KB 최대 5개

웹:
- 전체 / Notion / KB 필터
- Notion 흰색 태그
- KB Broadcom 빨간 태그
- 태그 클릭 필터

## 권장 기본값

BROADCOM_BODY_MAX_PAGES=250000
BROADCOM_BODY_FETCH_BATCH=50
BROADCOM_BODY_CONCURRENCY=5
BROADCOM_BODY_CHUNK_SIZE=250
BROADCOM_BODY_MAX_CHARS=4000
BROADCOM_BODY_REFRESH_AGE_DAYS=30
BROADCOM_BODY_SEARCH_MAX_CHUNKS=40

## 주의

18만 개 페이지의 최초 본문 수집은 무료 Vercel에서는 상당한 시간이 걸립니다.
하지만 v4.6에서는 그동안에도 기존 18만 개 제목 검색이 정상 동작하고,
수집 완료된 본문 chunk는 즉시 검색에 반영됩니다.

기존 `broadcom-index.json`은 삭제하지 마세요.
