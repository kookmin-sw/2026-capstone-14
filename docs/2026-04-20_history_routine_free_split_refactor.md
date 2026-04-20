# 히스토리 탭 자유운동/루틴운동 표기 분리 개편 기록

## 1. 문서 정보
- 작성일: 2026-04-20
- 범위: 히스토리 목록/상세에서 자유운동과 루틴운동의 표현 분리
- 목적: 같은 형태로 보이던 운동 기록을 유형별로 구분해, 사용자가 기록 맥락을 즉시 이해하도록 한다.

## 2. 문제 정의
기존 히스토리 탭은 `workout_session` 단위 중심으로 화면이 구성되어 있어, 아래 문제가 있었다.

1. 자유운동과 루틴운동이 카드 레벨에서 거의 동일하게 보인다.
2. 루틴운동은 실제로 여러 운동 세션의 묶음인데, 사용자에게는 단일 세션처럼 인지된다.
3. 루틴에서 어떤 순서로 운동했는지(예: 스쿼트 n회 -> 푸쉬업 n회)를 빠르게 보기 어렵다.

## 3. DB 구조 근거
`docs/database_structure.md` 기준으로 루틴 실행 체인은 아래와 같다.

```text
routine_instance
  -> routine_step_instance
    -> workout_set
      -> workout_session
```

- 루틴 실행 묶음: `routine_instance`
- 실행 순서/운동 단계: `routine_step_instance(order_no, exercise_id)`
- 단계별 세트 수행값: `workout_set(actual_value, value_unit, result_basis)`
- 실제 채점 세션: `workout_session(set_id, final_score, started_at, ended_at, ...)`

즉, 루틴은 단일 세션이 아니라 여러 세션의 상위 실행 단위이므로, 히스토리에서도 별도 타입으로 표현하는 것이 데이터 모델과 일치한다.

## 4. 개편 목표
1. 목록에서 자유운동과 루틴운동을 시각/행동 기준으로 분리한다.
2. 루틴운동 카드는 루틴 이름과 운동 순서 요약을 보여준다.
3. 루틴 상세에서는 순서 리스트를 간소화해 보여주고, 항목 클릭 시 기존 세션 상세(정확도/개선)로 연결한다.

## 5. 변경 사항

### 5.1 백엔드 (`controllers/history.js`)
- `getHistoryPage`를 루틴 묶음 렌더링에 맞게 재구성했다.
  - 자유운동: `item_type: FREE_SESSION`로 유지
  - 루틴운동: `routine_instance_id` 기준으로 그룹화해 `item_type: ROUTINE_RUN` 생성
- 루틴 순서 생성 유틸 추가
  - `buildRoutineStepSequence`
  - `buildRoutineSequencePreview`
  - `fetchRoutineMapsBySetIds`
- 루틴 상세 API 추가
  - `GET /api/history/routine/:routineInstanceId`
  - 반환값:
    - `routine_run`: 루틴 실행 메타 정보(이름, 상태, 시간, 총점, 요약)
    - `sequence`: 순서 리스트(`summary_text`, `set_count`, `session_count`, `session_id`)

### 5.2 라우팅 (`routes/main.js`)
- 라우트 추가:
  - `/api/history/routine/:routineInstanceId`
- 충돌 방지를 위해 `/:sessionId` 라우트보다 먼저 배치했다.

### 5.3 목록 UI (`views/history/index.ejs`)
- 루틴 아이템 판별 로직 추가: `item_type === 'ROUTINE_RUN'`
- 루틴 카드 변경:
  - 제목: 운동명 대신 `routine_name`
  - 요약: `sequence_preview` 및 순서 개수 노출
  - 액션: `상세` 대신 `루틴 상세` 버튼
  - 삭제 버튼 비노출(묶음 삭제 오동작 방지)
- 자유운동 카드는 기존 세션 상세/삭제 동작 유지

### 5.4 상세 UI 스크립트 (`public/js/history-page.js`)
- `viewRoutineDetail(routineInstanceId)` 추가
  - 루틴 실행 요약 카드 표시
  - 간소화된 운동 순서 리스트 표시
  - 순서 항목 클릭 시 `viewDetail(sessionId)` 호출로 기존 세션 상세 재사용
