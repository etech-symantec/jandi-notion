# JANDI → Notion + Broadcom KB 검색 v4.7
## Broadcom 완전 초기화 + 새 영어 인덱스 재구축

v4.7에서는 기존 Broadcom 제목 인덱스 180,477개도 재사용하지 않고
sitemap부터 새로 읽어서 영어 KB 제목 인덱스를 다시 만듭니다.

## 완전 초기화 시작

배포 후 한 번 호출:

`/api/broadcom?action=reset&token=REINDEX_TOKEN`

이 작업은:

1. Broadcom sitemap을 새로 읽음
2. `external/article/` URL 전체 목록을 새 plan으로 생성
3. 영어 제목만 새 title chunk에 저장
4. title rebuild 완료 후 새 `broadcom-index.json` 생성
5. 그 직후 새 제목 인덱스를 기준으로 body chunk rebuild 자동 시작
6. body도 영어 문서만 저장

## 진행

GitHub 5분 worker는 기존과 동일하게:

`/api/broadcom?action=next&token=REINDEX_TOKEN`

를 호출합니다.

`next`는 현재 phase를 보고 자동으로 처리합니다.

- phase=title → 제목 인덱스 다음 batch
- title 완료 → body rebuild 자동 시작
- phase=body → 본문 다음 batch

## 상태

`/api/broadcom?action=status&token=REINDEX_TOKEN`

응답:

- `phase: title`
- `phase: body`
- `phase: completed`

### title.state
- totalPages
- processedPages
- englishPages
- skippedNonEnglish
- failedPages
- progress

### title.finalIndex
- pageCount
- createdAt
- language=en

### body.state
- processedPages
- bodyIndexedPages
- skippedNonEnglish
- failedPages
- progress

## 영어 제목 판정

다음 문자가 제목 또는 URL slug에 있으면 제외:

- 일본어 Hiragana/Katakana
- CJK 한자
- 한글
- Cyrillic

`%E3%82...` 같은 깨진 percent-encoded 제목도 제외합니다.

## 주의

기존 final title index는 새 title rebuild가 완료될 때까지 검색에서 남아 있을 수 있습니다.
새 title rebuild가 완료되는 순간 새 영어 전용 `broadcom-index.json`으로 교체됩니다.

완전히 즉시 검색에서도 기존 KB를 없애고 싶다면 별도 delete API가 필요하지만,
운영 중 검색 공백을 피하기 위해 v4.7은 "새 인덱스 완성 후 교체" 방식을 사용합니다.
