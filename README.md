# JANDI → Notion + Broadcom KB 검색 v4.5

## GitHub Actions timeout 안정화

증상:
- `Process next batch`
- `curl: (28) Operation timed out after 290002 milliseconds`
- 약 5분 후 GitHub worker 실패

원인:
기존 Notion reindex state에 `batchSize=15`가 저장된 상태에서
한 번의 `/api/reindex/next` 요청이 너무 오래 걸려 Vercel Hobby의
300초 함수 제한에 가까워진 경우입니다.

## 수정

- 기존 state의 batchSize가 15여도 실제 한 요청에서는 최대 5페이지만 처리
- 기본값: `REINDEX_RUNTIME_BATCH_SIZE=5`
- GitHub curl timeout: 260초
- timeout이나 일시적인 HTTP 오류는 warning 처리
- 다음 scheduled worker가 이어서 재시도

중요:
현재 진행 중인 Notion reindex를 취소하거나 새로 시작할 필요가 없습니다.
v4.5 배포 후 다음 worker부터 현재 `nextIndex` 위치에서 계속 진행됩니다.

기존 기능은 그대로 유지됩니다.
