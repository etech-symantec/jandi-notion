# JANDI → Notion 검색 v3.5

## 변경점
- 잔디에는 본문 미리보기 없이 제목만 최대 10개 표시
- `&` = AND
- `|` = OR
- AND가 OR보다 우선
- 전체 검색 건수 표시
- 전체 결과 웹페이지 유지
- 웹에서는 본문 미리보기와 검색어 강조 유지

## 예시
- `ELK & Ubuntu` → 두 조건 모두 포함
- `ELK | Kibana` → 둘 중 하나 포함
- `ELK & Ubuntu | Kibana` → `(ELK AND Ubuntu) OR Kibana`

기존 447페이지 인덱스를 그대로 사용할 수 있으므로 재인덱싱은 필요 없습니다.
