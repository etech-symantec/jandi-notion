# JANDI → Notion + Broadcom KB 검색 v4.1

## 1. Broadcom도 배치 분할

Broadcom KB 인덱싱도 Notion처럼 분할 처리합니다.

- `/api/broadcom/start?token=...`
- `/api/broadcom/next?token=...`
- `/api/broadcom/status?token=...`

기본 배치 크기:
`BROADCOM_BATCH_SIZE=15`

5분 GitHub worker가 Notion과 Broadcom의 `running` 작업을 각각 확인해 다음 배치를 처리합니다.

## 2. 잔디 검색 결과

Notion 최대 5개 + KB 최대 5개를 각각 표시합니다.

예:

Notion 5/23
1. [Notion] ...
2. [Notion] ...

KB 5/18
1. [KB] ...
2. [KB] ...

전체 결과는 웹페이지에서 확인합니다.

## 3. 웹 검색 필터

상단에:
- 전체
- Notion
- KB

필터 버튼을 추가했습니다.

또 각 검색 결과 카드의 출처 태그를 클릭해도 해당 출처만 필터링됩니다.

태그 스타일:
- Notion: 흰색 배경 + 검은 글씨
- KB: Broadcom 계열 빨간색 배경 + 흰 글씨

## 4. 기존 기능 유지

- `&` = AND
- `|` = OR
- 제목/본문 검색
- 검색어 강조
- 페이지당 10/20개
- 08:00 / 12:00 / 15:00 / 19:00 KST 자동 갱신

## 5. 최초 Broadcom 인덱싱

배포 후:
`/api/broadcom/start?token=REINDEX_TOKEN`

을 한 번 호출하면 됩니다.

그 뒤 GitHub Actions의 5분 worker가 자동으로 `/api/broadcom/next`를 반복 호출해서 완료합니다.

상태 확인:
`/api/broadcom/status?token=REINDEX_TOKEN`
