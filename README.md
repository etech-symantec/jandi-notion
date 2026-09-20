# JANDI → Notion + Broadcom KB 검색 v4.9
## 실제 Broadcom 페이지 기준 영어 판별

v4.8까지는 일부 경우 URL slug가 영어처럼 보이면 실제 페이지를 열지 않고
영어 제목으로 인정할 수 있었습니다.

Broadcom은 URL이나 `<html lang="en">`이 영어처럼 보여도 실제 페이지가
일본어일 수 있으므로 v4.9에서는 URL과 HTML lang을 영어 판정의 positive
signal로 사용하지 않습니다.

## v4.9 title rebuild 방식

모든 article URL마다 실제 Broadcom 페이지를 fetch합니다.

판정 순서:

1. 실제 H1/H2/H3/og:title/title에서 제목 추출
2. 제목에 일본어/중국어/한글/Cyrillic 문자가 하나라도 있으면 제외
3. 실제 article/main/content 본문 최대 8,000자를 추출
4. 본문의 Latin 문자와 localized script 비율 계산
5. localized 문자가 과도하면 제외
6. 영어로 판정된 실제 페이지의 제목만 title index에 저장

`<html lang="en">`은 영어 여부 판정에 사용하지 않습니다.

## 속도/timeout 안전 설정

실제 페이지를 모두 열기 때문에 batch를 낮췄습니다.

BROADCOM_TITLE_RUNTIME_BATCH_SIZE=20
BROADCOM_TITLE_CONCURRENCY=5

즉 GitHub worker 1회당 기본 20개 실제 페이지를 검사합니다.

## 배포 후

이전 title chunk를 재사용하지 않도록 반드시 다시 reset:

`/api/broadcom?action=reset&token=REINDEX_TOKEN`

상태:

`/api/broadcom?action=status&token=REINDEX_TOKEN`

첫 worker 성공 후 예:

- processedPages: 20
- englishPages: 실제 영어 판정 수
- skippedNonEnglish: 실제 일본어/중국어 등 제외 수
- failedPages: fetch 실패 수

이제 `englishPages == processedPages`가 계속 나오는 것이 당연한 구조가 아니며,
실제 localized 페이지가 발견되면 `skippedNonEnglish`가 증가합니다.

## 완전 초기화 유지

reset 시 body는:
- status = waiting_for_title
- indexedPages = 0
- chunkCount = 0

새 영어 title index가 완성되면 body rebuild가 자동 시작됩니다.
