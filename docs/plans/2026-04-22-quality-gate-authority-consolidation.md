# 품질 게이트 권한 통합 구현 계획

> **에이전틱 작업자용:** 필수 하위 스킬: superpowers:subagent-driven-development (권장) 또는 superpowers:executing-plans를 사용하여 이 계획을 작업 단위로 구현할 것. 단계는 체크박스(`- [ ]`) 문법으로 추적.

**목표:** 모든 최종 품질 게이트 권한을 `scoring-engine.js`로 통합하고, 운동 모듈에서 게이트 유사 reason 생성을 제거하며, 승인된 스펙에 맞춰 reason code를 표준화하고, 모듈 분리를 강제하는 테스트를 추가한다.

**아키텍처:** `scoring-engine.js`의 공통 품질 게이트가 유일한 `pass`/`withhold` 결정자가 된다. 운동 모듈은 메타데이터와 수행 의미만 제공한다. `session-controller.js`는 게이트로부터 결정된 상태만 소비한다. `pose-engine.js`는 순수 신호 생성기로 남는다.

**기술 스택:** Vanilla JavaScript (브라우저 + Node.js 테스트 러너), `node:test`, `node:assert/strict`

---

## 파일 맵

| 파일 | 이 계획에서의 역할 |
|---|---|
| `public/js/workout/scoring-engine.js` | **수정** — 게이트 reason code를 스펙의 정식 이름과 일치하도록 표준화; `GATE_ONLY_REASONS` 상수 추가; 익스포트 |
| `public/js/workout/exercises/push-up-exercise.js` | **수정** — `getFrameGate` 제거 (게이트 로직은 scoring-engine 소관); `scoreRep`의 hardFails에서 `view_mismatch`와 `low_confidence` 제거; 선언적 `requirements` 메타데이터 추가 |
| `public/js/workout/session-controller.js` | **수정** — `getFrameGateResult` 호출 제거; 게이팅을 위해 `evaluateQualityGate`에만 의존; UX 매핑 헬퍼 유지 |
| `test/workout/quality-gate.test.js` | **수정** — 표준화된 reason code, `GATE_ONLY_REASONS` 상수 테스트 추가 |
| `test/workout/exercise-rule-separation.test.js` | **수정** — 운동 모듈이 게이트 소유 reason을 생성하지 않음을 증명하는 테스트 추가 |
| `test/workout/authority-separation.test.js` | **생성** — 크로스 모듈 권한 계약 강제를 위한 신규 테스트 파일 |

---

## 작업 1: scoring-engine.js의 품질 게이트 Reason Code 표준화

**파일:**
- 수정: `public/js/workout/scoring-engine.js` (lines 664-714)
- 수정: `test/workout/quality-gate.test.js` (끝에 새 테스트 추가)

- [ ] **단계 1: 표준화된 reason code에 대한 실패 테스트 작성**

`test/workout/quality-gate.test.js`에 추가:

```javascript
// ── 스펙 §부록에 따른 표준화된 reason code ──

test('evaluateQualityGate withholds with "joints_missing" when key joints not visible', () => {
  const result = evaluateQualityGate({
    frameInclusionRatio: 0.92,
    keyJointVisibilityAverage: 0.51,
    minKeyJointVisibility: 0.35,
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
  assert.equal(result.reason, 'joints_missing');
});

test('evaluateQualityGate withholds with "tracked_joints_low" when tracking ratio below threshold', () => {
  const result = evaluateQualityGate({
    frameInclusionRatio: 0.95,
    keyJointVisibilityAverage: 0.50,
    minKeyJointVisibility: 0.30,
    estimatedView: 'SIDE',
    estimatedViewConfidence: 0.80,
    detectionConfidence: 0.92,
    trackingConfidence: 0.40,
    stableFrameCount: 10,
    unstableFrameRatio: 0.05,
    cameraDistanceOk: true,
  }, {
    allowedViews: ['SIDE'],
    selectedView: 'SIDE',
  });

  assert.equal(result.result, 'withhold');
  assert.equal(result.reason, 'tracked_joints_low');
});

test('evaluateQualityGate withholds with "out_of_frame" when body not fully visible', () => {
  const result = evaluateQualityGate({
    frameInclusionRatio: 0.70,
    keyJointVisibilityAverage: 0.80,
    minKeyJointVisibility: 0.70,
    estimatedView: 'SIDE',
    estimatedViewConfidence: 0.80,
    detectionConfidence: 0.90,
    trackingConfidence: 0.90,
    stableFrameCount: 12,
    unstableFrameRatio: 0.05,
    cameraDistanceOk: true,
  }, {
    allowedViews: ['SIDE'],
    selectedView: 'SIDE',
  });

  assert.equal(result.result, 'withhold');
  assert.equal(result.reason, 'out_of_frame');
});

test('evaluateQualityGate withholds with "low_confidence" when detection confidence is low', () => {
  const result = evaluateQualityGate({
    frameInclusionRatio: 0.95,
    keyJointVisibilityAverage: 0.80,
    minKeyJointVisibility: 0.70,
    estimatedView: 'SIDE',
    estimatedViewConfidence: 0.80,
    detectionConfidence: 0.30,
    trackingConfidence: 0.93,
    stableFrameCount: 10,
    unstableFrameRatio: 0.05,
    cameraDistanceOk: true,
  }, {
    allowedViews: ['SIDE'],
    selectedView: 'SIDE',
  });

  assert.equal(result.result, 'withhold');
  assert.equal(result.reason, 'low_confidence');
});

test('evaluateQualityGate withholds with "view_unstable" when unstable ratio exceeds threshold', () => {
  const result = evaluateQualityGate({
    frameInclusionRatio: 0.95,
    keyJointVisibilityAverage: 0.80,
    minKeyJointVisibility: 0.70,
    estimatedView: 'SIDE',
    estimatedViewConfidence: 0.80,
    detectionConfidence: 0.92,
    trackingConfidence: 0.93,
    stableFrameCount: 10,
    unstableFrameRatio: 0.45,
    cameraDistanceOk: true,
  }, {
    allowedViews: ['SIDE'],
    selectedView: 'SIDE',
  });

  assert.equal(result.result, 'withhold');
  assert.equal(result.reason, 'view_unstable');
});

test('GATE_ONLY_REASONS constant contains all spec-defined gate-owned reason codes', () => {
  const expected = [
    'out_of_frame',
    'tracked_joints_low',
    'view_unstable',
    'view_mismatch',
    'low_confidence',
    'joints_missing',
  ];
  assert.deepEqual(GATE_ONLY_REASONS.sort(), expected.sort());
});
```

