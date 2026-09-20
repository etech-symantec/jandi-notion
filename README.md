# JANDI → Notion + Broadcom KB 검색 v4.12
## 일반 검색 = exact phrase

검색어에 `&` 또는 `|`가 없으면 입력한 전체 문자열을 하나의 phrase로 검색합니다.

예:

`reporter license`

→ 다음 문구가 제목 또는 본문에 연속으로 존재할 때만 검색:

`reporter license`

다음처럼 각각 따로 존재하는 문서는 검색하지 않습니다:

- reporter
- license

즉 기존의 token OR 성격을 제거했습니다.

## 명시적 Boolean 검색은 그대로 유지

AND:

`reporter & license`

→ reporter와 license가 둘 다 존재해야 함

OR:

`reporter | license`

→ reporter 또는 license 중 하나 이상

혼합:

`reporter & license | reporter server`

→ 기존 AND 우선 규칙 유지

## 적용 범위

- Notion 제목/본문
- Broadcom title index
- Broadcom body chunk index
- JANDI 검색
- 웹 검색

## 나머지 v4.11 기능 유지

- 초기 Broadcom 구축: Windows `tools/start_full_index.cmd`
- GitHub Actions: 하루 1회
- Broadcom daily sitemap lastmod 증분 갱신
- 실제 Broadcom 페이지 기준 영어 판별
- Notion 5개 + KB 5개
- 웹 전체 / Notion / KB 필터
