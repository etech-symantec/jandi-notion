# JANDI → Notion + Broadcom KB 검색 v4.3
## Broadcom 영어 KB만 인덱싱

Broadcom Knowledge Base에서 영어 페이지 이외의 페이지를 제외합니다.

### 필터 방식

1. sitemap URL 단계
- 일본어/중국어/한국어/키릴 문자 등이 포함된 localized slug는 수집 대상에서 제외

2. 실제 페이지 단계
- `<html lang>` 또는 language meta가 있으면 `en` 계열만 허용
- 제목에 일본어/중국어/한국어/키릴 문자가 있으면 제외
- 퍼센트 인코딩 문자열이 제목으로 남아 있으면 제외
- 본문 샘플에서 비라틴 문자가 과도하게 많으면 제외

3. 기존 인덱스 정리
- 이전 인덱스에서 재사용되는 레코드도 영어 여부 검사
- 최종 Broadcom index를 합칠 때 영어 레코드만 저장
- 따라서 기존 일본어/깨진 KB도 다음 전체 Broadcom 배치 완료 시 제거됨

## 배포 후 해야 할 일

Broadcom 배치 작업을 새로 시작:

`/api/broadcom?action=start&token=REINDEX_TOKEN&force=true`

이후 기존 GitHub Actions 5분 worker가 `next` 배치를 이어서 처리합니다.

상태 확인:

`/api/broadcom?action=status&token=REINDEX_TOKEN`

`status=completed`가 되면 새 영어 전용 KB 인덱스로 교체됩니다.

## 나머지 기능 유지
- Notion 5개 + KB 5개 잔디 출력
- [Notion] / [KB] 표시
- Broadcom 본문 검색
- 웹 전체/Notion/KB 필터
- 태그 클릭 필터
- AND `&`, OR `|`
- 자동 갱신
