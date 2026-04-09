# 2026-04-09 운동 JSON 저장 폐기 사유 및 코드 수정사항

## 1) 결론 요약

운동 세션 저장 경로에서 대용량 JSON(`detail`, `payload`) 의존을 중단하고,
정규화된 컬럼 중심 저장/조회로 전환했다.

- 저장: JSON 본문을 사실상 보내지 않음
- 조회(히스토리): JSONB 파싱 없이 스냅샷/점수/메트릭 테이블 기반 렌더링

---

## 2) JSON을 포기할 수밖에 없었던 이유

### A. 실제 장애 발생 (가장 직접적인 원인)

루틴 종료 시점에 아래 오류가 실제로 발생했다.

- `2026-04-09T12:30:46.142Z`
- `500 - request entity too large`
- `PayloadTooLargeError: request entity too large`
- (`raw-body` -> `body-parser` -> `jsonParser` 체인에서 실패)

즉, 운동 결과 JSON이 커지면 요청 자체가 서버 미들웨어에서 차단되었다.

### B. 데이터 중복 저장으로 인한 비효율

기존 구조는 동일 의미 데이터가 아래처럼 중복되는 경향이 있었다.

- 정규화 컬럼(`score`, `result_value`, `sample_count` 등)
- JSON 상세(`detail`, `payload`) 내부에도 유사 정보 재저장

중복은 DB 용량, 네트워크 전송량, 파싱 비용을 동시에 증가시켰다.

### C. 히스토리 UI의 JSON 결합도 증가

히스토리가 `detail/payload` 내부 형태에 의존하면
프론트/백엔드/DB 스키마가 강결합되고 변경 비용이 커진다.

이번 전환으로 히스토리는 테이블 데이터만으로 렌더링 가능해졌다.

### D. 운영 안정성 우선

운동 세션은 실시간/반복 데이터 특성상 payload가 급격히 커질 수 있다.
서비스 안정성을 위해서는 "상세 원본 전부 저장"보다
"필요 집계값 중심 저장"이 더 안전했다.

---

## 3) 코드 수정사항

## 3.1 요청 본문 한도/에러 처리

### `app.js`

- `BODY_LIMIT` 환경변수 도입 (`default: 5mb`)
- `express.urlencoded/json`에 `limit` 적용
- `parameterLimit` 설정

목적: 예외 상황 대응 폭을 넓히되, 근본적으로는 대용량 JSON 전송을 줄이는 방향으로 병행.

### `middleware/errorHandler.js`

- `PayloadTooLargeError`, `entity.too.large`, HTTP `413` 감지 로직 추가
- 413 응답 메시지를 별도로 반환하도록 개선

목적: 장애 원인 가시화 및 클라이언트 대응 명확화.

---

## 3.2 운동 저장 API (JSON 직접 저장 제거)

### `controllers/workout.js`

핵심 변경:

1. `session_event` 저장 시 `payload` 미사용
- stale abort 이벤트, 일반 이벤트, 세트 이벤트, 중단 이벤트 모두 `session_id/type/event_time` 중심 저장

2. `session_snapshot_score` 저장 시 `detail` 미사용
- INTERIM/FINAL 점수 모두 정규 컬럼만 저장

3. `session_snapshot_metric` 저장 시 `detail` 미사용
- 메트릭 집계 컬럼만 저장

4. `normalizeInterimSnapshots` 단순화
- `payload.detail.score_timeline` fallback 제거
- `interim_snapshots` 입력만 사용

5. 퀘스트 세트수 계산 방식 변경
- `req.body.set_records.length` 의존 제거
- 저장된 이벤트(`SET_RECORD`) 개수 기반으로 계산

6. 결과 조회(`getWorkoutResult`)에서도 JSON detail 조회 제거
- FINAL 스냅샷 점수/메트릭 정규 컬럼만 조회

---

## 3.3 운동 프론트 payload 축소

### `public/js/workout/session-buffer.js`

핵심 변경:

1. `addEvent(type)`로 축소
- 이벤트 객체 payload 제거

2. `generateMetricResults()`에서 metric `detail` 제거

3. `generateInterimSnapshots()` 최소화
- `timestamp_ms`, `score`만 생성
- breakdown/detail/result_unit 부가 JSON 제거

4. `export()`에서 대용량 상세 JSON 제거
- 삭제: `detail`, `set_records`
- 유지: `metric_results`, `interim_snapshots`, `events`(최소 필드)

---

## 3.4 히스토리 조회/UI의 JSONB 의존 제거

### `controllers/history.js`

핵심 변경:

1. FINAL 조회에서 `detail` 컬럼 선택 제거
- `session_snapshot_score.detail`
- `session_snapshot_metric.detail`

2. 이벤트 조회에서 `payload` 선택 제거
- `session_event.payload`

3. `buildTimelineFromSnapshots` 추가
- INTERIM 스냅샷 + 스코어 row로 타임라인 구성
- FINAL 스코어를 보조 포인트로 추가

4. 응답 필드 정리
- 제거: `rep_records`, `set_records`, `detail_events`, `detail`
- 유지: `session`, `metrics`, `timeline`, `session_events`, `routine_context`

### `public/js/history-page.js`

핵심 변경:

1. JSON 상세 파싱 유틸 제거
- `detail/payload` 기반 렌더 제거

2. 상세 모달 렌더 구조 전환
- 세션 요약
- FINAL 메트릭 목록
- 타임라인
- 이벤트 목록(시간/타입 중심)
- 루틴 컨텍스트

---

## 4) 영향 및 트레이드오프

### 기대 효과

- `request entity too large` 재발 가능성 감소
- 요청 payload 및 DB 저장량 감소
- 히스토리 로직 단순화 및 유지보수성 향상

### 감수한 점

- 프레임 단위/세부 원본(JSON) 재현성은 낮아짐
- 필요 시 별도 분석 파이프라인(압축, 배치, 오브젝트 스토리지) 도입 검토 필요

---

## 5) DB 스키마 관련 메모

현재 애플리케이션은 JSONB 컬럼에 값을 "직접" 넣지 않도록 변경되었지만,
스키마가 `NOT NULL DEFAULT '{}'` 인 경우 기본값 `{}` 자체는 저장될 수 있다.

즉,

- 애플리케이션 레벨: 대용량 JSON 저장 중단 완료
- 스키마 레벨: 컬럼/기본값 완전 제거 여부는 별도 마이그레이션 과제

---

## 6) 검증 기록

아래 점검을 수행했다.

- `node --check controllers/workout.js`
- `node --check public/js/workout/session-buffer.js`
- `node --check controllers/history.js`
- `node --check public/js/history-page.js`
- `rg` 검색으로 `controllers/workout.js` 저장 경로 내 `payload:`/`detail:` 직접 insert 제거 확인

