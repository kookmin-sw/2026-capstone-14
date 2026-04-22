# Session Controller 리팩토링 설계서

**작성일:** 2026-04-23
**상태:** 승인됨
**범위:** `public/js/workout/session-controller.js`만 대상

---

## 핵심 설계 문장

> `session-controller.js`는 운동 세션의 최상위 오케스트레이터로 유지하고, DOM 렌더링, 루틴 진행 정책, 세션 측 품질 게이트 보조 로직은 역할이 분명한 별도 모듈로 분리한다.

---

## 1. 문제 정의

현재 `public/js/workout/session-controller.js`는 하나의 파일 안에 너무 많은 책임이 섞여 있다. 이 파일은 현재 다음을 동시에 담당한다.

- 세션 초기화와 라이프사이클 흐름
- 카메라 연결과 프레임 루프 오케스트레이션
- DOM 조회와 직접적인 UI 렌더링
- 플랭크 전용 런타임 UI 처리
- 루틴 단계 및 세트 진행 정책
- 세션 측 품질 게이트 추적 보조 로직
- 세션 저장 및 abort 처리

이 구조는 다음 네 가지 문제를 만든다.

1. **책임 혼합**
   - 오케스트레이션, 렌더링, 정책 해석이 같은 클로저 안에 있다.

2. **변경 결합도 증가**
   - UI 수정, 루틴 규칙 수정, 프레임 파이프라인 수정이 모두 같은 파일 변경으로 이어진다.

3. **테스트 어려움**
   - 독립 테스트가 가능한 로직도 DOM 조작 및 런타임 부작용과 함께 묶여 있다.

4. **가독성 저하**
   - 파일이 너무 커져서 하나의 단위로 이해하기 어렵다.

이번 리팩토링의 목표는 런타임 동작을 바꾸지 않으면서, `session-controller.js`를 오케스트레이션 중심으로 축소하고 나머지 책임을 전용 모듈로 분리하는 것이다.

---

## 2. 선택한 접근 방식

검토한 접근 방식은 세 가지다.

1. **최소 추출 방식**
   - 순수 헬퍼와 일부 UI 함수만 먼저 이동한다.
   - 위험은 가장 낮지만 구조적 복잡성은 대부분 남는다.

2. **책임 기준 분해 방식**
   - 컨트롤러를 오케스트레이션, UI 렌더링, 루틴 진행, 품질 게이트 보조 로직으로 분리한다.
   - 현재 복잡성의 핵심 원인을 직접 해결하면서도 런타임 동작을 유지할 수 있다.

3. **상태 저장소 재설계 방식**
   - 별도 state store와 상태 기반 렌더링 구조를 도입한다.
   - 장기적으로는 가장 깔끔할 수 있지만, 이번 목표인 `session-controller.js` 우선 분해보다 범위가 크고 위험도도 높다.

이번 설계서는 **2번 책임 기준 분해 방식**으로 고정한다.

선정 이유는 다음과 같다.

- 실제 복잡성의 원인을 줄 수가 아니라 책임 경계 관점에서 해결한다.
- 현재 런타임 파이프라인과 진입점을 유지할 수 있다.
- 큰 구조 재설계 전에 책임 분리를 먼저 달성할 수 있다.

---

## 3. 목표 아키텍처

리팩토링 이후 운동 세션 클라이언트 구조는 아래와 같다.

```text
session-controller.js
    ├─ session-ui.js
    ├─ routine-session-manager.js
    └─ quality-gate-session.js
```

`session-controller.js`는 여전히 최상위 진입점으로 남고 전체 호출 순서를 조율한다. 새로 분리되는 모듈은 각자의 책임만 소유하며, 새로운 전역 권한 계층을 만들지 않는다.

---

## 4. 모듈 경계

### 4.1 `session-controller.js`

`session-controller.js`는 리팩토링 후에도 다음 책임을 유지한다.

- `initSession(workoutData)`를 통한 세션 초기화
- `PoseEngine`, `ScoringEngine`, `RepCounter`, `SessionBuffer` 생성 및 wiring
- 카메라 입력 소스 연결
- 포즈 감지 루프 시작 및 종료
- 프레임 처리 파이프라인 오케스트레이션
  - `poseEngine`
  - quality-gate helper
  - `scoringEngine`
  - `repCounter`
  - UI 갱신
  - `sessionBuffer`
- 상위 라이프사이클 전이 관리
  - 시작
  - 일시정지/재개
  - 종료
  - unload/abort 처리