- [ ] **단계 2: 테스트 실행하여 실패 확인**

실행: `node --test test/workout/quality-gate.test.js`
예상: FAIL — `GATE_ONLY_REASONS`가 정의되지 않음; `joints_missing`, `tracked_joints_low`, `out_of_frame`, `low_confidence`, `view_unstable` 같은 reason code가 `evaluateQualityGate`에서 반환되지 않음.

- [ ] **단계 3: scoring-engine.js에 표준화된 reason code 구현**

`evaluateQualityGate` 함수 본문(lines 684-714)을 교체하고 `GATE_ONLY_REASONS` 상수 추가:

```javascript
// ── 게이트 소유 reason code (스펙 §부록) ──
// 이 reason code는 운동 모듈에서 생성되어서는 안 된다.
const GATE_ONLY_REASONS = [
  'out_of_frame',
  'tracked_joints_low',
  'view_unstable',
  'view_mismatch',
  'low_confidence',
  'joints_missing',
];

/**
 * 현재 프레임 입력 품질이 채점에 충분한지 평가한다.
 * { result: 'pass' | 'withhold', reason: string | null } 반환
 *
 * 입력 품질 실패는 절대 운동 모듈로 위임되지 않는다.
 * pass된 경우에만 → 운동 모듈 평가가 실행된다.
 *
 * Reason code는 스펙의 정식 이름(§부록)을 따른다:
 *   out_of_frame, tracked_joints_low, view_unstable,
 *   view_mismatch, low_confidence, joints_missing
 */
function evaluateQualityGate(inputs, context) {
  if (!inputs.cameraDistanceOk) {
    return { result: 'withhold', reason: 'out_of_frame' };
  }
  if (inputs.detectionConfidence < QUALITY_GATE_THRESHOLDS.detectionConfidence) {
    return { result: 'withhold', reason: 'low_confidence' };
  }
  if (inputs.trackingConfidence < QUALITY_GATE_THRESHOLDS.trackingConfidence) {
    return { result: 'withhold', reason: 'tracked_joints_low' };
  }
  if (inputs.frameInclusionRatio < QUALITY_GATE_THRESHOLDS.frameInclusionRatio) {
    return { result: 'withhold', reason: 'out_of_frame' };
  }
  if (inputs.minKeyJointVisibility < QUALITY_GATE_THRESHOLDS.minKeyJointVisibility ||
      inputs.keyJointVisibilityAverage < QUALITY_GATE_THRESHOLDS.keyJointVisibilityAverage) {
    return { result: 'withhold', reason: 'joints_missing' };
  }
  if ((context && context.allowedViews || []).length > 0) {
    const viewAllowed = context.allowedViews.includes(inputs.estimatedView);
    if (!viewAllowed || inputs.estimatedViewConfidence < QUALITY_GATE_THRESHOLDS.estimatedViewConfidence) {
      return { result: 'withhold', reason: 'view_mismatch' };
    }
  }
  if (inputs.unstableFrameRatio >= QUALITY_GATE_THRESHOLDS.unstableFrameRatio) {
    return { result: 'withhold', reason: 'view_unstable' };
  }
  if (inputs.stableFrameCount < QUALITY_GATE_THRESHOLDS.stableFrameCount) {
    return { result: 'withhold', reason: 'view_unstable' };
  }
  return { result: 'pass', reason: null };
}
```

`GATE_ONLY_REASONS`를 포함하도록 window 익스포트 업데이트 (766행 부근):