- `window.viewRoutineDetail` 노출

### 5.5 스타일 (`public/history-v2.css`)
- 루틴 카드 강조 스타일 추가: `.history-item.is-routine`
- 루틴 순서 리스트 컴포넌트 스타일 추가
  - `.routine-sequence-list`
  - `.routine-sequence-item`
  - 모바일 반응형 보정

## 6. 왜 이렇게 바꿨는가
1. **모델-UI 정합성**
- DB상 루틴은 세션 집합의 상위 실행 단위이므로, UI에서도 별도 타입으로 보여야 사용자가 혼동하지 않는다.

2. **인지 부하 감소**
- 루틴 기록을 세션과 동일 포맷으로 보여주면 “무슨 기록인지” 해석 비용이 커진다.
- 루틴 이름/순서 요약을 전면에 배치해 맥락 파악 시간을 줄였다.

3. **탐색 동선 단순화**
- `루틴 목록 -> 루틴 순서 -> 세션 정확도 상세`의 2단계 탐색으로 구조를 고정해, 사용자가 원하는 깊이만큼 내려가며 확인할 수 있게 했다.

## 7. 영향도
### 7.1 UX
- 루틴과 자유운동의 구분이 명확해져 기록 해석이 쉬워진다.
- 루틴 상세에서 순서 중심 복기가 가능해진다.

### 7.2 API/프론트 계약
- 목록 렌더링 시 `sessions` 배열에 `ROUTINE_RUN` 항목이 포함될 수 있다.
- 프론트는 `item_type` 기준 분기 처리해야 한다.

### 7.3 성능
- 루틴 그룹화를 위해 목록 API에서 후처리 로직이 증가했다.
- 데이터가 매우 많아질 경우 페이지 단위 집계 최적화가 후속 과제다.

## 8. 검증
- `node -c controllers/history.js` 통과
- `node -c routes/main.js` 통과
- `node -c views/history/index.ejs` 통과 불가 (EJS는 `node -c` 대상 아님)
- `node -c public/js/history-page.js` 통과
- `node test/history-metric-series.test.js` 통과
- `node test/session-buffer.test.js` 통과

## 9. 변경 파일
- `controllers/history.js`
- `routes/main.js`
- `views/history/index.ejs`
- `public/js/history-page.js`
- `public/history-v2.css`
- `docs/2026-04-20_history_routine_free_split_refactor.md`

## 10. 후속 수정 (동일 운동 반복 루틴 빈 단계 노출)
### 10.1 증상
- 루틴을 `스쿼트 -> 스쿼트`처럼 동일 운동 연속 단계로 구성하면,
  히스토리 상세에서 첫 단계만 집계되고 다음 단계가 `세트 0개 · 세션 0개`로 보이는 사례가 발생했다.

### 10.2 원인
- 프론트 런타임(`public/js/workout/session-controller.js`)이 루틴 세트 완료 시
  `/api/workout/session/:sessionId/set` API를 호출하지 않아,
  서버의 `workout_set`/`routine_step_instance` 진행 상태가 단계별로 갱신되지 않았다.
- 결과적으로 루틴 종료 시점에는 첫 단계만 완료 데이터가 남고, 나머지 단계는 빈 상태가 될 수 있었다.

### 10.3 조치
- `checkRoutineProgress`를 비동기 흐름으로 변경하고,
  목표 달성 시 `recordRoutineSetCompletion`을 통해 `/set` API를 호출하도록 수정했다.
- 서버 응답 액션(`NEXT_SET`, `NEXT_STEP`, `ROUTINE_COMPLETE`)을 기준으로
  휴식/다음 세트/다음 운동 전환을 수행하도록 맞췄다.
- 중복 호출 방지를 위해 `state.routineSetSyncPending` 가드를 추가했다.
- 히스토리 시퀀스 생성 시 `set_count=0 && session_count=0`인 빈 단계를 기본 숨김 처리했다.

### 10.4 기대 효과
- 동일 운동 반복 루틴에서도 단계별 세트/세션이 올바르게 저장되고,
  히스토리 상세에서 `스쿼트 3회 -> 스쿼트 3회`처럼 순서가 의도대로 표시된다.
