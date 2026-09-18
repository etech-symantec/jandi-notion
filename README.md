# JANDI → Notion 검색 v3 (사전 인덱싱 방식)

## 핵심 변경

v2는 잔디에서 검색할 때마다 Notion 페이지 본문을 읽었습니다.

v3는 구조가 다릅니다.

```text
[인덱싱]
Notion 전체 문서
   ↓
/api/reindex
   ↓
본문 수집
   ↓
Vercel Blob (private)
notion-index.json

[검색]
JANDI /노션 검색어
   ↓
/api/notion
   ↓
Vercel Blob 인덱스 로드
   ↓
메모리에서 검색
   ↓
JANDI 응답
```

따라서 `/노션` 검색 시 Notion API를 수백 번 호출하지 않습니다.

---

## 1. Vercel Blob 연결

Vercel 프로젝트에서 Blob Store를 하나 연결하세요.

권장:

```text
Storage
→ Blob
→ Create
→ Private
→ 현재 jandi-notion-search 프로젝트 연결
```

2026년 기준 새 Blob 연결은 Vercel OIDC 인증을 사용할 수 있습니다.
기존 방식이라면 `BLOB_READ_WRITE_TOKEN` 환경변수가 자동 생성될 수 있습니다.

---

## 2. 파일 교체

기존 GitHub 프로젝트에 v3 ZIP의 파일을 그대로 적용합니다.

중요 파일:

```text
api/notion.js
api/reindex.js
api/debug.js
lib/common.js
lib/indexer.js
lib/search.js
package.json
vercel.json
```

---

## 3. 환경변수

기존:

```text
NOTION_TOKEN=...
JANDI_TOKEN=...
MAX_RESULTS=5
```

추가:

```text
REINDEX_TOKEN=임의의긴문자열
CRON_SECRET=또다른긴문자열

MAX_INDEX_PAGES=1000
MAX_BLOCKS_PER_PAGE=500
MAX_BLOCK_DEPTH=5
INDEX_CONCURRENCY=3

DEBUG_TOKEN=긴문자열
```

Blob 연결에 따라 Vercel이 Blob 인증값을 자동 처리합니다.

---

## 4. 최초 인덱싱

배포 후 브라우저에서:

```text
https://jandi-notion-search.vercel.app/api/reindex?token=REINDEX_TOKEN값
```

을 엽니다.

정상 예:

```json
{
  "ok": true,
  "pageCount": 327,
  "failedCount": 0,
  "durationMs": 45231
}
```

첫 실행은 수십 초 이상 걸릴 수 있습니다.

### Vercel Logs

검색:

```text
REINDEX
```

진행 예:

```text
[REINDEX][...][START]
[REINDEX][...][PAGE_LIST_BATCH]
[REINDEX][...][INDEX_PROGRESS] {"done":10,"total":327}
...
[REINDEX][...][INDEX_BUILT]
[REINDEX][...][BLOB_SAVED]
```

---

## 5. 검색 테스트

인덱싱 완료 후 JANDI:

```text
/노션 tcp auto buffer
```

이제 검색 시 Notion 전체를 다시 읽지 않습니다.

응답에는 검색시간이 표시됩니다.

예:

```text
검색시간: 120ms
```

---

## 6. 자동 갱신

`vercel.json`에는 다음 Cron이 포함되어 있습니다.

```text
매일 18:00 UTC
= 한국시간 매일 03:00
```

Vercel Cron은 `/api/reindex`를 호출합니다.

`CRON_SECRET` 환경변수가 설정되어 있으면 코드에서:

```text
Authorization: Bearer <CRON_SECRET>
```

을 확인합니다.

따라서 매일 새벽 Notion 검색 인덱스를 자동 갱신합니다.

필요할 때는 수동으로:

```text
/api/reindex?token=REINDEX_TOKEN
```

을 실행하면 됩니다.

---

## 7. 진단

```text
https://jandi-notion-search.vercel.app/api/debug?token=DEBUG_TOKEN값
```

확인 가능 항목:

```text
Blob 인덱스 존재 여부
마지막 인덱싱 시각
인덱싱 페이지 수
실패 페이지 수
인덱스 JSON 크기
샘플 페이지 제목
환경변수 설정 여부
```

토큰 실제 값은 출력하지 않습니다.

---

## 8. 현재 권장값

현재 문서가 200개를 넘으므로:

```text
MAX_INDEX_PAGES=1000
MAX_BLOCKS_PER_PAGE=500
MAX_BLOCK_DEPTH=5
INDEX_CONCURRENCY=3
```

로 시작해도 됩니다.

검색 요청 자체에는 이 설정이 성능 부담을 주지 않습니다.
부담은 `/api/reindex` 실행 시에만 발생합니다.

---

## 9. 페이지가 1,000개보다 많아지면

```text
MAX_INDEX_PAGES=2000
```

으로 늘릴 수 있습니다.

현재 코드는 최대 5,000개까지 허용합니다.

단, 페이지가 매우 많아지면 Vercel Function 실행시간에 걸릴 수 있으므로
그 시점에는 증분 인덱싱 방식으로 변경하는 것이 좋습니다.

---

## 10. 주의

Notion Integration에 공유되지 않은 페이지는 인덱싱되지 않습니다.

새 문서를 추가한 직후 검색에 나오게 하려면 수동 `/api/reindex`를 실행하거나
다음 자동 Cron 인덱싱까지 기다리면 됩니다.