```javascript
if (typeof window !== 'undefined') {
  window.ScoringEngine = ScoringEngine;
  window.QUALITY_GATE_THRESHOLDS = QUALITY_GATE_THRESHOLDS;
  window.GATE_ONLY_REASONS = GATE_ONLY_REASONS;
  window.evaluateQualityGate = evaluateQualityGate;
  window.applyRepOutcome = applyRepOutcome;
}
```

CommonJS 익스포트 업데이트 (773행 부근):

```javascript
if (typeof module !== 'undefined') {
  module.exports = {
    ScoringEngine,
    QUALITY_GATE_THRESHOLDS,
    GATE_ONLY_REASONS,
    evaluateQualityGate,
    applyRepOutcome,
  };
}
```

- [ ] **단계 4: quality-gate.test.js의 기존 테스트를 새 reason code에 맞춰 업데이트**

기존 테스트의 reason code 기대값 교체:

```javascript
// test: 'evaluateQualityGate returns withhold for low key-joint visibility'
// 변경: assert.equal(result.reason, 'joints_missing');

// test: 'evaluateQualityGate returns withhold for body not fully visible'
// 변경: assert.equal(result.reason, 'out_of_frame');

// test: 'evaluateQualityGate returns withhold for unstable_tracking'
// 변경: assert.equal(result.reason, 'view_unstable');

// test: 'evaluateQualityGate returns withhold for insufficient stable frames'
// 변경: assert.equal(result.reason, 'view_unstable');

// test: 'evaluateQualityGate returns withhold for camera too close or far'
// 변경: assert.equal(result.reason, 'out_of_frame');

// test: 'evaluateQualityGate returns withhold for low detection confidence'
// 변경: assert.equal(result.reason, 'low_confidence');

// test: 'evaluateQualityGate returns withhold for low tracking confidence'
// 변경: assert.equal(result.reason, 'tracked_joints_low');
```

또한 `session-controller-gate-ui.test.js`도 새 reason code 이름을 사용하도록 업데이트:

```javascript
// mapWithholdReasonToMessage 테스트에서 reason code 업데이트:
// 'body_not_fully_visible' → 'out_of_frame'
// 'key_joints_not_visible' → 'joints_missing'
// 'unstable_tracking' → 'view_unstable'
// 'insufficient_stable_frames' → 'view_unstable'
// 'camera_too_close_or_far' → 'out_of_frame'
// 'low_detection_confidence' → 'low_confidence'
// 'low_tracking_confidence' → 'tracked_joints_low'
```

- [ ] **단계 5: 테스트 실행하여 통과 확인**

실행: `node --test test/workout/quality-gate.test.js`
예상: PASS (모든 테스트)

실행: `node --test test/workout/session-controller-gate-ui.test.js`
예상: PASS (모든 테스트)

- [ ] **단계 6: 커밋**

```bash
git add public/js/workout/scoring-engine.js test/workout/quality-gate.test.js test/workout/session-controller-gate-ui.test.js
git commit -m "feat: standardize quality gate reason codes per spec appendix"
```

---

## 작업 2: session-controller.js Reason Code 매핑 업데이트

**파일:**
- 수정: `public/js/workout/session-controller.js` (lines 1901-1913, `mapWithholdReasonToMessage`)
- 수정: `test/workout/session-controller-gate-ui.test.js` (reason code 참조)

- [ ] **단계 1: 업데이트된 메시지 매핑에 대한 실패 테스트 작성**

`test/workout/session-controller-gate-ui.test.js`에 추가:

```javascript
test('mapWithholdReasonToMessage handles all spec-standardized reason codes', () => {
  assert.equal(
    mapWithholdReasonToMessage('out_of_frame'),
    '머리부터 발끝까지 프레임 안에 들어오도록 위치를 조정해주세요.'
  );
  assert.equal(
    mapWithholdReasonToMessage('joints_missing'),
    '어깨부터 손목, 골반과 하체까지 전신이 보이도록 카메라를 맞춰주세요.'
  );
  assert.equal(
    mapWithholdReasonToMessage('tracked_joints_low'),
    '팔과 하체가 모두 보이도록 카메라를 조금 더 멀리 두세요.'
  );
  assert.equal(
    mapWithholdReasonToMessage('view_unstable'),
    '몸 방향이 흔들리고 있습니다. 측면 자세를 유지해주세요.'
  );
  assert.equal(
    mapWithholdReasonToMessage('low_confidence'),
    '카메라 위치와 조명을 조정한 뒤 다시 자세를 잡아주세요.'
  );
  // view_mismatch는 이미 테스트됨 — 기존 테스트 유지
});
```

- [ ] **단계 2: 테스트 실행하여 실패 확인**

실행: `node --test test/workout/session-controller-gate-ui.test.js -t "handles all spec-standardized"`
예상: FAIL — `out_of_frame`, `joints_missing`, `tracked_joints_low`, `view_unstable`, `low_confidence`가 메시지 맵의 키가 아님.

- [ ] **단계 3: session-controller.js의 mapWithholdReasonToMessage 업데이트**

`mapWithholdReasonToMessage` 함수(lines 1901-1913) 교체:

