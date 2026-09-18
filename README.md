# JANDI → Notion 검색 Webhook

잔디에서 아래처럼 입력하면 Notion 페이지를 검색합니다.

```text
/notion proxysg ssl
```

흐름:

```text
JANDI Team Outgoing Webhook
        ↓
Vercel /api/notion
        ↓
Notion Search API
        ↓
JANDI 검색 결과
```

## 1. Notion Integration 생성

1. Notion에서 Integration을 생성합니다.
2. Internal Integration Secret을 복사합니다.
3. 검색하려는 페이지/상위 페이지에서 Integration에 접근 권한을 줍니다.
4. Vercel 환경변수 `NOTION_TOKEN`에 Secret을 입력합니다.

> 중요: Notion API는 Integration이 접근할 수 있는 콘텐츠만 검색합니다.

## 2. Vercel 배포

이 폴더를 GitHub 저장소에 올린 뒤 Vercel 프로젝트로 연결합니다.

Vercel → Project → Settings → Environment Variables 에 아래 값을 등록합니다.

| Name | Value |
|---|---|
| NOTION_TOKEN | Notion Integration Secret |
| JANDI_TOKEN | 잔디 Team Outgoing Webhook의 Token |
| MAX_RESULTS | 5 |

환경변수 저장 후 반드시 Redeploy 합니다.

배포 주소가 아래라고 가정합니다.

```text
https://jandi-notion-search.vercel.app
```

브라우저에서 다음 주소를 열어 상태를 확인할 수 있습니다.

```text
https://jandi-notion-search.vercel.app/api/notion
```

정상이면 `ok: true`가 표시됩니다.

## 3. 잔디 Team Outgoing Webhook 설정

잔디:

```text
우측 상단 Tool
→ 잔디 커넥트
→ 팀 Webhook 발신 (Team Outgoing Webhook)
→ 연동하기
```

권장 설정:

```text
시작 키워드: notion
파라미터 값: 검색어
파라미터 설명: Notion 문서 검색
URL: https://내프로젝트.vercel.app/api/notion
```

잔디 화면에 표시된 Token을 복사하여 Vercel의 `JANDI_TOKEN` 값과 동일하게 설정합니다.

## 4. 테스트

잔디의 '나와의 대화'에서:

```text
/notion proxysg
```

또는:

```text
/notion cyberark duo
```

처럼 입력합니다.

검색 결과는 최근 수정 순으로 최대 `MAX_RESULTS`개 표시됩니다.

## 5. 문제 해결

### "검색 결과가 없습니다"

가장 먼저 검색 대상 Notion 페이지가 Integration에 공유되어 있는지 확인합니다.

### "Notion API 토큰을 확인해주세요"

Vercel `NOTION_TOKEN` 값과 Notion Integration Secret을 확인하고 Redeploy 합니다.

### "인증되지 않은 잔디 Webhook 요청"

잔디 Team Outgoing Webhook 화면의 Token과 Vercel `JANDI_TOKEN` 값이 같은지 확인합니다.

### 브라우저에서는 정상인데 잔디에 결과가 안 나옴

Vercel → Project → Logs에서 `/api/notion` 호출이 들어오는지 확인합니다.

또한 잔디 명령어는 직접 문자열만 입력하기보다 `/` 명령어 목록에서 등록된 `notion` 커맨드를 선택하여 사용하는 것이 안전합니다.

## 주의: 검색 범위

현재 버전은 Notion 공식 `/v1/search` API를 이용합니다.
따라서 제목/Notion 검색 인덱스 중심의 검색이며, 모든 블록 본문을 별도로 내려받아 완전한 전문 검색을 수행하는 방식은 아닙니다.

본문까지 깊게 찾고 싶다면 다음 버전에서:
1. 접근 가능한 페이지 목록 수집
2. 각 페이지의 block children 조회
3. 본문 텍스트 인덱싱
4. `/notion-text 검색어`
형태로 확장할 수 있습니다.
