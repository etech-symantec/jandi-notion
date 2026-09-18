# JANDI → Notion 검색 v3.1 (분할 인덱싱)

## 왜 v3.1인가

447페이지 환경에서 v3 단일 `/api/reindex`가 Vercel의 300초 제한에 걸리는 문제를 해결합니다.

v3.1은 전체 문서를 작은 배치로 나누고 각 배치 결과를 Vercel Blob에 저장합니다.

```text
/start
  ↓
전체 페이지 목록만 수집
  ↓
state 저장

/next
  ↓
15페이지 처리
  ↓
chunk-0001.json 저장
  ↓
state 진행률 갱신

/next
  ↓
다음 15페이지 처리
  ↓
chunk-0002.json 저장
  ...

마지막 배치
  ↓
모든 chunk 합침
  ↓
notion-index.json 최종 저장
```

중간에 브라우저가 닫혀도 `이어하기`를 누르면 저장된 상태부터 계속합니다.

---

## 설치

ZIP 내용을 기존 GitHub 프로젝트에 덮어쓴 뒤 Vercel에서 Redeploy 합니다.

필요 파일:

```text
api/notion.js
api/debug.js
api/reindex.js
api/reindex/start.js
api/reindex/next.js
api/reindex/status.js
lib/common.js
lib/blob.js
lib/indexer.js
lib/search.js
public/reindex.html
package.json
vercel.json
```

---

## 환경변수

```text
NOTION_TOKEN=...
JANDI_TOKEN=...
REINDEX_TOKEN=긴랜덤문자열
DEBUG_TOKEN=긴랜덤문자열

MAX_RESULTS=5
MAX_INDEX_PAGES=1000
REINDEX_BATCH_SIZE=15
MAX_BLOCKS_PER_PAGE=500
MAX_BLOCK_DEPTH=5
INDEX_CONCURRENCY=3
```

### 권장값

현재 약 447페이지이므로 우선:

```text
REINDEX_BATCH_SIZE=15
INDEX_CONCURRENCY=3
```

를 권장합니다.

그래도 한 배치가 300초를 넘으면:

```text
REINDEX_BATCH_SIZE=10
```

또는:

```text
REINDEX_BATCH_SIZE=5
```

로 낮추세요.

---

## 사용 방법

배포 후 브라우저:

```text
https://jandi-notion-search.vercel.app/reindex?token=REINDEX_TOKEN값
```

접속합니다.

화면에서:

```text
새 인덱싱 시작
```

을 누르면 됩니다.

브라우저가 다음 배치를 자동으로 순차 호출하며 진행률을 표시합니다.

예:

```text
상태: running
처리: 180/447
진행률: 40.3%
실패: 1
배치: 12
```

중간에 닫았으면 같은 URL로 다시 들어와:

```text
이어하기
```

를 누르면 됩니다.

---

## API 직접 사용

새 작업 시작:

```text
/api/reindex/start?token=...
```

한 배치 진행:

```text
/api/reindex/next?token=...
```

상태 확인:

```text
/api/reindex/status?token=...
```

기존 `/api/reindex`는 사용방법만 보여줍니다.

---

## 완료 후

최종 Blob:

```text
jandi-notion/notion-index.json
```

이 생성됩니다.

그 후 잔디:

```text
/노션 tcp auto buffer
```

검색은 Notion 전체를 다시 읽지 않고 완성된 인덱스만 조회합니다.

기존 최종 인덱스가 있는 상태에서 새 인덱싱을 시작해도,
새 작업이 완료될 때까지 기존 인덱스를 계속 검색에 사용합니다.

즉 재인덱싱 중에도 검색 서비스가 끊기지 않습니다.

---

## 디버그

```text
/api/debug?token=DEBUG_TOKEN
```

에서 다음을 확인합니다.

- 전체 페이지
- 현재 처리 페이지
- 진행률
- 실패 페이지
- 배치 개수
- 최종 인덱스 존재 여부
- 최종 인덱스 페이지 수

---

## 중요한 점

`MAX_INDEX_PAGES=1000`은 전체 페이지 목록의 상한입니다.

현재 447페이지라면 전체가 포함됩니다.

`MAX_BLOCKS_PER_PAGE=500`, `MAX_BLOCK_DEPTH=5`는 각 문서 본문 수집 범위이며,
검색할 때가 아니라 재인덱싱할 때만 성능 영향을 줍니다.