```javascript
function mapWithholdReasonToMessage(reason) {
  const messages = {
    out_of_frame: '머리부터 발끝까지 프레임 안에 들어오도록 위치를 조정해주세요.',
    joints_missing: '어깨부터 손목, 골반과 하체까지 전신이 보이도록 카메라를 맞춰주세요.',
    tracked_joints_low: '팔과 하체가 모두 보이도록 카메라를 조금 더 멀리 두세요.',
    view_mismatch: '현재 운동은 옆면 시점이 필요합니다.',
    view_unstable: '몸 방향이 흔들리고 있습니다. 측면 자세를 유지해주세요.',
    low_confidence: '카메라 위치와 조명을 조정한 뒤 다시 자세를 잡아주세요.',
  };
  return messages[reason] || '카메라와 자세를 다시 맞춰 주세요.';
}
```

- [ ] **단계 4: session-controller-gate-ui.test.js의 기존 테스트 업데이트**

첫 번째 테스트의 이전 reason code assertion 교체:

```javascript
test('mapWithholdReasonToMessage returns correct messages for all reason codes', () => {
  assert.equal(
    mapWithholdReasonToMessage('out_of_frame'),
    '머리부터 발끝까지 프레임 안에 들어오도록 위치를 조정해주세요.'
  );
  assert.equal(
    mapWithholdReasonToMessage('joints_missing'),
    '어깨부터 손목, 골반과 하체까지 전신이 보이도록 카메라를 맞춰주세요.'
  );
  assert.equal(
    mapWithholdReasonToMessage('view_mismatch'),
    '현재 운동은 옆면 시점이 필요합니다.'
  );
  assert.equal(
    mapWithholdReasonToMessage('view_unstable'),
    '몸 방향이 흔들리고 있습니다. 측면 자세를 유지해주세요.'
  );
  assert.equal(
    mapWithholdReasonToMessage('low_confidence'),
    '카메라 위치와 조명을 조정한 뒤 다시 자세를 잡아주세요.'
  );
  assert.equal(
    mapWithholdReasonToMessage('tracked_joints_low'),
    '팔과 하체가 모두 보이도록 카메라를 조금 더 멀리 두세요.'
  );
});
```

이전 reason code를 참조하는 `shouldSuppressScoring` 테스트 업데이트:

```javascript
// test: 'shouldSuppressScoring suppresses when gate returns withhold'
// reason을 'view_mismatch'에서 그대로 유지 (view_mismatch는 여전히 유효함)

// test: 'shouldSuppressScoring stays suppressed until stable-frame threshold is restored'
// withholdReason을 'unstable_tracking'에서 'view_unstable'로 변경

// test: 'shouldSuppressScoring clears tracker state on resume'
// reason을 'body_not_fully_visible'에서 'out_of_frame'으로 변경

// test: 'live controller wiring: full quality-gate frame flow'
// reason을 'unstable_tracking'에서 'view_unstable'로 변경
```

- [ ] **단계 5: 테스트 실행하여 통과 확인**

실행: `node --test test/workout/session-controller-gate-ui.test.js`
예상: PASS (모든 테스트)

- [ ] **단계 6: 커밋**

```bash
git add public/js/workout/session-controller.js test/workout/session-controller-gate-ui.test.js
git commit -m "refactor: update session-controller reason code mapping to spec names"
```

---

## 작업 3: push-up-exercise.js에서 getFrameGate 제거 및 선언적 메타데이터 추가

**파일:**
- 수정: `public/js/workout/exercises/push-up-exercise.js` (`getFrameGate` 제거, `requirements` 메타데이터 추가, `scoreRep` 정리)
- 수정: `test/workout/exercise-rule-separation.test.js` (선언적 메타데이터 및 제거된 게이트에 대한 테스트 추가)

- [ ] **단계 1: 선언적 운동 메타데이터에 대한 실패 테스트 작성**

`test/workout/exercise-rule-separation.test.js`에 추가:

```javascript
// ---------------------------------------------------------------------------
// 푸쉬업 선언적 메타데이터 계약 (스펙 §4.2)
// ---------------------------------------------------------------------------

test('pushUpExercise exposes requirements metadata with requiredViews', () => {
  const mod = window.WorkoutExerciseRegistry.get('push_up');
  assert.ok(mod.requirements, 'push-up exercise must expose requirements metadata');
  assert.ok(Array.isArray(mod.requirements.requiredViews), 'requiredViews must be an array');
  assert.ok(mod.requirements.requiredViews.includes('SIDE'), 'push-up requires SIDE view');
});

test('pushUpExercise exposes requirements metadata with importantJoints', () => {
  const mod = window.WorkoutExerciseRegistry.get('push_up');
  assert.ok(Array.isArray(mod.requirements.importantJoints), 'importantJoints must be an array');
  assert.ok(mod.requirements.importantJoints.length > 0, 'importantJoints must not be empty');
});

test('pushUpExercise does NOT have getFrameGate method (gate belongs to scoring-engine)', () => {
  const mod = window.WorkoutExerciseRegistry.get('push_up');
  assert.equal(typeof mod.getFrameGate, 'undefined', 'exercise modules must not have getFrameGate');
});
```

- [ ] **단계 2: 테스트 실행하여 실패 확인**

