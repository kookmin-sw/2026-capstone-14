# 2026-04-20 루틴 저장 로직(session-per-set) 버그 전면 수정

## 1) 기준 문서
- `docs/database_structure.md`
- `docs/2026-04-09_루틴_실행_로직_DB_검증_및_수정.md`

핵심 기준:
- 루틴 실행 계층은 `routine_instance -> routine_step_instance -> workout_set -> workout_session` 구조를 따른다.
- `workout_set`은 세트 단위 실행 결과를 가진다.
- `workout_session`은 세트별 실제 채점 세션을 대표해야 한다.

---

## 2) 실제 증상
히스토리의 루틴 순서에서 아래와 같은 비정상 표시가 발생했다.

- `세트 1개 · 세션 0개`
- 같은 루틴의 서로 다른 항목이 동일 `session_id` 상세로 이동
- 루틴 완료는 되었지만 일부 세트가 세션과 연결되지 않음

---

## 3) 원인

### 원인 A: 백엔드가 세트 전환 시 기존 세션의 `set_id`를 이동
기존 `recordWorkoutSet` 흐름은 세트 완료 후 같은 `workout_session` row를 유지한 채 `set_id`만 다음 세트/단계로 옮겼다.

결과:
- 앞 세트에서 세션 연결이 사라지고 마지막 세트만 세션이 남는 형태가 발생
- 히스토리에서 세트-세션 매핑이 깨져 `세션 0개`가 생김

### 원인 B: 프론트가 서버의 `next_session`을 반영하지 않음
백엔드가 다음 세트용 세션을 생성하더라도 프론트 `state.sessionId`는 이전 세션 ID를 계속 사용했다.

결과:
- 다음 세트 저장 요청이 이미 종료된 세션으로 들어가거나
- 세트별 세션 분리가 클라이언트에서 이어지지 못함

---

## 4) 수정 내용

### A. 백엔드 (`controllers/workout.js`)

1. 세트 완료 시 현재 세션을 즉시 종료 저장
- `persistSessionCompletionPayload(...)` 추가
- 세트 완료 payload를 사용해:
  - `session_event`
  - `session_snapshot` / `session_snapshot_score` / `session_snapshot_metric`
  - `workout_session(status=DONE, final_score, result fields)`
  를 저장

2. 다음 진행은 “세션 이동”이 아니라 “새 세션 생성”으로 변경
- `createRoutineRunningSession(...)` 추가
- `NEXT_SET`, `NEXT_STEP`에서 기존 세션의 `set_id`를 바꾸지 않고
  다음 `set_id`에 연결된 새 `workout_session`(`RUNNING`)을 생성
- 응답에 `routine.next_session` 포함

3. 루틴 완료 점수 반영 보정
- `ROUTINE_COMPLETE` 시 `routine_instance.total_score` 업데이트

### B. 프론트 (`public/js/workout/session-controller.js`)

1. 루틴 세트 저장 payload를 세션 버퍼 기반으로 전송
- `recordRoutineSetCompletion(...)`이 `sessionPayload`를 함께 전송
- 세트 저장 시 버퍼 export 데이터를 `/set`에 포함

2. 서버 응답의 `next_session`으로 세션 ID 교체
- `resetSessionBufferForSession(...)` 유틸 추가
- `NEXT_SET`/`NEXT_STEP` 응답을 받으면:
  - `state.sessionId`를 `next_session.session_id`로 교체
  - 새로운 `SessionBuffer` 생성
  - 이후 이벤트/저장은 새 세션 기준으로 진행

3. 중복 저장 방지
- `state.routineSetSyncPending` 락으로 중복 `/set` 요청 차단

---

## 5) 왜 이렇게 바꿨는가
- `workout_session`을 세트 단위로 분리해야 히스토리에서 `set_id -> session` 매핑이 안정적으로 유지된다.
- `set_id`를 이동시키는 방식은 과거 세트의 연결을 잃기 쉽고, 같은 세션이 여러 단계를 덮어써 히스토리 왜곡을 만든다.
- 서버와 클라이언트가 동일한 세션 경계를 공유해야 “세트별 상세 진입”이 정확해진다.

---

## 6) 검증
- 문법 체크:
  - `node --check controllers/workout.js`
  - `node --check public/js/workout/session-controller.js`
- 테스트:
  - `node --test test/session-buffer.test.js test/history-metric-series.test.js` 통과

---

## 7) 변경 파일
- `controllers/workout.js`
- `public/js/workout/session-controller.js`
- `docs/2026-04-20_routine_storage_session_split_bugfix.md`
