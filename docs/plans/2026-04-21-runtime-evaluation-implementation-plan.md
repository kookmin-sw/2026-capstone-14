# 런타임 평가 신뢰성 구현 계획

> **에이전틱 작업자용:** 필수 하위 스킬: superpowers:subagent-driven-development (권장) 또는 superpowers:executing-plans를 사용하여 이 계획을 작업 단위로 구현할 것. 단계는 체크박스(`- [ ]`) 문법으로 추적.

**목표:** 런타임 우선 품질 게이팅, 운동별 실패 분리, 익스포트 기반 검증을 추가하여 저품질 포즈 입력이 잘못 채점되지 않고 보류되도록 한다.

**아키텍처:** 기존 런타임 파이프라인은 유지하되, `pose-engine.js`에서 품질 게이트 입력을 표준화하고, `scoring-engine.js`에서 pass/withhold를 평가하며, `session-controller.js`에서 안내를 표시하고, 스쿼트/푸쉬업 모듈에서 운동별 실패 로직을 정제하며, `session-buffer.js`에 MVP 검증 데이터를 보존한다. 새로운 런타임 레이어나 DB 변경을 도입하지 않고 Node 테스트 가능성을 위해 CommonJS 익스포트 가드를 가진 순수 헬퍼 함수를 선호한다.

**기술 스택:** 브라우저 JavaScript, Node `--test`, CommonJS 테스트 익스포트, localStorage 기반 세션 버퍼링

---

## 파일 맵

### 수정할 런타임 파일
- `public/js/workout/pose-engine.js`
  - 프레임 포함률, 주요 관절 가시성, 추정 뷰, 안정성, 안정 프레임 연속 횟수를 위한 정규화된 게이트 입력 요약 빌더 추가.
- `public/js/workout/scoring-engine.js`
  - 임계값 상수, `evaluateQualityGate`, rep 결과 상태 전이, CommonJS 테스트 익스포트 추가.
- `public/js/workout/session-controller.js`
  - 게이트 인지 UI 메시징, 보류 억제, 안정성 복귀 후 재개 로직 추가.
- `public/js/workout/exercises/squat-exercise.js`
  - 뷰 인지 메트릭 우선순위 규칙 추가, 운동 평가에는 동작 품질 실패만 남김.
- `public/js/workout/exercises/push-up-exercise.js`
  - 운동 reason에서 신뢰도/뷰 실패 제거, 동작 품질 실패만 남김.
- `public/js/workout/session-buffer.js`
  - 보류 이벤트 및 rep 결과 요약을 위한 MVP 익스포트 필드 추가.

### 생성 또는 수정할 테스트 파일
- 생성: `test/workout/quality-gate.test.js`
- 생성: `test/workout/scoring-state-machine.test.js`
- 생성: `test/workout/session-controller-gate-ui.test.js`
- 생성: `test/workout/exercise-rule-separation.test.js`
- 수정: `test/session-buffer.test.js`

### 생성할 검증 문서
- 생성: `docs/superpowers/validation/video-label-template.md`

---

### 작업 1: 품질 게이트 입력과 임계값 표준화

**파일:**
- 수정: `public/js/workout/pose-engine.js`
- 수정: `public/js/workout/scoring-engine.js`
- 테스트: `test/workout/quality-gate.test.js`

- [ ] **단계 1: 실패하는 품질 게이트 테스트 작성**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  QUALITY_GATE_THRESHOLDS,
  evaluateQualityGate,
} = require('../../public/js/workout/scoring-engine.js');

test('evaluateQualityGate returns withhold for low key-joint visibility', () => {
  const result = evaluateQualityGate({
    frameInclusionRatio: 0.92,
    keyJointVisibilityAverage: 0.51,
    minKeyJointVisibility: 0.48,
    estimatedView: 'SIDE',
    estimatedViewConfidence: 0.83,
    detectionConfidence: 0.91,
    trackingConfidence: 0.90,
    stableFrameCount: 12,
    unstableFrameRatio: 0.08,
    cameraDistanceOk: true,
  }, {
    allowedViews: ['SIDE'],
    selectedView: 'SIDE',
  });

  assert.equal(result.result, 'withhold');
  assert.equal(result.reason, 'key_joints_not_visible');
});