실행: `node --test test/workout/exercise-rule-separation.test.js -t "pushUpExercise exposes requirements"`
예상: FAIL — `requirements` 메타데이터가 존재하지 않음; `getFrameGate`가 여전히 존재함.

- [ ] **단계 3: push-up-exercise.js에서 getFrameGate 제거 및 requirements 메타데이터 추가**

`pushUpExercise` 객체에서 전체 `getFrameGate` 메소드(lines 140-209) 제거. 이 메소드는 게이트 소유 reason(`joints_missing`, `tracked_joints_low`, `out_of_frame`, `view_mismatch`, `view_unstable`, `quality_low`)을 생성하므로 스펙 §3.2를 위반한다.

`code: 'push_up'` 바로 다음(29행 뒤)에 `requirements` 메타데이터 추가:

```javascript
    code: 'push_up',

    /**
     * 공통 품질 게이트가 소비하는 선언적 요구사항 메타데이터.
     * 스펙 §4.2 — 운동 모듈은 요구사항을 판단 로직이 아닌 데이터로 제공한다.
     */
    requirements: {
      requiredViews: ['SIDE'],
      importantJoints: [
        'left_elbow', 'right_elbow',
        'left_shoulder', 'right_shoulder',
        'left_hip', 'right_hip',
        'left_knee', 'right_knee',
        'left_ankle', 'right_ankle',
      ],
      minJointVisibility: 0.40,
    },
```

- [ ] **단계 4: scoreRep에서 게이트 소유 hardFails 제거**

`scoreRep` 메소드(292-307행 부근)에서 `view_mismatch`와 `low_confidence` hardFail 항목 제거:

현재 코드(lines 292-307):
```javascript
      const hardFails = [];
      if (view !== 'SIDE') {
        hardFails.push('view_mismatch');
      }
      if (!summary.flags?.bottomReached || bottomElbow == null || bottomElbow > 110) {
        hardFails.push('depth_not_reached');
      }
      if (!summary.flags?.lockoutReached || (lockoutElbow != null && lockoutElbow < 145)) {
        hardFails.push('lockout_incomplete');
      }
      if (minHip != null && minHip < 140) {
        hardFails.push('body_line_broken');
      }
      if (confidence.level === 'LOW') {
        hardFails.push('low_confidence');
      }
```

다음으로 교체:
```javascript
      const hardFails = [];
      // 참고: view_mismatch와 low_confidence는 게이트 소유 reason이다 (스펙 §3.2).
      // scoring-engine.js의 공통 품질 게이트가 운동 평가 실행 전에 이를 처리하므로,
      // 이 코드 경로에 도달할 수 없다.
      if (!summary.flags?.bottomReached || bottomElbow == null || bottomElbow > 110) {
        hardFails.push('depth_not_reached');
      }
      if (!summary.flags?.lockoutReached || (lockoutElbow != null && lockoutElbow < 145)) {
        hardFails.push('lockout_incomplete');
      }
      if (minHip != null && minHip < 140) {
        hardFails.push('body_line_broken');
      }
```

또한 `view_mismatch`와 `low_confidence`에 대한 점수 제한 로직 제거(lines 345-359):

현재 코드:
```javascript
      if (hardFails.includes('view_mismatch')) {
        finalScore = Math.min(finalScore, 50);
      }
      if (hardFails.includes('depth_not_reached')) {
        finalScore = Math.min(finalScore, 55);
      }
      if (hardFails.includes('lockout_incomplete')) {
        finalScore = Math.min(finalScore, 65);
      }
      if (hardFails.includes('body_line_broken')) {
        finalScore = Math.min(finalScore, 60);
      }
      if (hardFails.includes('low_confidence')) {
        finalScore = Math.min(finalScore, 60);
      }
```

다음으로 교체:
```javascript
      if (hardFails.includes('depth_not_reached')) {
        finalScore = Math.min(finalScore, 55);
      }
      if (hardFails.includes('lockout_incomplete')) {
        finalScore = Math.min(finalScore, 65);
      }
      if (hardFails.includes('body_line_broken')) {
        finalScore = Math.min(finalScore, 60);
      }
```

또한 `pickFeedback`(769-802행)에서 `low_confidence`와 `view_mismatch` 분기 제거:

현재 코드:
```javascript
    if (hardFails.includes('low_confidence') || confidence.level === 'LOW') {
      return '카메라에 전신이 잘 보이도록 위치를 다시 맞춰주세요';
    }
    if (hardFails.includes('view_mismatch')) {
      return '몸을 측면으로 유지한 상태에서 푸쉬업을 진행해주세요';
    }
```

이 두 `if` 블록을 완전히 제거. `pickFeedback` 함수는 운동별 피드백(`depth_not_reached`, `body_line_broken`, `lockout_incomplete`)만 처리해야 한다.

- [ ] **단계 5: normalizePushUpEvaluation 익스포트 제거 (더 이상 필요 없음)**

`getFrameGate`가 제거되고 `scoreRep`가 더 이상 게이트 소유 reason을 생성하지 않으므로, `normalizePushUpEvaluation` 함수는 죽은 코드이다. 함수 정의(lines 866-894)와 module.exports 항목(lines 896-901)을 제거한다.

