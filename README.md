# JANDI → Notion + Broadcom KB 검색 v4.10
## GitHub worker 10회 연속 처리

Broadcom rebuild가 active일 때 GitHub의 5분 worker 한 번이
`/api/broadcom?action=next`를 최대 10회 연속 호출합니다.

기본 제목 설정:
- BROADCOM_TITLE_RUNTIME_BATCH_SIZE=20
- 1회 next = 실제 Broadcom 페이지 최대 20개 검사
- worker 1회 = 최대 10 next
- 즉 최대 200페이지/worker

## 예상 속도

180,477 / 200 ≈ 903회 worker

5분마다 실행된다고 가정하면 약 3.1일 수준입니다.
실제 GitHub scheduled workflow 지연과 페이지 응답 속도에 따라 더 길어질 수 있습니다.

## 안정성

각 next 호출:
- curl max-time 260초
- timeout 또는 HTTP 오류가 발생하면 해당 worker의 반복을 즉시 중단
- 다음 scheduled worker가 이어서 계속 처리
- 각 호출 사이 1초 대기

## 배포 후

현재 진행 중인 Broadcom rebuild를 reset할 필요 없습니다.

v4.10 배포 후 다음 GitHub worker부터 현재 processedPages 위치에서
한 번에 최대 10개 batch를 연속 처리합니다.

예:
processedPages 20
→ 다음 worker 성공 시 최대 220
→ 그다음 최대 420 ...

실제 localized 페이지는 계속 `skippedNonEnglish`로 제외됩니다.
