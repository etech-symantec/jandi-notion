# JANDI → Notion + Broadcom KB 검색 v3.9

## 검색 대상
1. 기존 Notion 최종 인덱스
2. `https://knowledge.broadcom.com/external/article/` Broadcom KB 제목 인덱스

예:
`/노션 Licensing`

검색 결과에는:
- `· N` = Notion
- `· B` = Broadcom KB

가 붙습니다.

## Broadcom 인덱스 생성

수동:
`/api/broadcom/reindex?token=REINDEX_TOKEN`

Broadcom 공개 sitemap에서 `external/article/` URL을 수집하고,
URL slug를 제목으로 변환하여 가벼운 제목 인덱스를 생성합니다.

slug가 없는 일부 URL은 `BROADCOM_TITLE_FETCH_LIMIT` 개까지 실제 페이지를 읽어 제목을 보강합니다.

## 자동 갱신

기존 08:00 / 12:00 / 15:00 / 19:00 KST scheduled refresh workflow에서
Notion 전체 갱신 시작과 함께 Broadcom KB 제목 인덱스도 갱신합니다.

## AND / OR
기존과 동일:
- `&` = AND
- `|` = OR

Notion + Broadcom 양쪽에 동일한 조건을 적용합니다.

## 주의
Broadcom의 sitemap 구조가 변경되거나 일부 KB가 sitemap에 포함되지 않을 수 있습니다.
그 경우 `BROADCOM_EXTRA_URLS`에 특정 KB URL을 추가할 수 있습니다.

예:
`BROADCOM_EXTRA_URLS=https://knowledge.broadcom.com/external/article/168282/error-message-licensing-license-key-not.html`

기존 Notion 인덱스는 재생성할 필요가 없습니다.
Broadcom 인덱스만 최초 1회 생성하면 즉시 통합 검색됩니다.
