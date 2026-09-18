# JANDI → Notion 검색 v2.1 Debug

v2의 제목+본문 검색에 **단계별 진단 로그와 `/api/debug` 자체점검 API**를 추가한 버전입니다.

## 교체 파일

기존 GitHub 프로젝트에 아래 파일을 덮어쓰면 됩니다.

```text
api/notion.js
api/debug.js
vercel.json
```

`.env.example`은 참고용입니다.

---

# 1. 배포 후 기본 확인

```text
https://jandi-notion-search.vercel.app/api/notion
```

정상이라면:

```json
{
  "ok": true,
  "service": "JANDI Notion Search v2.1 Debug"
}
```

가 표시됩니다.

---

# 2. `/api/debug` 진단

보안을 위해 Vercel 환경변수에 다음 값을 추가하는 것을 권장합니다.

```text
DEBUG_TOKEN=임의의긴문자열
```

그러면:

```text
https://jandi-notion-search.vercel.app/api/debug?token=DEBUG_TOKEN값
```

으로 접속합니다.

`DEBUG_TOKEN`을 설정하지 않으면 `/api/debug`가 공개되므로 권장하지 않습니다.

토큰 실제 값은 진단 화면에 표시하지 않습니다.

## 점검 항목

`/api/debug`는 실제로 아래를 테스트합니다.

1. `NOTION_TOKEN`, `JANDI_TOKEN` 존재 여부
2. Notion `/v1/search` 인증 성공 여부
3. 검색 API가 반환하는 Page 수
4. `MAX_SCAN_PAGES` 기준 접근 가능한 Page 스캔
5. 샘플 Page의 block children 읽기
6. 본문 텍스트를 실제로 읽을 수 있는지

---

# 3. JANDI 요청 디버깅

잔디에서:

```text
/노션 proxysg
```

실행 후 Vercel:

```text
Project
→ Logs
```

에서 다음 문자열을 검색합니다.

```text
JANDI-NOTION
```

정상 요청은 대략 다음 순서로 표시됩니다.

```text
01_REQUEST_RECEIVED
02_PAYLOAD_PARSED
03_ENV_CHECK
04_JANDI_TOKEN_OK
05_QUERY_READY
06_TITLE_SEARCH_START
07_TITLE_SEARCH_DONE
08_BODY_INDEX_START
...
09_BODY_INDEX_DONE
10_BODY_SEARCH_DONE
11_MERGE_DONE
12_RESPONSE_READY
```

각 줄에 `Request ID`와 시작 후 경과 시간이 표시됩니다.

예:

```text
[JANDI-NOTION][mxyz-abc123][+42ms][05_QUERY_READY] {"query":"proxysg"}
```

잔디 검색 결과 마지막에도 같은 Request ID가 표시됩니다.

따라서 특정 검색의 로그만 찾으려면 Request ID로 Vercel 로그를 검색하면 됩니다.

---

# 4. 증상별 판단

## 잔디에서 실행했는데 Vercel 로그가 전혀 없음

`01_REQUEST_RECEIVED`조차 없다면:

```text
JANDI → Vercel
```

구간 문제입니다.

잔디 Webhook URL과 커맨드 설정을 확인합니다.

## `04_JANDI_TOKEN_OK` 이전에 종료

`JANDI_TOKEN` 불일치 또는 누락입니다.

## `07_TITLE_SEARCH_DONE`에서 멈춤

제목 검색은 됐지만 본문 인덱스 쪽 문제입니다.

## `BODY_INDEX_PAGE_DONE`이 계속 나오다가 timeout

본문 스캔량이 너무 많은 것입니다.

우선 아래처럼 줄여 테스트합니다.

```text
MAX_SCAN_PAGES=10
MAX_BLOCKS_PER_PAGE=100
MAX_BLOCK_DEPTH=1
SEARCH_CONCURRENCY=1
```

## `NOTION_RATE_LIMIT_RETRY`

Notion API 429 제한입니다.

코드가 `Retry-After` 값을 보고 자동 재시도합니다.

자주 발생한다면:

```text
SEARCH_CONCURRENCY=1
```

로 낮춥니다.

---

# 5. 권장 환경변수

```text
NOTION_TOKEN=...
JANDI_TOKEN=...
DEBUG_TOKEN=아주긴임의문자열

MAX_RESULTS=5
MAX_SCAN_PAGES=50
MAX_BLOCKS_PER_PAGE=300
MAX_BLOCK_DEPTH=2
SEARCH_CONCURRENCY=2
CACHE_TTL_MINUTES=10
```

처음 안정성 확인 시에는:

```text
MAX_SCAN_PAGES=10
MAX_BLOCKS_PER_PAGE=100
MAX_BLOCK_DEPTH=1
SEARCH_CONCURRENCY=1
```

로 시작하는 것을 권장합니다.

정상 작동이 확인되면 문서 수에 맞게 높이세요.

---

# 참고

Vercel Serverless 환경에서 `api/notion.js`와 `api/debug.js`는 서로 다른 Function 인스턴스로 실행될 수 있습니다.

따라서 `/api/debug`는 "직전 JANDI 요청의 메모리 로그"를 보여주는 방식이 아니라,
**현재 환경에서 Notion 연결과 본문 조회가 실제 가능한지 실시간으로 자체 진단**합니다.

직전 JANDI 요청의 처리 단계는 Vercel Logs에서 Request ID로 확인하는 것이 가장 정확합니다.