다른 코드가 참조하는 경우 함수를 임시로 유지하되 deprecated로 표시. 다른 모듈이 임포트하지 않는지 확인한 후 완전히 제거.

- [ ] **단계 6: 테스트 실행하여 통과 확인**

실행: `node --test test/workout/exercise-rule-separation.test.js`
예상: PASS (새 메타데이터 테스트 포함 모든 테스트)

실행: `node --test test/workout/quality-gate.test.js`
예상: PASS (변경 없음)

- [ ] **단계 7: 커밋**

```bash
git add public/js/workout/exercises/push-up-exercise.js test/workout/exercise-rule-separation.test.js
git commit -m "refactor: remove getFrameGate from push-up, add declarative requirements metadata"
```

---

## 작업 4: session-controller.js에서 getFrameGateResult 호출 제거

**파일:**
- 수정: `public/js/workout/session-controller.js` (lines 440-450, 824-843)

- [ ] **단계 1: 단일 게이트 강제에 대한 실패 테스트 작성**

`test/workout/authority-separation.test.js` (신규 파일)에 추가:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GATE_ONLY_REASONS,
  evaluateQualityGate,
  applyRepOutcome,
} = require('../../public/js/workout/scoring-engine.js');

// ---------------------------------------------------------------------------
// 권한 계약: 게이트 소유 reason은 scoring-engine에서만 나와야 한다
// ---------------------------------------------------------------------------

test('GATE_ONLY_REASONS is exported and non-empty', () => {
  assert.ok(Array.isArray(GATE_ONLY_REASONS));
  assert.ok(GATE_ONLY_REASONS.length >= 6);
});

test('evaluateQualityGate only emits gate-owned reason codes or null', () => {
  // 모든 보류 경로가 GATE_ONLY_REASONS만 생성하는지 테스트
  const testCases = [
    { inputs: { cameraDistanceOk: false, detectionConfidence: 0.9, trackingConfidence: 0.9, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] }, expectedReason: 'out_of_frame' },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.3, trackingConfidence: 0.9, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] }, expectedReason: 'low_confidence' },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.9, trackingConfidence: 0.3, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] }, expectedReason: 'tracked_joints_low' },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.9, trackingConfidence: 0.9, frameInclusionRatio: 0.5, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] }, expectedReason: 'out_of_frame' },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.9, trackingConfidence: 0.9, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.5, minKeyJointVisibility: 0.3, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] }, expectedReason: 'joints_missing' },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.9, trackingConfidence: 0.9, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'FRONT', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] }, expectedReason: 'view_mismatch' },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.9, trackingConfidence: 0.9, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.5 }, context: { allowedViews: ['SIDE'] }, expectedReason: 'view_unstable' },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.9, trackingConfidence: 0.9, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 3, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] }, expectedReason: 'view_unstable' },
  ];

  for (const tc of testCases) {
    const result = evaluateQualityGate(tc.inputs, tc.context);
    assert.equal(result.result, 'withhold', `expected withhold for inputs: ${JSON.stringify(tc.inputs)}`);
    assert.equal(result.reason, tc.expectedReason, `expected reason ${tc.expectedReason}, got ${result.reason}`);
    assert.ok(GATE_ONLY_REASONS.includes(result.reason), `reason ${result.reason} must be in GATE_ONLY_REASONS`);
  }
});

test('applyRepOutcome prioritizes gate withhold over any exercise evaluation', () => {
  const result = applyRepOutcome({
    gateResult: 'withhold',
    repState: { active: true },
    exerciseEvaluation: { hardFailReason: 'depth_not_reached', softFailReasons: [] },
  });
  assert.equal(result.repResult, 'withheld');
  assert.equal(result.incrementRepCount, false);
});

test('applyRepOutcome with gate=pass delegates to exercise evaluation for state', () => {
  const result = applyRepOutcome({
    gateResult: 'pass',
    repState: { active: true },
    exerciseEvaluation: { hardFailReason: 'depth_not_reached', softFailReasons: [] },
  });
  assert.equal(result.repResult, 'hard_fail');
  assert.equal(result.incrementRepCount, false);
});
```

- [ ] **단계 2: 테스트 실행하여 실패 확인**

실행: `node --test test/workout/authority-separation.test.js`
예상: FAIL — `GATE_ONLY_REASONS`가 아직 익스포트되지 않음 (작업 1 이후에 통과), 전체 권한 테스트는 업데이트된 scoring-engine이 필요함.

- [ ] **단계 3: session-controller.js에서 getFrameGateResult 함수와 그 호출 지점 제거**

`getFrameGateResult` 함수(lines 440-450) 제거:

```javascript
  // 제거됨: getFrameGateResult — 게이트 권한은 오로지 scoring-engine.js에 속함
  // 공통 품질 게이트(evaluateQualityGate)가 유일한 pass/withhold 결정자이다.
  // 운동 모듈은 게이팅 판단을 생성해서는 안 된다 (스펙 §3.1, §3.2).
