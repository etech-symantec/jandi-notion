# JANDI → Notion 검색 v3.4

기존 v3.3의 GitHub Actions 자동 분할 인덱싱 구조를 유지하면서 검색 결과 UI를 개선한 버전입니다.

## 변경점
- 잔디 기본 목록 10개
- 전체 검색 건수 표시
- 전체 결과 보기 웹페이지
- 웹페이지 검색어 강조
- 웹페이지 페이지당 10개 / 20개 선택
- 페이지 이동
- 기존 최종 인덱스 재사용 가능

## 웹 검색 주소
https://jandi-notion-search.vercel.app/search?q=ELK

## 직접 검색 API
https://jandi-notion-search.vercel.app/api/search?q=ELK&page=1&perPage=10

## 환경변수
MAX_RESULTS=10

## 배포
ZIP 내용을 GitHub 저장소에 덮어쓰고 main 브랜치에 push 후 Vercel Production 재배포하면 됩니다.

기존 final notion-index.json이 이미 있다면 전체 재인덱싱은 필요 없습니다.