test('evaluateQualityGate returns pass when all seed thresholds are met', () => {
  const result = evaluateQualityGate({
    frameInclusionRatio: 0.95,
    keyJointVisibilityAverage: 0.80,
    minKeyJointVisibility: 0.71,
    estimatedView: 'SIDE',
    estimatedViewConfidence: 0.79,
    detectionConfidence: 0.92,
    trackingConfidence: 0.93,
    stableFrameCount: QUALITY_GATE_THRESHOLDS.stableFrameCount,
    unstableFrameRatio: 0.10,
    cameraDistanceOk: true,
  }, {
    allowedViews: ['SIDE'],
    selectedView: 'SIDE',
  });

  assert.equal(result.result, 'pass');
  assert.equal(result.reason, null);
});
```

- [ ] **단계 2: 테스트 실행하여 실패 확인**

실행: `node --test test/workout/quality-gate.test.js`
예상: FAIL — `evaluateQualityGate`와 `QUALITY_GATE_THRESHOLDS`가 아직 익스포트되지 않았기 때문.

- [ ] **단계 3: `scoring-engine.js`에 임계값 상수와 품질 게이트 평가기 추가**

```js
const QUALITY_GATE_THRESHOLDS = {
  detectionConfidence: 0.50,
  trackingConfidence: 0.50,
  estimatedViewConfidence: 0.60,
  keyJointVisibilityAverage: 0.65,
  minKeyJointVisibility: 0.40,
  stableFrameCount: 8,
  stabilityWindow: 12,
  unstableFrameRatio: 0.30,
  frameInclusionRatio: 0.85,
};

function evaluateQualityGate(inputs, context = {}) {
  if (!inputs.cameraDistanceOk) {
    return { result: 'withhold', reason: 'camera_too_close_or_far' };
  }
  if (inputs.detectionConfidence < QUALITY_GATE_THRESHOLDS.detectionConfidence) {
    return { result: 'withhold', reason: 'low_detection_confidence' };
  }
  if (inputs.trackingConfidence < QUALITY_GATE_THRESHOLDS.trackingConfidence) {
    return { result: 'withhold', reason: 'low_tracking_confidence' };
  }
  if (inputs.frameInclusionRatio < QUALITY_GATE_THRESHOLDS.frameInclusionRatio) {
    return { result: 'withhold', reason: 'body_not_fully_visible' };
  }
  if (inputs.minKeyJointVisibility < QUALITY_GATE_THRESHOLDS.minKeyJointVisibility ||
      inputs.keyJointVisibilityAverage < QUALITY_GATE_THRESHOLDS.keyJointVisibilityAverage) {
    return { result: 'withhold', reason: 'key_joints_not_visible' };
  }
  if ((context.allowedViews || []).length > 0) {
    const viewAllowed = context.allowedViews.includes(inputs.estimatedView);
    if (!viewAllowed || inputs.estimatedViewConfidence < QUALITY_GATE_THRESHOLDS.estimatedViewConfidence) {
      return { result: 'withhold', reason: 'view_mismatch' };
    }
  }
  if (inputs.unstableFrameRatio >= QUALITY_GATE_THRESHOLDS.unstableFrameRatio) {
    return { result: 'withhold', reason: 'unstable_tracking' };
  }
  if (inputs.stableFrameCount < QUALITY_GATE_THRESHOLDS.stableFrameCount) {
    return { result: 'withhold', reason: 'insufficient_stable_frames' };
  }
  return { result: 'pass', reason: null };
}