반대로 `session-controller.js`는 더 이상 상세 렌더링 정책, 루틴 진행 정책, 세션 측 품질 게이트 보조 로직 내부 구현을 직접 소유하지 않아야 한다.

### 4.2 `session-ui.js`

`session-ui.js`는 DOM 렌더링과 DOM 전용 동작을 담당한다.

분리 대상 후보는 다음과 같다.

- 루틴 프로그레스 DOM 구성 및 갱신
- 메인 카운터 표시 갱신
- 플랭크 목표 시간 UI 동기화
- 플랭크 런타임 패널 갱신
- 점수 및 breakdown 렌더링
- 경고 배너 표시
- 토스트 표시
- 상태 뱃지 렌더링

현재 `session-controller.js` 내 대표 함수는 다음과 같다.

- `setupRoutineProgressUi()`
- `updatePrimaryCounterDisplay()`
- `updateRoutineStepDisplay()`
- `syncPlankTargetUi()`
- `updatePlankRuntimeDisplay()`
- `updateScoreDisplay()`
- `showAlert()`
- `showToast()`
- `updateStatus()`

`session-ui.js`의 규칙은 다음과 같다.

- DOM 요소를 읽고 변경할 수 있다.
- `state`, `workoutData`, 계산이 끝난 표시값을 입력으로 받을 수 있다.
- `fetch`를 호출하면 안 된다.
- 세션 상태 전이를 결정하면 안 된다.
- `RepCounter`나 `ScoringEngine`의 정책을 직접 소유하면 안 된다.

### 4.3 `routine-session-manager.js`

`routine-session-manager.js`는 루틴 진행 정책과 루틴 전용 서버 동기화를 담당한다.

분리 대상 후보는 다음과 같다.

- 현재 세트 리셋 로직
- 단계 전환 전 상태 리셋 로직
- 다음 루틴 단계 전환
- 루틴 세트 완료 서버 기록
- 다음 동작 결정
  - 다음 세트
  - 다음 운동
  - 루틴 완료

현재 `session-controller.js` 내 대표 함수는 다음과 같다.

- `resetStepUiState()`
- `resetCurrentSetTracking()`
- `switchRoutineStep()`
- `recordRoutineSetCompletion()`
- `checkRoutineProgress()`
- `nextExercise()`

`routine-session-manager.js`의 규칙은 다음과 같다.

- 루틴 진행을 위한 서버 응답을 해석할 수 있다.
- 컨트롤러에 명시적인 결과 객체를 반환할 수 있다.
- DOM 직접 렌더링을 소유하면 안 된다.
- 두 번째 최상위 컨트롤러가 되면 안 된다.

### 4.4 `quality-gate-session.js`

`quality-gate-session.js`는 세션 측 품질 게이트 보조 로직만 담당한다.

분리 대상 후보는 다음과 같다.

- withhold reason을 사용자 메시지로 매핑
- stable-frame tracker 생성 및 갱신
- pose quality 데이터로 gate input 생성
- scoring suppression 및 resume 판정

현재 `session-controller.js` 내 대표 함수는 다음과 같다.

- `mapWithholdReasonToMessage()`
- `shouldResumeScoring()`
- `isFrameStable()`
- `createQualityGateTracker()`
- `updateQualityGateTracker()`
- `buildGateInputsFromPoseData()`
- `shouldSuppressScoring()`

`quality-gate-session.js`의 규칙은 다음과 같다.

- 세션 측 gate suppression 상태를 추적할 수 있다.
- UX용 메시지를 제공할 수 있다.
- 최종 gate authority를 가져서는 안 된다.
- 최종 gate authority는 계속 `scoring-engine.js`에 남아 있어야 한다.

---

## 5. 데이터 흐름 및 인터페이스

이번 리팩토링은 새로운 전역 store를 도입하지 않는다. 기존 `initSession()` 내부의 `state` 객체와 엔진 인스턴스는 계속 source of truth로 유지한다.

분리된 모듈은 명시적인 context 객체와 callback을 통해 상호작용한다.

### 5.1 `session-ui.js`

입력:

- `state`
- `workoutData`
- DOM refs
- 표시용으로 계산이 끝난 값

출력:

- 없음

계약:

- 렌더링만 수행한다.
- 상태 전이 권한이 없다.
- 네트워크 호출 권한이 없다.

### 5.2 `routine-session-manager.js`

입력:

- `state`
- `workoutData`
- `sessionBuffer`
- `repCounter`
- controller가 제공하는 helper callback
- 필요 시 UI callback hook

출력:

- 아래와 같은 명시적 결과 객체
  - `action`
  - `restSec`
  - `nextSessionId`
  - `nextStepIndex`

계약:

- 루틴 진행 정책은 내부에서 해석한다.
- 관련 없는 UI를 직접 변경하지 말고, 결정 결과를 controller에 반환한다.

### 5.3 `quality-gate-session.js`

입력:

- `poseData`
- tracker state
- threshold
- selected view 및 allowed views context

출력:

- 아래와 같은 gate helper 결과 객체
  - `suppress`
  - `reason`
  - `stabilityMetrics`
  - `gateInputs`

계약:

- 세션 측 추적만 담당한다.
- 최종 `pass` / `withhold` 권한은 갖지 않는다.

### 5.4 `session-controller.js`

입력:

- 사용자 이벤트
- 프레임 콜백
- 초기 `workoutData`

출력:

- 각 모듈에 대한 호출 순서 제어

컨트롤러 계약:

- 각 모듈을 **언제 호출할지**는 안다.
- 각 모듈이 내부적으로 **어떻게 처리하는지**까지 모두 소유하지는 않는다.

---

## 6. 마이그레이션 순서

리팩토링은 아래 순서로 진행한다.

1. **`quality-gate-session.js` 추출**
   - 위험이 가장 낮다.
   - 기존 헬퍼 테스트와 경계가 잘 맞는다.

2. **`session-ui.js` 추출**
   - 렌더링 코드를 이동하되 동작은 유지한다.
   - controller 중심의 상태 구조는 그대로 둔다.

3. **`routine-session-manager.js` 추출**
   - 루틴 전용 정책과 서버 응답 해석을 이동한다.
   - controller는 결과 액션만 받도록 바꾼다.

4. **`session-controller.js` 오케스트레이션 중심 정리**
   - 중복되거나 내부에 남은 보조 함수를 제거한다.
   - 초기화, 프레임 파이프라인, 라이프사이클 기준으로 코드를 재배치한다.

이 순서는 고정한다. 각 단계마다 동작을 유지하면서 안전하게 분리하기 위한 순서다.

---

## 7. 검증 요구사항

이번 리팩토링은 동작 변경이 아니라 구조 변경이다. 따라서 검증은 회귀 방지에 초점을 둔다.

반드시 유지해야 하는 사항:

- `initSession()`은 공개 진입점으로 유지되어야 한다.
- 페이지에서 쓰는 기존 전역 노출 API가 계속 동작해야 한다.
- 세션 시작, 일시정지/재개, 종료, abort 동작이 바뀌면 안 된다.
- 품질 게이트 suppression 및 resume 동작이 바뀌면 안 된다.
- 루틴 세트 완료, 휴식 전환, 다음 단계 이동, 루틴 완료 흐름이 바뀌면 안 된다.
- 세션 저장/export 흐름이 바뀌면 안 된다.

검증 기대사항:

- 기존 Node 테스트 중 품질 게이트 헬퍼 테스트를 최대한 재사용한다.
- 추출된 순수 헬퍼 모듈에는 필요한 범위의 테스트를 추가한다.
- 새 모듈마다 syntax check를 수행한다.
- 최소 1회 이상 브라우저 수동 회귀 테스트를 수행한다.
  - free workout
  - routine workout
  - plank 같은 time-based workout

---

## 8. 비목표

이번 설계에 포함하지 않는 항목은 다음과 같다.

- 운동 런타임 아키텍처 전면 재작성
- React 등 새로운 프론트엔드 프레임워크 도입
- 현재 `state` 객체를 새로운 store abstraction으로 교체
- 시각 UI 재디자인
- 점수 규칙, gate 규칙, rep-counting 규칙 변경
- `public/js/workout/` 전체 디렉터리 리팩토링

---

## 9. 성공 기준

아래 조건을 모두 만족하면 이번 리팩토링은 성공으로 본다.

1. `session-controller.js`가 눈에 띄게 작아지고 orchestration 중심 파일이 된다.
2. DOM 렌더링 정책이 `session-ui.js`로 분리된다.
3. 루틴 진행 정책이 `routine-session-manager.js`로 분리된다.
4. 세션 측 품질 게이트 보조 로직이 `quality-gate-session.js`로 분리된다.
5. 현재 런타임 동작과 페이지 진입 방식이 그대로 유지된다.
6. 이후 UI, 루틴, 품질 게이트 보조 로직 변경 시 `session-controller.js` 깊숙한 곳까지 수정하지 않아도 되는 구조가 된다.
