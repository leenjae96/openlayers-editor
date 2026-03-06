# Server Template (Oracle / Tibero)

이 폴더는 백엔드 프로젝트에 복붙해서 쓰는 **설정 템플릿**입니다.

## 필요한 설정 파일
- `src/main/resources/application-oracle.properties.example`
- `src/main/resources/application-tibero.properties.example`

## 백엔드 필수 API
- `GET /api/lines`
- `PUT /api/lines/{lineId}`

DB 스키마와 요청/응답 샘플은 `docs/db-schema-and-api.md` 참고.
