# OpenLayers 좌표수정기 DB/API 설계 초안

## 1) 필요한 DB 정보(맞습니다, 구조 알려주셔야 합니다)
아래 정보가 있으면 Oracle/Tibero 둘 다 연결 가능합니다.

- DB 벤더: `oracle` 또는 `tibero`
- 접속 정보: host, port, serviceName(SID), username, password
- 링크 테이블명: 예) `TB_LINK`
- 버텍스 테이블명: 예) `TB_VERTEX`
- PK/시퀀스/트리거 규칙 (특히 vertex PK 생성 방식)

## 2) 권장 테이블 구조

### 2.1 링크(라인) 테이블
```sql
CREATE TABLE TB_LINK (
    LINK_ID      VARCHAR2(50) PRIMARY KEY,
    LINK_NAME    VARCHAR2(200) NOT NULL,
    USE_YN       CHAR(1) DEFAULT 'Y',
    CREATED_AT   TIMESTAMP DEFAULT SYSTIMESTAMP,
    UPDATED_AT   TIMESTAMP
);
```

### 2.2 버텍스 테이블
```sql
CREATE TABLE TB_VERTEX (
    VERTEX_ID    VARCHAR2(50) PRIMARY KEY,
    LINK_ID      VARCHAR2(50) NOT NULL,
    SEQ_NO       NUMBER(10) NOT NULL,
    LON          NUMBER(15,10) NOT NULL,
    LAT          NUMBER(15,10) NOT NULL,
    CREATED_AT   TIMESTAMP DEFAULT SYSTIMESTAMP,
    UPDATED_AT   TIMESTAMP,
    CONSTRAINT FK_VERTEX_LINK FOREIGN KEY (LINK_ID) REFERENCES TB_LINK(LINK_ID)
);

CREATE INDEX IDX_VERTEX_LINK_SEQ ON TB_VERTEX (LINK_ID, SEQ_NO);
```

> 좌표계는 프론트와 동일하게 `EPSG:4326` (lon, lat) 사용.

## 3) API 계약(초안)

### 3.1 라인/버텍스 조회
- `GET /api/lines`

응답 예시
```json
[
  {
    "lineId": "LINE-101",
    "lineName": "Line-101",
    "vertices": [
      {"vertexId": "V101-1", "seqNo": 1, "lon": 126.9, "lat": 37.53},
      {"vertexId": "V101-2", "seqNo": 2, "lon": 126.93, "lat": 37.52}
    ]
  }
]
```

### 3.2 라인 버텍스 저장(전체 교체 방식)
- `PUT /api/lines/{lineId}`

요청 예시
```json
{
  "lineId": "LINE-101",
  "lineName": "Line-101",
  "linkTable": "TB_LINK",
  "vertexTable": "TB_VERTEX",
  "dbVendor": "oracle",
  "vertices": [
    {"seqNo": 1, "lon": 126.90001, "lat": 37.53001},
    {"seqNo": 2, "lon": 126.93001, "lat": 37.52001}
  ]
}
```

서버 처리 권장 순서
1. `TB_LINK` 존재 확인/수정
2. 해당 `LINK_ID`의 `TB_VERTEX` 기존 row 삭제
3. 요청 vertices를 `SEQ_NO` 순서대로 insert
4. 트랜잭션 커밋

## 4) 프론트 적용된 항목
- `.env` 기반 API/테이블 설정
- 조회 API 호출 + 실패 시 더미 fallback
- 저장 시 변경 좌표를 API payload로 전송
