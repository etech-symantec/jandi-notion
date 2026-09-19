# JANDI → Notion + Broadcom KB 검색 v4.4
## Broadcom 실제 본문 기준 영어 전용 필터

Broadcom localized KB가 `<html lang="en">`으로 표시되는 문제가 있어
HTML `lang` 속성을 영어 판정 기준에서 제외했습니다.

## 영어 판정 방식

Broadcom KB 제목과 실제 본문 텍스트를 직접 분석합니다.

다음 문자는 localized script로 판단합니다.

- 일본어 Hiragana / Katakana
- CJK 한자
- 한글
- Cyrillic

### 제목

제목에 위 문자가 포함되면 바로 제외합니다.

예:
`マシン SSL 証明書の期限切れ...`
→ 제외

### 본문

본문 앞부분 최대 8,000자를 검사해 Latin 문자와 localized script 비율을 계산합니다.

- 비라틴 문자가 일정 개수 이상이고 8% 이상이면 제외
- 비라틴 문자가 본문에서 20% 이상이면 강하게 제외
- 충분히 긴 본문인데 Latin 비율이 85% 미만이면 제외

따라서 HTML에 `lang="en"`이라고 되어 있어도 실제 내용이 일본어라면 인덱싱되지 않습니다.

## 기존 일본어 KB 제거

배포 후 Broadcom 배치를 강제로 새로 시작하세요.

`/api/broadcom?action=start&token=REINDEX_TOKEN&force=true`

GitHub Actions가 5분 간격으로 다음 배치를 처리합니다.

상태 확인:

`/api/broadcom?action=status&token=REINDEX_TOKEN`

`status=completed`가 되면 기존 일본어/깨진 KB가 빠진 새 인덱스로 교체됩니다.

## 기존 기능 유지

- Notion 5개 + KB 5개
- [Notion] / [KB]
- KB 본문 검색
- 웹 전체 / Notion / KB 필터
- 출처 태그 클릭 필터
- AND `&`
- OR `|`
- 자동 정기 갱신
