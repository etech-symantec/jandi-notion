# JANDI → Notion 통합 검색 v2

기존 `/노션 검색어` 명령 하나로 **제목 + 페이지 본문**을 함께 검색합니다.

```text
/노션 tcp auto buffer
/노션 cyberark duo
/노션 ssl interception
```

## v2 변경점

기존 버전:

```text
/노션 검색어
→ Notion /v1/search
→ 제목 중심 검색
```

v2:

```text
/노션 검색어
      ↓
① Notion 공식 제목 검색
      +
② Integration이 접근 가능한 페이지 목록 조회
      ↓
③ 각 페이지 block children에서 본문 추출
      ↓
④ 제목 + 본문 관련도 계산
      ↓
⑤ 중복 제거 후 관련도 순으로 JANDI 표시
```

본문에서 검색된 결과는 잔디에 `[본문]`,
제목과 본문 모두 매칭되면 `[제목+본문]`으로 표시됩니다.

---

## 교체 방법

현재 GitHub 저장소에서 아래 파일만 교체해도 됩니다.

```text
api/notion.js
vercel.json
```

그리고 Vercel 환경변수를 추가합니다.

기존 필수 값:

```text
NOTION_TOKEN=...
JANDI_TOKEN=...
MAX_RESULTS=5
```

권장 추가값:

```text
MAX_SCAN_PAGES=50
MAX_BLOCKS_PER_PAGE=300
MAX_BLOCK_DEPTH=2
SEARCH_CONCURRENCY=2
CACHE_TTL_MINUTES=10
```

환경변수 추가 후 **Redeploy** 하세요.

---

## 각 환경변수 의미

### MAX_SCAN_PAGES

본문 검색을 위해 읽을 최대 페이지 수입니다.

기본값:

```text
50
```

Notion 문서가 50개 이하라면 그대로 사용하면 됩니다.

문서가 더 많다면:

```text
100
```

또는:

```text
200
```

까지 올릴 수 있습니다.

단, 페이지 수를 크게 하면 첫 검색이 느려질 수 있습니다.

### MAX_BLOCKS_PER_PAGE

페이지 하나에서 읽는 최대 블록 수입니다.

기본값:

```text
300
```

긴 기술문서라면 500 정도까지 올릴 수 있습니다.

### MAX_BLOCK_DEPTH

토글, 컬럼, 리스트 등 중첩된 블록의 하위 내용을 몇 단계까지 읽을지 지정합니다.

기본값:

```text
2
```

### SEARCH_CONCURRENCY

Notion API를 동시에 몇 개 호출할지 정합니다.

기본값:

```text
2
```

Notion API 제한을 고려하여 1~3을 권장합니다.

### CACHE_TTL_MINUTES

본문 인덱스를 메모리에 임시 보관하는 시간입니다.

기본값:

```text
10
```

첫 검색에서는 페이지 본문을 읽기 때문에 시간이 걸릴 수 있지만,
같은 Vercel 인스턴스가 유지되는 동안 두 번째 검색부터는 빨라집니다.

> Vercel Serverless 메모리는 영구 저장소가 아니므로
> 인스턴스가 교체되면 다시 본문을 읽습니다.

---

## 검색 예시

Notion 페이지:

```text
제목:
ProxySG 네트워크 튜닝

본문:
tcp-ip rfc-1323 enable
TCP Auto Buffer 설정은 ...
Window Scaling은 ...
```

기존 버전에서는:

```text
/노션 window scaling
```

검색이 안 될 수 있었습니다.

v2에서는 본문을 읽기 때문에 해당 페이지를 찾을 수 있습니다.

---

## 중요한 제한

### 1. 기한 제한은 없음

오래된 문서라는 이유로 제외하지 않습니다.

다만 `MAX_SCAN_PAGES`가 50이면
Notion에서 최근 수정 순으로 가져온 50개 페이지까지만
본문 인덱스 대상이 됩니다.

모든 문서를 대상으로 하고 싶다면 실제 페이지 수에 맞게
`MAX_SCAN_PAGES`를 늘리세요.

### 2. Integration 권한 필요

Notion Integration에 공유되지 않은 페이지는 검색할 수 없습니다.

### 3. 첫 검색은 느릴 수 있음

본문 검색은 페이지의 block children을 읽어야 하므로
Integration에 공유된 문서가 많을수록 첫 검색 시간이 늘어납니다.

### 4. 데이터베이스 행도 Page로 취급

Notion 데이터베이스 내부 행도 Page 객체라면 검색 대상이 될 수 있습니다.

---

## 배포 확인

브라우저:

```text
https://내프로젝트.vercel.app/api/notion
```

정상이라면:

```json
{
  "ok": true,
  "service": "JANDI Notion Search v2"
}
```

형태로 표시됩니다.

---

## 권장값

문서가 수십 개 수준이면:

```text
MAX_SCAN_PAGES=100
MAX_BLOCKS_PER_PAGE=300
MAX_BLOCK_DEPTH=2
SEARCH_CONCURRENCY=2
CACHE_TTL_MINUTES=10
```

정도로 시작하는 것을 권장합니다.
