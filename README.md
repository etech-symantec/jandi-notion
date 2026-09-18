# JANDI → Notion 검색 v3.2 (자동 Cron 분할 인덱싱)

## 핵심

v3.1은 브라우저가 `/next`를 계속 호출했습니다.

v3.2는 한 번 `새 인덱싱 시작`만 하면 이후에는 **Vercel Cron이 5분마다 자동으로 다음 배치를 처리**합니다.

```text
새 인덱싱 시작
  ↓
447페이지 목록 저장
  ↓
브라우저 종료 가능

Vercel Cron
  ↓
15페이지 처리
  ↓
Blob 저장

5분 후
  ↓
다음 15페이지 처리

...
  ↓
전체 완료
  ↓
최종 notion-index.json 생성
```

---

## 배포

ZIP 내용을 기존 GitHub 프로젝트에 덮어쓴 뒤 Vercel에서 Redeploy 합니다.

추가 파일:

```text
api/reindex/cron.js
api/reindex/control.js
```

기존 파일들도 v3.2 ZIP 기준으로 덮어쓰는 것을 권장합니다.

---

## 환경변수

```text
NOTION_TOKEN=...
JANDI_TOKEN=...

REINDEX_TOKEN=긴랜덤문자열
CRON_SECRET=또다른긴랜덤문자열
DEBUG_TOKEN=긴랜덤문자열

MAX_RESULTS=5
MAX_INDEX_PAGES=1000
REINDEX_BATCH_SIZE=15
MAX_BLOCKS_PER_PAGE=500
MAX_BLOCK_DEPTH=5
INDEX_CONCURRENCY=3
```

`CRON_SECRET`은 반드시 설정하세요.

Vercel Cron이 `/api/reindex/cron`을 호출할 때 코드가:

```text
Authorization: Bearer <CRON_SECRET>
```

을 확인합니다.

---

## Cron 주기

`vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/reindex/cron",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

즉 5분마다 한 번 다음 배치를 처리합니다.

447페이지 / 15페이지 배치라면 약 30번 호출이 필요합니다.

이론상:

```text
약 30 × 5분 = 약 150분
```

정도로 전체 인덱싱이 완료됩니다.

각 배치가 실제로 오래 걸려도 브라우저는 필요 없습니다.

---

## 시작 방법

```text
https://jandi-notion-search.vercel.app/reindex?token=REINDEX_TOKEN값
```

접속 후:

```text
새 인덱싱 시작
```

을 한 번 누릅니다.

그 다음 브라우저를 닫아도 됩니다.

---

## 상태 확인

언제든:

```text
/api/reindex/status?token=REINDEX_TOKEN값
```

또는 `/reindex` 화면에서 상태 확인을 누릅니다.

예:

```text
processedPages: 180
totalPages: 447
progress: 40.3
status: running
```

---

## 일시정지

웹 화면의:

```text
자동 진행 일시정지
```

또는:

```text
/api/reindex/control?action=pause&token=REINDEX_TOKEN값
```

을 호출합니다.

재개:

```text
/api/reindex/control?action=resume&token=REINDEX_TOKEN값
```

---

## 수동으로 즉시 한 배치 진행

Cron 5분을 기다리기 싫으면:

```text
/api/reindex/next?token=REINDEX_TOKEN값
```

을 직접 호출하거나 웹 화면의:

```text
지금 수동 진행
```

을 사용합니다.

---

## 중복 실행 방지

Cron이 이전 배치가 끝나기 전에 다시 호출될 가능성을 대비해 상태에 `lockUntil`을 저장합니다.

기본적으로 한 배치 시작 시 약 4분간 lock을 잡습니다.

따라서 중복 처리 가능성을 줄였습니다.

---

## 완료 후

최종 인덱스:

```text
jandi-notion/notion-index.json
```

이 생성되고 상태는:

```text
status: completed
progress: 100
```

이 됩니다.

잔디 검색은:

```text
/노션 검색어
```

그대로 사용하면 됩니다.
