# JANDI → Notion 검색 v3.3
## Vercel Hobby + GitHub Actions 자동 분할 인덱싱

Vercel Hobby 플랜의 Cron 제한을 피하기 위해 Vercel Cron을 완전히 제거했습니다.

대신 GitHub Actions가 약 5분마다 현재 인덱싱 상태를 확인하고,
`running` 상태이면 Vercel의 `/api/reindex/next`를 한 번 호출합니다.

```text
사용자
  ↓
/reindex → 새 인덱싱 시작
  ↓
447개 페이지 목록을 Blob에 저장
  ↓
브라우저 종료 가능

GitHub Actions (약 5분마다)
  ↓
/api/reindex/status
  ↓
status=running ?
  ├─ 아니오 → 종료
  └─ 예
      ↓
    /api/reindex/next
      ↓
    15페이지 처리
      ↓
    Blob chunk 저장
      ↓
    다음 GitHub Actions 실행에서 계속
```

---

# 1. GitHub에 v3.3 업로드

ZIP 내용을 현재 저장소:

```text
etech-symantec/jandi-notion
```

에 그대로 덮어씁니다.

특히 새로 추가된 파일:

```text
.github/workflows/notion-reindex.yml
```

이 반드시 GitHub 저장소에 올라가야 합니다.

`vercel.json`에서는 Vercel Cron 설정이 제거되어 있으므로
Hobby 플랜에서도 Cron 관련 배포 오류가 발생하지 않습니다.

---

# 2. GitHub Secret 등록

GitHub 저장소에서:

```text
Settings
→ Secrets and variables
→ Actions
→ Repository secrets
→ New repository secret
```

을 선택합니다.

Name:

```text
REINDEX_TOKEN
```

Value:

```text
Vercel에 설정한 REINDEX_TOKEN과 완전히 동일한 값
```

을 입력합니다.

중요:

```text
GitHub REINDEX_TOKEN
=
Vercel REINDEX_TOKEN
```

이어야 합니다.

GitHub Actions 로그에는 secret 자체가 노출되지 않습니다.

---

# 3. Vercel 환경변수

Vercel에는 기존 값만 있으면 됩니다.

```text
NOTION_TOKEN=...
JANDI_TOKEN=...
REINDEX_TOKEN=...

MAX_RESULTS=5
MAX_INDEX_PAGES=1000
REINDEX_BATCH_SIZE=15
MAX_BLOCKS_PER_PAGE=500
MAX_BLOCK_DEPTH=5
INDEX_CONCURRENCY=3

DEBUG_TOKEN=...
```

v3.3에서는 더 이상:

```text
CRON_SECRET
```

이 필요하지 않습니다.

남아 있어도 동작에는 영향이 없지만 삭제해도 됩니다.

---

# 4. Vercel 재배포

GitHub에 v3.3을 commit/push한 뒤 Vercel에서 자동 배포되거나,
수동 Create Deployment에서:

```text
main
```

을 입력하여 Production으로 배포합니다.

v3.3의 `vercel.json`에는 5분 Cron이 없으므로 Hobby 플랜에서
다음 오류가 발생하지 않아야 합니다.

```text
Hobby accounts are limited to daily cron jobs
```

---

# 5. GitHub Actions 확인

GitHub 저장소:

```text
Actions
→ Notion Reindex Worker
```

가 보여야 합니다.

처음에는 오른쪽 또는 상단의:

```text
Run workflow
```

버튼으로 수동 실행해보는 것을 권장합니다.

정상 로그:

```text
Check reindex status
Current state: status=running, progress=6.7%, processed=30/447

Process next batch
Action: batch_completed
Progress: 10.1% (45/447)
```

처럼 보입니다.

---

# 6. 인덱싱 시작

Vercel:

```text
https://jandi-notion-search.vercel.app/reindex?token=REINDEX_TOKEN값
```

에서:

```text
새 인덱싱 시작
```

을 한 번 누릅니다.

이 단계에서 전체 Notion 페이지 목록만 수집하고 상태를 `running`으로 저장합니다.

그 후 브라우저를 닫아도 됩니다.

---

# 7. 자동 진행

GitHub Actions workflow에는:

```yaml
schedule:
  - cron: "*/5 * * * *"
```

가 들어 있습니다.

GitHub scheduled workflow는 UTC 기준으로 동작하며,
5분마다 실행되도록 요청합니다.

단, GitHub Actions scheduled workflow는 정확히 5분마다 실행된다는 보장은 없고
GitHub 부하에 따라 몇 분 이상 지연될 수 있습니다.

이 기능은 검색 정확도에는 영향을 주지 않고,
전체 인덱싱 완료 시간이 조금 늘어날 수 있다는 의미입니다.

---

# 8. 진행 상태 확인

언제든:

```text
https://jandi-notion-search.vercel.app/api/reindex/status?token=REINDEX_TOKEN값
```

또는 `/reindex` 화면에서 상태 확인을 누릅니다.

예:

```json
{
  "status": "running",
  "totalPages": 447,
  "processedPages": 180,
  "failedPages": 2,
  "progress": 40.3
}
```

---

# 9. 자동 진행 일시정지

기존 v3.2/v3.1의 control API는 그대로 사용할 수 있습니다.

중지:

```text
/api/reindex/control?action=pause&token=REINDEX_TOKEN값
```

GitHub Actions는 `status=paused`이면 `/next`를 호출하지 않습니다.

재개:

```text
/api/reindex/control?action=resume&token=REINDEX_TOKEN값
```

---

# 10. 즉시 한 배치 진행

5분을 기다리지 않고 바로 진행하려면:

```text
/api/reindex/next?token=REINDEX_TOKEN값
```

또는 GitHub:

```text
Actions
→ Notion Reindex Worker
→ Run workflow
```

를 실행할 수 있습니다.

---

# 11. 전체 완료

마지막 배치에서 자동으로 모든 chunk를 합쳐:

```text
jandi-notion/notion-index.json
```

을 생성합니다.

상태:

```text
status: completed
progress: 100
```

이 되면 이후 GitHub Actions는 상태만 확인하고 아무 작업도 하지 않습니다.

잔디 검색:

```text
/노션 tcp auto buffer
```

는 최종 인덱스에서 즉시 검색합니다.

---

# 12. 현재 447페이지 기준 예상

기본:

```text
REINDEX_BATCH_SIZE=15
```

이면 약:

```text
447 / 15 ≈ 30회
```

의 배치가 필요합니다.

GitHub Actions가 평균 5분 간격이라면 이론적으로 약 2시간 30분이지만,
scheduled workflow 지연을 고려하면 더 걸릴 수 있습니다.

빨리 끝내고 싶다면 GitHub Actions의 `Run workflow`를 중간중간 수동 실행하거나,
`/api/reindex/next`를 직접 호출하면 됩니다.
