# JANDI → Notion + Broadcom KB 검색 v4.8
## 진짜 완전 초기화

v4.7 상태 출력에서 과거 body state가 `running`으로 남는 문제가 확인되어
reset 동작을 강화했습니다.

## v4.8 reset 동작

`/api/broadcom?action=reset&token=REINDEX_TOKEN`

호출 즉시:

1. 기존 body manifest를 빈 manifest로 덮어씀
2. body state를 `waiting_for_title`로 초기화
3. 기존 body chunk는 manifest에서 참조하지 않으므로 검색/재사용되지 않음
4. Broadcom sitemap을 다시 읽어 새 title plan 생성
5. 영어 제목 인덱스를 처음부터 재구축
6. 제목 완료 후 body manifest를 다시 빈 상태로 시작
7. 새 영어 제목 인덱스를 기준으로 본문을 처음부터 구축

따라서 이전 v4.6/v4.7 body 상태나 chunk는 새 검색 결과에 섞이지 않습니다.

## reset 직후 정상 상태 예

phase: title

title.state:
- status: running
- processedPages: 0

body.state:
- status: waiting_for_title
- processedPages: 0
- bodyIndexedPages: 0

body.index:
- indexedPages: 0
- chunkCount: 0

## 제목 작업 진행

GitHub 5분 worker가 `/api/broadcom?action=next...`를 호출하면:

- phase=title → 제목 100개 기본 처리
- title 완료 → 새 영어 final title index 생성
- body state 자동으로 새로 시작
- phase=body → 본문 chunk 생성

## 참고

Blob의 과거 physical chunk 파일 자체를 삭제하는 API는 사용하지 않습니다.
대신 새 manifest에서 과거 chunk를 완전히 참조 해제하므로 기능상 완전 초기화됩니다.
이 방식이 Vercel Hobby 환경에서 더 안전하고 빠릅니다.
