# JANDI → Notion + Broadcom KB 검색 v4.11

## 구성

초기 Broadcom 전체 구축은 GitHub Actions를 사용하지 않습니다.

초기 구축:
Windows PC → Vercel API → Vercel Blob

운영:
GitHub Actions 하루 1회 → Notion refresh + Broadcom 변경분 refresh

## 1. 배포

v4.11 파일을 GitHub main에 반영하고 Vercel 배포가 완료될 때까지 기다립니다.

기존 5분 cron workflow는 제거됩니다.

새 GitHub Actions cron:
`17 3 * * *`

즉 UTC 03:17 = KST 12:17 하루 1회입니다.

## 2. Broadcom 완전 초기화

이미 v4.9/v4.10에서 reset 후 진행 중이면 다시 reset하지 않아도 됩니다.

새로 시작하려면:

`/api/broadcom?action=reset&token=REINDEX_TOKEN`

## 3. Windows PC에서 초기 구축

ZIP의:

`tools/start_full_index.cmd`

를 더블클릭합니다.

처음 실행 시 REINDEX_TOKEN을 물어봅니다.

화면 예:

Phase        : TITLE
Total        : 180477
Processed    : 12840
English      : 11523
Non-English  : 1297
Failed       : 20
Progress     : 7.1%

TITLE 완료 후 서버가 BODY phase를 자동 시작합니다.
BODY까지 완료되면 프로그램이 자동 종료됩니다.

중간에 Ctrl+C 또는 창을 닫아도 됩니다.
진행 상태와 chunk는 Vercel Blob에 있으므로 다시 실행하면 이어서 진행합니다.

## 4. GitHub Actions 사용

초기 전체 구축은 Windows 프로그램이 처리하므로 GitHub Actions 사용량은 0분입니다.

초기 구축 이후에는 하루 한 번만 Actions가 실행됩니다.

### Notion
- 상태 확인
- 필요 시 reindex 시작
- 작은 batch를 최대 20회 진행

### Broadcom
- `daily_start`
- sitemap 새로 확인
- 기존 영어 title index와 URL/lastmod 비교
- 신규 URL 및 lastmod 변경 URL만 plan 생성
- sitemap에서 제거된 URL 탐지
- `daily_next`에서 실제 페이지 fetch
- 제목 + 본문 sample로 영어 여부 재검사
- 영어면 title index 갱신
- localized 페이지로 바뀌면 title index에서 제거
- sitemap에서 삭제된 KB도 제거

기본:
`BROADCOM_DAILY_BATCH_SIZE=20`

한 번의 daily run에서 최대 20 batch까지 처리합니다.

## 5. 상태 확인

`/api/broadcom?action=status&token=REINDEX_TOKEN`

Full build:
- phase
- title.state
- body.state

Daily:
- daily.status
- daily.totalChanged
- daily.processedChanged
- daily.totalRemoved
- daily.progress

## 6. 영어 판별

Broadcom 실제 페이지를 반드시 fetch합니다.

URL slug와 `<html lang="en">`만으로 영어를 판정하지 않습니다.
실제 제목과 본문 sample의 문자 비율로 localized 페이지를 제외합니다.