if (typeof module !== 'undefined') {
  module.exports = {
    ...(module.exports || {}),
    QUALITY_GATE_THRESHOLDS,
    evaluateQualityGate,
  };
}
```

- [ ] **단계 4: `pose-engine.js`에 정규화된 게이트 입력 빌더 추가**

```js
function buildQualityGateInputs({
  frameInclusionRatio,
  keyJointVisibilityAverage,
  minKeyJointVisibility,
  estimatedView,
  estimatedViewConfidence,
  detectionConfidence,
  trackingConfidence,
  stableFrameCount,
  unstableFrameRatio,
  cameraDistanceOk,
}) {
  return {
    frameInclusionRatio,
    keyJointVisibilityAverage,
    minKeyJointVisibility,
    estimatedView,
    estimatedViewConfidence,
    detectionConfidence,
    trackingConfidence,
    stableFrameCount,
    unstableFrameRatio,
    cameraDistanceOk,
  };
}
```

- [ ] **단계 5: 품질 게이트 테스트 다시 실행**

실행: `node --test test/workout/quality-gate.test.js`
예상: PASS (통과 테스트 2개, 실패 0개).

- [ ] **단계 6: 작업 1 커밋**

```bash
git add public/js/workout/pose-engine.js public/js/workout/scoring-engine.js test/workout/quality-gate.test.js
git commit -m "feat: add runtime quality gate thresholds"
```

---

### 작업 2: 게이트 인지 채점 상태 전이와 세션 컨트롤러 안내 추가

**파일:**
- 수정: `public/js/workout/scoring-engine.js`
- 수정: `public/js/workout/session-controller.js`
- 테스트: `test/workout/scoring-state-machine.test.js`
- 테스트: `test/workout/session-controller-gate-ui.test.js`

- [ ] **단계 1: 실패하는 상태 머신 및 UI 메시지 테스트 작성**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyRepOutcome,
} = require('../../public/js/workout/scoring-engine.js');
const {
  mapWithholdReasonToMessage,
  shouldResumeScoring,
} = require('../../public/js/workout/session-controller.js');

test('applyRepOutcome discards an active rep when gate flips to withheld', () => {
  const result = applyRepOutcome({
    gateResult: 'withhold',
    repState: { active: true, repIndex: 3 },
    exerciseEvaluation: null,
  });

  assert.equal(result.repResult, 'withheld');
  assert.equal(result.incrementRepCount, false);
  assert.equal(result.discardActiveRep, true);
});

test('mapWithholdReasonToMessage returns a corrective guidance message', () => {
  assert.equal(
    mapWithholdReasonToMessage('view_mismatch'),
    '현재 운동은 옆면 시점이 필요합니다.'
  );
});

test('shouldResumeScoring requires the full stable-frame streak', () => {
  assert.equal(shouldResumeScoring({ stableFrameCount: 7, threshold: 8 }), false);
  assert.equal(shouldResumeScoring({ stableFrameCount: 8, threshold: 8 }), true);
});
```

- [ ] **단계 2: 두 테스트 실행하여 실패 확인**

실행: `node --test test/workout/scoring-state-machine.test.js test/workout/session-controller-gate-ui.test.js`
예상: FAIL — `applyRepOutcome`, `mapWithholdReasonToMessage`, `shouldResumeScoring`이 아직 익스포트되지 않았기 때문.

- [ ] **단계 3: `scoring-engine.js`에 rep 결과 상태 전이 구현**

```js
function applyRepOutcome({ gateResult, repState, exerciseEvaluation }) {
  if (gateResult === 'withhold') {
    return {
      repResult: 'withheld',
      incrementRepCount: false,
      discardActiveRep: Boolean(repState && repState.active),
      scoreCapApplied: null,
    };
  }
  if (exerciseEvaluation && exerciseEvaluation.hardFailReason) {
    return {
      repResult: 'hard_fail',
      incrementRepCount: false,
      discardActiveRep: true,
      scoreCapApplied: 0,
    };
  }
  if (exerciseEvaluation && exerciseEvaluation.softFailReasons && exerciseEvaluation.softFailReasons.length > 0) {
    return {
      repResult: 'soft_fail',
      incrementRepCount: true,
      discardActiveRep: false,
      scoreCapApplied: exerciseEvaluation.scoreCap,
    };
  }
  return {
    repResult: 'scored',
    incrementRepCount: true,
    discardActiveRep: false,
    scoreCapApplied: null,
  };
}
```

- [ ] **단계 4: `session-controller.js`에 메시지 매핑과 재개 게이팅 구현**