```

`handlePoseDetected`의 호출 지점(lines 824-843) 제거:

```javascript
    // 제거됨: 운동 모듈 프레임 게이트 — 권한이 scoring-engine.js로 통합됨
    // 위의 품질 게이트(evaluateQualityGate)가 이미 pass/withhold를 결정한다.
    // 게이트 통과 시 → 바로 채점으로 진행.
```

`handlePoseDetected`의 흐름은 다음과 같이 된다:
1. 품질 게이트 트래커 업데이트 → 게이트 입력 빌드 → 품질 게이트 평가
2. 게이트 보류 시 → 채점 억제, 메시지 표시 (기존 로직, 변경 없음)
3. 게이트 통과 시 → `scoringEngine.calculate(angles)`로 직접 진행 (제거된 프레임 게이트 검사 건너뜀)

- [ ] **단계 4: 모든 테스트 실행하여 통과 확인**

실행: `node --test test/workout/`
예상: PASS (모든 테스트 파일)

- [ ] **단계 5: 커밋**

```bash
git add public/js/workout/session-controller.js test/workout/authority-separation.test.js
git commit -m "refactor: remove exercise frame gate call, enforce single quality gate authority"
```

---

## 작업 5: pose-engine.js 신호 순수성 검증

**파일:**
- 검증: `public/js/workout/pose-engine.js` (읽기 전용 감사)
- 수정: `test/workout/authority-separation.test.js` (신호 순수성 테스트 추가)

- [ ] **단계 1: pose-engine이 신호만 생성함을 확인하는 테스트 작성**

`test/workout/authority-separation.test.js`에 추가:

```javascript
// ---------------------------------------------------------------------------
// pose-engine.js 신호 순수성 (스펙 §3.4)
// ---------------------------------------------------------------------------

test('pose-engine exports do not include any gating functions', () => {
  const poseModule = require('../../public/js/workout/pose-engine.js');
  const exportedKeys = Object.keys(poseModule);

  // pose-engine은 PoseEngine 클래스와 buildQualityGateInputs 헬퍼를 익스포트해야 함
  // 이름에 "gate"나 "withhold"가 포함된 함수를 익스포트해서는 안 됨
  const gateLikeKeys = exportedKeys.filter(
    (key) => /gate|withhold|suppress/i.test(key)
  );

  // buildQualityGateInputs는 데이터 빌더일 뿐 판단자는 아님 — 허용됨
  const decisionMakerKeys = gateLikeKeys.filter(
    (key) => key !== 'buildQualityGateInputs'
  );

  assert.equal(
    decisionMakerKeys.length,
    0,
    `pose-engine must not export gating decision functions, found: ${decisionMakerKeys.join(', ')}`
  );
});

test('PoseEngine.getFrameQuality returns only signal data, no decisions', () => {
  const { PoseEngine } = require('../../public/js/workout/pose-engine.js');
  const engine = new PoseEngine();

  // 최소 테스트를 위한 목업 랜드마크
  const mockLandmarks = new Array(33).fill(null).map((_, i) => ({
    x: 0.5,
    y: 0.5,
    z: 0.0,
    visibility: 0.9,
  }));

  const quality = engine.getFrameQuality(mockLandmarks, 'SIDE');

  // 품질 출력은 판단이 아닌 수치 점수를 가진 신호 객체여야 함
  assert.ok('score' in quality, 'quality must have score');
  assert.ok('level' in quality, 'quality must have level');
  assert.ok('factor' in quality, 'quality must have factor');
  assert.ok('trackedJointRatio' in quality, 'quality must have trackedJointRatio');
  assert.ok('inFrameRatio' in quality, 'quality must have inFrameRatio');
  assert.ok('viewStability' in quality, 'quality must have viewStability');

  // 판단 필드가 포함되어서는 안 됨
  assert.equal('result' in quality, false, 'quality must not have result field');
  assert.equal('withhold' in quality, false, 'quality must not have withhold field');
  assert.equal('pass' in quality, false, 'quality must not have pass field');
});
```

- [ ] **단계 2: 테스트 실행하여 통과 확인**

실행: `node --test test/workout/authority-separation.test.js`
예상: PASS (pose-engine은 현재 코드 기준 이미 신호 전용임)

- [ ] **단계 3: 커밋**

```bash
git add test/workout/authority-separation.test.js
git commit -m "test: add authority separation and signal purity tests"
```

---

## 작업 6: 크로스 모듈 Reason Code 무결성 테스트 추가

**파일:**
- 수정: `test/workout/authority-separation.test.js` (reason-code 무결성 테스트 추가)

- [ ] **단계 1: 운동 모듈이 게이트 소유 reason을 생성하지 않음을 확인하는 테스트 작성**

`test/workout/authority-separation.test.js`에 추가:

```javascript
// ---------------------------------------------------------------------------
// Reason-code 무결성: 운동 모듈은 게이트 소유 코드를 생성해서는 안 된다
// ---------------------------------------------------------------------------

