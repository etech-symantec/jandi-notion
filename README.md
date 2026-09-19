# JANDI → Notion 검색 v3.8

## 자동 전체 갱신 시간

한국시간(KST) 기준 매일:

- 08:00
- 12:00
- 15:00
- 19:00

에 GitHub Actions가 자동으로 새 전체 인덱싱을 시작합니다.

GitHub Actions cron은 UTC 기준이므로 실제 workflow에는 다음과 같이 저장됩니다.

- 08:00 KST → 23:00 UTC (전날)
- 12:00 KST → 03:00 UTC
- 15:00 KST → 06:00 UTC
- 19:00 KST → 10:00 UTC

## 동작 구조

1. 지정 시간에 `.github/workflows/notion-scheduled-refresh.yml` 실행
2. 현재 `/api/reindex/status` 확인
3. `completed` 또는 작업 없음 → `/api/reindex/start` 호출
4. `running` 또는 `paused` → 기존 작업 보호를 위해 새 시작 생략
5. 기존 `notion-reindex.yml` worker가 약 5분마다 다음 배치를 처리
6. 모든 배치 완료 후 최종 `notion-index.json` 교체

## GitHub Secret

Repository secret:

`REINDEX_TOKEN`

은 Vercel의 `REINDEX_TOKEN`과 동일해야 합니다.

## 수동 강제 실행

GitHub:

Actions → Notion Scheduled Full Refresh → Run workflow

에서 `force=true`를 선택하면 진행 중 상태와 관계없이 새 인덱싱 시작 요청을 보낼 수 있습니다.

일반 운영에서는 force 사용을 권장하지 않습니다.

## 주의

GitHub Actions의 scheduled workflow는 지정 시각에 실행되도록 예약되지만,
GitHub 부하 상황에 따라 실제 시작이 몇 분 지연될 수 있습니다.

기존 447페이지 최종 인덱스와 검색 기능은 그대로 유지됩니다.