```js
function mapWithholdReasonToMessage(reason) {
  const messages = {
    body_not_fully_visible: '몸 전체가 화면에 보이도록 조금 더 뒤로 가 주세요.',
    key_joints_not_visible: '팔과 다리가 잘 보이도록 자세와 카메라를 조정해 주세요.',
    view_mismatch: '현재 운동은 옆면 시점이 필요합니다.',
    unstable_tracking: '카메라를 고정하고 잠시 자세를 유지해 주세요.',
    insufficient_stable_frames: '잠시 정지한 뒤 다시 시작해 주세요.',
    camera_too_close_or_far: '카메라와의 거리를 조금 조정해 주세요.',
    low_detection_confidence: '조명이 충분한지 확인해 주세요.',
    low_tracking_confidence: '몸이 잘 보이도록 위치를 다시 맞춰 주세요.',
  };
  return messages[reason] || '카메라와 자세를 다시 맞춰 주세요.';
}

function shouldResumeScoring({ stableFrameCount, threshold }) {
  return stableFrameCount >= threshold;
}

if (typeof module !== 'undefined') {
  module.exports = {
    ...(module.exports || {}),
    mapWithholdReasonToMessage,
    shouldResumeScoring,
  };
}
```

- [ ] **단계 5: 컨트롤러에 보류 시 채점 억제, 반복 알림 쿨다운 적용**

```js
if (gateEvaluation.result === 'withhold') {
  this.currentWithholdReason = gateEvaluation.reason;
  this.showStatusMessage(mapWithholdReasonToMessage(gateEvaluation.reason));
  this.pauseRepScoring = true;
  return;
}

if (this.pauseRepScoring && !shouldResumeScoring({
  stableFrameCount: gateInputs.stableFrameCount,
  threshold: QUALITY_GATE_THRESHOLDS.stableFrameCount,
})) {
  return;
}

this.pauseRepScoring = false;
this.currentWithholdReason = null;
```

- [ ] **단계 6: 상태 머신 및 UI 메시지 테스트 다시 실행**

실행: `node --test test/workout/scoring-state-machine.test.js test/workout/session-controller-gate-ui.test.js`
예상: PASS (모든 테스트 통과, 실패 없음).

- [ ] **단계 7: 작업 2 커밋**

```bash
git add public/js/workout/scoring-engine.js public/js/workout/session-controller.js test/workout/scoring-state-machine.test.js test/workout/session-controller-gate-ui.test.js
git commit -m "feat: add gate-aware scoring state transitions"
```

---

### 작업 3: 운동 모듈 정제 — 동작 품질 실패만 남김

**파일:**
- 수정: `public/js/workout/exercises/squat-exercise.js`
- 수정: `public/js/workout/exercises/push-up-exercise.js`
- 테스트: `test/workout/exercise-rule-separation.test.js`

- [ ] **단계 1: 실패하는 운동 규칙 테스트 작성**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getSquatMetricPriority,
} = require('../../public/js/workout/exercises/squat-exercise.js');
const {
  normalizePushUpEvaluation,
} = require('../../public/js/workout/exercises/push-up-exercise.js');

test('getSquatMetricPriority prefers knee alignment for FRONT view', () => {
  const priority = getSquatMetricPriority('FRONT');
  assert.deepEqual(priority.primary, ['knee_alignment']);
  assert.deepEqual(priority.secondary, ['depth']);
});

test('getSquatMetricPriority excludes knee alignment from DIAGONAL hard-fail evaluation', () => {
  const priority = getSquatMetricPriority('DIAGONAL');
  assert.equal(priority.disallowedHardFailMetrics.includes('knee_alignment'), true);
});