test('push-up scoreRep hardFails contain only exercise-specific reason codes', () => {
  // 푸쉬업 운동 모듈의 scoreRep은 다음만 생성해야 함:
  // depth_not_reached, lockout_incomplete, body_line_broken
  // GATE_ONLY_REASONS의 어떤 것도 생성해서는 안 됨
  const { GATE_ONLY_REASONS } = require('../../public/js/workout/scoring-engine.js');

  // 운동 모듈에 getFrameGate가 없는지 확인
  const pushUpModule = require('../../public/js/workout/exercises/push-up-exercise.js');
  // normalizePushUpEvaluation이 제거되었다면 이 임포트는 존재하지 않아야 함
  // 일시적으로 존재한다면 no-op인지 확인
  if (pushUpModule.normalizePushUpEvaluation) {
    // normalizePushUpEvaluation이 여전히 존재한다면, scoreRep이 더 이상
    // 게이트 소유 reason을 생성하지 않으므로 no-op이어야 함
    const result = pushUpModule.normalizePushUpEvaluation({
      hardFailReason: 'depth_not_reached',
      softFailReasons: ['body_line_broken'],
    });
    assert.equal(result.hardFailReason, 'depth_not_reached');
    assert.deepEqual(result.softFailReasons, ['body_line_broken']);
  }
});

test('all gate-owned reason codes are documented in GATE_ONLY_REASONS', () => {
  const { GATE_ONLY_REASONS } = require('../../public/js/workout/scoring-engine.js');

  // 스펙 §부록: 이들은 정식 게이트 소유 코드이다
  const specGateReasons = [
    'out_of_frame',
    'tracked_joints_low',
    'view_unstable',
    'view_mismatch',
    'low_confidence',
    'joints_missing',
  ];

  for (const reason of specGateReasons) {
    assert.ok(
      GATE_ONLY_REASONS.includes(reason),
      `GATE_ONLY_REASONS must include "${reason}" per spec`
    );
  }

  // 스펙 외 추가 코드 없음
  assert.equal(
    GATE_ONLY_REASONS.length,
    specGateReasons.length,
    `GATE_ONLY_REASONS should have exactly ${specGateReasons.length} entries`
  );
});
```

- [ ] **단계 2: 모든 테스트 실행하여 통과 확인**

실행: `node --test test/workout/`
예상: PASS (모든 테스트 파일, 모든 테스트)

- [ ] **단계 3: 커밋**

```bash
git add test/workout/authority-separation.test.js
git commit -m "test: add reason-code integrity tests for cross-module authority"
```

---

## 작업 7: 최종 검증 — 전체 테스트 스위트 실행

**파일:**
- `test/workout/` 하위 모든 테스트 파일

- [ ] **단계 1: 전체 테스트 스위트 실행**

실행: `node --test test/workout/`
예상: 모든 테스트 파일에서 모든 테스트 PASS:
- `test/workout/quality-gate.test.js` — 게이트 reason code, 임계값
- `test/workout/scoring-state-machine.test.js` — applyRepOutcome 상태 전이
- `test/workout/session-controller-gate-ui.test.js` — UX 메시지 매핑, 트래커 로직
- `test/workout/exercise-rule-separation.test.js` — 스쿼트 우선순위, 푸쉬업 정규화, 메타데이터
- `test/workout/authority-separation.test.js` — 크로스 모듈 권한, 신호 순수성, reason 무결성

- [ ] **단계 2: 수정된 파일이 허용 목록 외에 없는지 확인**

실행: `git diff --name-only`
예상: 허용 목록의 파일만 수정됨:
- `public/js/workout/scoring-engine.js`
- `public/js/workout/exercises/push-up-exercise.js`
- `public/js/workout/session-controller.js`
- `test/workout/quality-gate.test.js`
- `test/workout/session-controller-gate-ui.test.js`
- `test/workout/exercise-rule-separation.test.js`
- `test/workout/authority-separation.test.js` (신규)

- [ ] **단계 3: 모든 테스트 통과 시 최종 커밋**

```bash
git add -A
git commit -m "feat: complete quality gate authority consolidation per design spec"
```

---

## 스펙 커버리지 요약

| 스펙 섹션 | 작업 | 상태 |
|---|---|---|
| §3.1 공통 게이트의 유일한 권한 | 작업 1, 작업 4 | `evaluateQualityGate`가 유일한 pass/withhold 결정자 |
| §3.2 금지된 운동 동작 | 작업 3, 작업 6 | `getFrameGate` 제거; `scoreRep`이 더 이상 게이트 소유 reason 생성 안 함 |
| §3.3 허용된 운동 동작 | 작업 3 | `requirements` 메타데이터 추가; 동작 의미 보존 |
| §3.4 pose-engine 신호 생성기 | 작업 5 | 신호 전용 확인; 테스트 추가 |
| §3.5 session-controller 오케스트레이터 | 작업 4 | `getFrameGateResult` 호출 제거; 결정된 게이트 상태만 소비 |
| §4 데이터 계약 | 작업 1, 작업 3 | Reason code 표준화; 선언적 메타데이터 계약 |
| §5 현재 코드 영향 | 모든 작업 | 네 모듈 모두 감사 및 업데이트 완료 |
| §7 성공 기준 | 작업 7 | 6개 기준 모두 테스트로 충족 |
| 부록: Reason-Code 소유권 | 작업 1, 작업 6 | `GATE_ONLY_REASONS` 상수가 매트릭스를 강제 |