test('normalizePushUpEvaluation removes low_confidence from exercise failures', () => {
  const result = normalizePushUpEvaluation({
    hardFailReason: 'low_confidence',
    softFailReasons: [],
  });

  assert.equal(result.hardFailReason, null);
  assert.deepEqual(result.softFailReasons, []);
});
```

- [ ] **단계 2: 운동 규칙 테스트 실행하여 실패 확인**

실행: `node --test test/workout/exercise-rule-separation.test.js`
예상: FAIL — 헬퍼 함수가 아직 존재하지 않기 때문.

- [ ] **단계 3: `squat-exercise.js`에 뷰 우선순위 헬퍼 추가**

```js
function getSquatMetricPriority(view) {
  if (view === 'FRONT') {
    return {
      primary: ['knee_alignment'],
      secondary: ['depth'],
      disallowedHardFailMetrics: ['hip_hinge'],
    };
  }
  if (view === 'SIDE') {
    return {
      primary: ['depth', 'hip_hinge'],
      secondary: ['torso_stability'],
      disallowedHardFailMetrics: ['knee_alignment'],
    };
  }
  return {
    primary: ['depth'],
    secondary: ['torso_stability'],
    disallowedHardFailMetrics: ['knee_alignment'],
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    ...(module.exports || {}),
    getSquatMetricPriority,
  };
}
```

- [ ] **단계 4: 푸쉬업 평가 정규화 — 신뢰도/뷰 문제가 공통 게이트를 벗어나지 않도록**

```js
function normalizePushUpEvaluation(evaluation) {
  if (!evaluation) {
    return { hardFailReason: null, softFailReasons: [] };
  }

  if (evaluation.hardFailReason === 'low_confidence' || evaluation.hardFailReason === 'view_mismatch') {
    return {
      ...evaluation,
      hardFailReason: null,
      softFailReasons: (evaluation.softFailReasons || []).filter((reason) => {
        return reason !== 'low_confidence' && reason !== 'view_mismatch';
      }),
    };
  }

  return evaluation;
}

if (typeof module !== 'undefined') {
  module.exports = {
    ...(module.exports || {}),
    normalizePushUpEvaluation,
  };
}
```

- [ ] **단계 5: 운동 규칙 테스트 다시 실행**

실행: `node --test test/workout/exercise-rule-separation.test.js`
예상: PASS (모든 테스트 통과).

- [ ] **단계 6: 작업 3 커밋**

```bash
git add public/js/workout/exercises/squat-exercise.js public/js/workout/exercises/push-up-exercise.js test/workout/exercise-rule-separation.test.js
git commit -m "feat: separate movement failures from input quality failures"
```

---

### 작업 4: MVP 익스포트 데이터 보존 및 검증 아티팩트 추가

**파일:**
- 수정: `public/js/workout/session-buffer.js`
- 수정: `test/session-buffer.test.js`
- 생성: `docs/superpowers/validation/video-label-template.md`

- [ ] **단계 1: `test/session-buffer.test.js`에 실패하는 익스포트 테스트 확장**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const SessionBuffer = require('../public/js/workout/session-buffer.js');

test('export includes withhold counts and rep-level scoring states', () => {
  const buffer = new SessionBuffer('session-1');

  buffer.recordEvent({
    type: 'withhold',
    timestamp: 1000,
    gate_result: 'withhold',
    withhold_reason: 'view_mismatch',
    estimated_view: 'FRONT',
    estimated_view_confidence: 0.42,
    stable_frame_count: 3,
  });

  buffer.recordRepResult({
    rep_index: 1,
    rep_result: 'soft_fail',
    rep_score: 68,
    hard_fail_reason: null,
    soft_fail_reasons: ['depth_not_reached'],
    score_cap_applied: 70,
    quality_summary: { estimated_view: 'SIDE' },
  });

  const exported = buffer.export();

  assert.equal(exported.withhold_count, 1);
  assert.equal(exported.withhold_reason_counts.view_mismatch, 1);
  assert.equal(exported.rep_results[0].rep_result, 'soft_fail');
});
```

- [ ] **단계 2: 세션 버퍼 테스트 실행하여 실패 확인**

실행: `node --test test/session-buffer.test.js`
예상: FAIL — 익스포트 페이로드에 새 MVP 필드가 아직 포함되지 않았기 때문.

- [ ] **단계 3: `session-buffer.js`에 MVP 익스포트 필드 추가**

```js
recordRepResult(repResult) {
  this.repResults = this.repResults || [];
  this.repResults.push(repResult);
}

export() {
  const withholdEvents = (this.events || []).filter((event) => event.type === 'withhold');
  const withholdReasonCounts = withholdEvents.reduce((acc, event) => {
    const reason = event.withhold_reason || 'unknown';
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});

  const payload = {
    session_id: this.sessionId,
    exercise_type: this.exerciseType,
    selected_view: this.selectedView,
    allowed_views: this.allowedViews,
    default_view: this.defaultView,
    final_score: this.finalScore,
    metric_results: this.metricResults || [],
    interim_snapshots: this.interimSnapshots || [],
    events: this.events || [],
  };

  payload.withhold_count = withholdEvents.length;
  payload.withhold_reason_counts = withholdReasonCounts;
  payload.rep_results = this.repResults || [];

  return payload;
}
```

- [ ] **단계 4: 검증 라벨 템플릿 문서 생성**

```md
# 검증 비디오 라벨

- video_id:
- file_name:
- exercise_type: squat | push-up
- expected_view:
- actual_view_note:
- expected_gate_result: pass | withhold
- expected_withhold_reason:
- expected_rep_result_summary:
- major_observed_issues:
- notes:
```

저장 위치: `docs/superpowers/validation/video-label-template.md`

- [ ] **단계 5: 세션 버퍼 테스트 다시 실행**

실행: `node --test test/session-buffer.test.js`
예상: PASS (모든 세션 버퍼 테스트 통과).

- [ ] **단계 6: 모든 신규 런타임 검사에 대한 집중 회귀 스위트 실행**

실행: `node --test test/workout/quality-gate.test.js test/workout/scoring-state-machine.test.js test/workout/session-controller-gate-ui.test.js test/workout/exercise-rule-separation.test.js test/session-buffer.test.js`
예상: PASS (나열된 모든 테스트 통과, 실패 0개).

- [ ] **단계 7: 작업 4 커밋**

```bash
git add public/js/workout/session-buffer.js test/session-buffer.test.js docs/superpowers/validation/video-label-template.md
git commit -m "feat: export runtime validation data for offline review"
```

---

## 최종 검증

- [ ] 실행: `npm test`
- [ ] 예상: 전체 Node 테스트 스위트가 새로운 실패 없이 통과한다.
- [ ] 브라우저에서 수동 확인:
  - 저품질 프레임은 낮은 점수 대신 교정 보류 안내를 표시한다
  - 안정 프레임 연속 횟수가 회복된 후에만 채점이 재개된다
  - 스쿼트 FRONT/SIDE/DIAGONAL 뷰는 의도된 메트릭 우선순위 규칙을 사용한다
  - 푸쉬업 SIDE 불일치가 운동 hard fail이 되지 않는다
  - 익스포트된 세션 JSON에 `withhold_count`, `withhold_reason_counts`, `rep_results`가 포함된다

---

## 스펙 커버리지 확인

- 품질 게이트 임계값 시드: 작업 1에서 커버
- 게이트 vs 운동 책임 분리: 작업 1과 3에서 커버
- 채점 상태 전이 (`scored|withheld|hard_fail|soft_fail`): 작업 2에서 커버
- 세션 컨트롤러 안내 및 재개 동작: 작업 2에서 커버
- 스쿼트 뷰 우선순위 규칙: 작업 3에서 커버
- 푸쉬업 신뢰도/뷰 정리: 작업 3에서 커버
- 세션 버퍼 MVP 익스포트 및 검증 라벨 템플릿: 작업 4에서 커버

## 플레이스홀더 스캔

- `TODO`, `TBD`, 또는 연기된 구현 마커가 남아있지 않다.
- 모든 코드 변경 단계는 구체적인 스니펫 또는 수정할 정확한 파일을 포함한다.
- 모든 테스트 단계는 정확한 명령어를 포함한다.

## 타입 일관성 확인

- `evaluateQualityGate`는 항상 `{ result, reason }`을 반환한다
- `applyRepOutcome`은 항상 `{ repResult, incrementRepCount, discardActiveRep, scoreCapApplied }`를 반환한다
- `mapWithholdReasonToMessage`는 항상 문자열을 반환한다
- `getSquatMetricPriority`는 항상 `{ primary, secondary, disallowedHardFailMetrics }`를 반환한다
- `normalizePushUpEvaluation`은 항상 `hardFailReason`과 `softFailReasons`를 가진 평가 객체를 반환한다

---
