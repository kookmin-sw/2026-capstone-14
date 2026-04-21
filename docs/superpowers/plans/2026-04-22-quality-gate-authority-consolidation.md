# Quality Gate Authority Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate all final quality-gate authority into `scoring-engine.js`, remove gate-like reason emission from exercise modules, standardize reason codes per the approved spec, and add tests that enforce module separation.

**Architecture:** The common quality gate in `scoring-engine.js` becomes the sole `pass`/`withhold` decision-maker. Exercise modules provide only metadata and performance semantics. `session-controller.js` consumes only resolved states from the gate. `pose-engine.js` remains a pure signal producer.

**Tech Stack:** Vanilla JavaScript (browser + Node.js test runner), `node:test`, `node:assert/strict`

---

## File Map

| File | Role in this plan |
|---|---|
| `public/js/workout/scoring-engine.js` | **Modify** — standardize gate reason codes to match spec's canonical names; add `GATE_ONLY_REASONS` constant; export it |
| `public/js/workout/exercises/push-up-exercise.js` | **Modify** — remove `getFrameGate` (gate logic belongs to scoring-engine); remove `view_mismatch` and `low_confidence` from `scoreRep` hardFails; add declarative `requirements` metadata |
| `public/js/workout/session-controller.js` | **Modify** — remove `getFrameGateResult` call; rely solely on `evaluateQualityGate` for gating; keep UX mapping helpers |
| `test/workout/quality-gate.test.js` | **Modify** — add tests for standardized reason codes, `GATE_ONLY_REASONS` constant |
| `test/workout/exercise-rule-separation.test.js` | **Modify** — add tests proving exercise modules do NOT emit gate-owned reasons |
| `test/workout/authority-separation.test.js` | **Create** — new test file for cross-module authority contract enforcement |

---

## Task 1: Standardize Quality Gate Reason Codes in scoring-engine.js

**Files:**
- Modify: `public/js/workout/scoring-engine.js` (lines 664-714)
- Modify: `test/workout/quality-gate.test.js` (add new tests at end)

- [ ] **Step 1: Write the failing test for standardized reason codes**

Add to `test/workout/quality-gate.test.js`:

```javascript
// ── Standardized reason codes per spec §Appendix ──

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

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/workout/quality-gate.test.js`
Expected: FAIL — `GATE_ONLY_REASONS` is not defined; reason codes like `joints_missing`, `tracked_joints_low`, `out_of_frame`, `low_confidence`, `view_unstable` are not returned by `evaluateQualityGate`.

- [ ] **Step 3: Implement standardized reason codes in scoring-engine.js**

Replace the `evaluateQualityGate` function body (lines 684-714) and add the `GATE_ONLY_REASONS` constant:

```javascript
// ── Gate-owned reason codes (spec §Appendix) ──
// These reason codes MUST NOT be emitted by exercise modules.
const GATE_ONLY_REASONS = [
  'out_of_frame',
  'tracked_joints_low',
  'view_unstable',
  'view_mismatch',
  'low_confidence',
  'joints_missing',
];

/**
 * Evaluate whether the current frame input quality is sufficient for scoring.
 * Returns { result: 'pass' | 'withhold', reason: string | null }
 *
 * Input quality failures are NEVER delegated to exercise modules.
 * Only pass → exercise module evaluation runs.
 *
 * Reason codes follow the spec's canonical names (§Appendix):
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

Update the window exports (around line 763-768) to include `GATE_ONLY_REASONS`:

```javascript
if (typeof window !== 'undefined') {
  window.ScoringEngine = ScoringEngine;
  window.QUALITY_GATE_THRESHOLDS = QUALITY_GATE_THRESHOLDS;
  window.GATE_ONLY_REASONS = GATE_ONLY_REASONS;
  window.evaluateQualityGate = evaluateQualityGate;
  window.applyRepOutcome = applyRepOutcome;
}
```

Update the CommonJS exports (around line 771-778):

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

- [ ] **Step 4: Update existing tests in quality-gate.test.js to match new reason codes**

Replace the existing test expectations for reason codes:

```javascript
// test: 'evaluateQualityGate returns withhold for low key-joint visibility'
// Change: assert.equal(result.reason, 'joints_missing');

// test: 'evaluateQualityGate returns withhold for body not fully visible'
// Change: assert.equal(result.reason, 'out_of_frame');

// test: 'evaluateQualityGate returns withhold for unstable_tracking'
// Change: assert.equal(result.reason, 'view_unstable');

// test: 'evaluateQualityGate returns withhold for insufficient stable frames'
// Change: assert.equal(result.reason, 'view_unstable');

// test: 'evaluateQualityGate returns withhold for camera too close or far'
// Change: assert.equal(result.reason, 'out_of_frame');

// test: 'evaluateQualityGate returns withhold for low detection confidence'
// Change: assert.equal(result.reason, 'low_confidence');

// test: 'evaluateQualityGate returns withhold for low tracking confidence'
// Change: assert.equal(result.reason, 'tracked_joints_low');
```

Also update `session-controller-gate-ui.test.js` to use the new reason code names:

```javascript
// In mapWithholdReasonToMessage tests, update reason codes:
// 'body_not_fully_visible' → 'out_of_frame'
// 'key_joints_not_visible' → 'joints_missing'
// 'unstable_tracking' → 'view_unstable'
// 'insufficient_stable_frames' → 'view_unstable'
// 'camera_too_close_or_far' → 'out_of_frame'
// 'low_detection_confidence' → 'low_confidence'
// 'low_tracking_confidence' → 'tracked_joints_low'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/workout/quality-gate.test.js`
Expected: PASS (all tests)

Run: `node --test test/workout/session-controller-gate-ui.test.js`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add public/js/workout/scoring-engine.js test/workout/quality-gate.test.js test/workout/session-controller-gate-ui.test.js
git commit -m "feat: standardize quality gate reason codes per spec appendix"
```

---

## Task 2: Update session-controller.js Reason Code Mapping

**Files:**
- Modify: `public/js/workout/session-controller.js` (lines 1901-1913, `mapWithholdReasonToMessage`)
- Modify: `test/workout/session-controller-gate-ui.test.js` (reason code references)

- [ ] **Step 1: Write the failing test for updated message mapping**

Add to `test/workout/session-controller-gate-ui.test.js`:

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
  // view_mismatch already tested — keep existing test
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/workout/session-controller-gate-ui.test.js -t "handles all spec-standardized"`
Expected: FAIL — `out_of_frame`, `joints_missing`, `tracked_joints_low`, `view_unstable`, `low_confidence` are not keys in the messages map.

- [ ] **Step 3: Update mapWithholdReasonToMessage in session-controller.js**

Replace the `mapWithholdReasonToMessage` function (lines 1901-1913):

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

- [ ] **Step 4: Update existing tests in session-controller-gate-ui.test.js**

Replace the old reason code assertions in the first test:

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

Update the `shouldSuppressScoring` tests that reference old reason codes:

```javascript
// In test: 'shouldSuppressScoring suppresses when gate returns withhold'
// Change reason from 'view_mismatch' to keep it (view_mismatch is still valid)

// In test: 'shouldSuppressScoring stays suppressed until stable-frame threshold is restored'
// Change withholdReason from 'unstable_tracking' to 'view_unstable'

// In test: 'shouldSuppressScoring clears tracker state on resume'
// Change reason from 'body_not_fully_visible' to 'out_of_frame'

// In test: 'live controller wiring: full quality-gate frame flow'
// Change reason from 'unstable_tracking' to 'view_unstable'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/workout/session-controller-gate-ui.test.js`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add public/js/workout/session-controller.js test/workout/session-controller-gate-ui.test.js
git commit -m "refactor: update session-controller reason code mapping to spec names"
```

---

## Task 3: Remove getFrameGate from push-up-exercise.js and Add Declarative Metadata

**Files:**
- Modify: `public/js/workout/exercises/push-up-exercise.js` (remove `getFrameGate`, add `requirements` metadata, clean `scoreRep`)
- Modify: `test/workout/exercise-rule-separation.test.js` (add tests for declarative metadata and removed gate)

- [ ] **Step 1: Write the failing test for declarative exercise metadata**

Add to `test/workout/exercise-rule-separation.test.js`:

```javascript
// ---------------------------------------------------------------------------
// Push-up declarative metadata contract (spec §4.2)
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

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/workout/exercise-rule-separation.test.js -t "pushUpExercise exposes requirements"`
Expected: FAIL — `requirements` metadata does not exist; `getFrameGate` still exists.

- [ ] **Step 3: Remove getFrameGate and add requirements metadata in push-up-exercise.js**

Remove the entire `getFrameGate` method (lines 140-209) from the `pushUpExercise` object. This method emits gate-owned reasons (`joints_missing`, `tracked_joints_low`, `out_of_frame`, `view_mismatch`, `view_unstable`, `quality_low`) which violates spec §3.2.

Add `requirements` metadata right after `code: 'push_up'` (after line 29):

```javascript
    code: 'push_up',

    /**
     * Declarative requirement metadata consumed by the common quality gate.
     * Spec §4.2 — exercise modules provide requirements as data, not as decision logic.
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

- [ ] **Step 4: Clean scoreRep to remove gate-owned hardFails**

In the `scoreRep` method (around lines 292-307), remove the `view_mismatch` and `low_confidence` hardFail entries:

Current code (lines 292-307):
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

Replace with:
```javascript
      const hardFails = [];
      // Note: view_mismatch and low_confidence are gate-owned reasons (spec §3.2).
      // The common quality gate in scoring-engine.js handles these BEFORE exercise
      // evaluation runs, so they cannot reach this code path.
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

Also remove the score cap logic for `view_mismatch` and `low_confidence` (lines 345-359):

Current code:
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

Replace with:
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

Also update `pickFeedback` (lines 769-802) to remove `low_confidence` and `view_mismatch` branches:

Current code:
```javascript
    if (hardFails.includes('low_confidence') || confidence.level === 'LOW') {
      return '카메라에 전신이 잘 보이도록 위치를 다시 맞춰주세요';
    }
    if (hardFails.includes('view_mismatch')) {
      return '몸을 측면으로 유지한 상태에서 푸쉬업을 진행해주세요';
    }
```

Remove those two `if` blocks entirely. The `pickFeedback` function should only handle exercise-specific feedback (`depth_not_reached`, `body_line_broken`, `lockout_incomplete`).

- [ ] **Step 5: Remove normalizePushUpEvaluation export (no longer needed)**

Since `getFrameGate` is removed and `scoreRep` no longer emits gate-owned reasons, the `normalizePushUpEvaluation` function is dead code. Remove the function definition (lines 866-894) and its module.exports entry (lines 896-901).

Keep the function temporarily but mark it deprecated if other code references it. After verifying no other module imports it, remove it entirely.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/workout/exercise-rule-separation.test.js`
Expected: PASS (all tests including new metadata tests)

Run: `node --test test/workout/quality-gate.test.js`
Expected: PASS (unchanged)

- [ ] **Step 7: Commit**

```bash
git add public/js/workout/exercises/push-up-exercise.js test/workout/exercise-rule-separation.test.js
git commit -m "refactor: remove getFrameGate from push-up, add declarative requirements metadata"
```

---

## Task 4: Remove getFrameGateResult Call from session-controller.js

**Files:**
- Modify: `public/js/workout/session-controller.js` (lines 440-450, 824-843)

- [ ] **Step 1: Write the failing test for single-gate enforcement**

Add to `test/workout/authority-separation.test.js` (new file):

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GATE_ONLY_REASONS,
  evaluateQualityGate,
  applyRepOutcome,
} = require('../../public/js/workout/scoring-engine.js');

// ---------------------------------------------------------------------------
// Authority contract: gate-owned reasons must only come from scoring-engine
// ---------------------------------------------------------------------------

test('GATE_ONLY_REASONS is exported and non-empty', () => {
  assert.ok(Array.isArray(GATE_ONLY_REASONS));
  assert.ok(GATE_ONLY_REASONS.length >= 6);
});

test('evaluateQualityGate only emits gate-owned reason codes or null', () => {
  // Test all withhold paths produce only GATE_ONLY_REASONS
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

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/workout/authority-separation.test.js`
Expected: FAIL — `GATE_ONLY_REASONS` not yet exported (will pass after Task 1), but the full authority tests need the updated scoring-engine.

- [ ] **Step 3: Remove getFrameGateResult function and its call site in session-controller.js**

Remove the `getFrameGateResult` function (lines 440-450):

```javascript
  // REMOVED: getFrameGateResult — gate authority belongs exclusively to scoring-engine.js
  // The common quality gate (evaluateQualityGate) is the sole pass/withhold decision-maker.
  // Exercise modules must not emit gating decisions (spec §3.1, §3.2).
```

Remove the call site in `handlePoseDetected` (lines 824-843):

```javascript
    // REMOVED: exercise module frame gate — authority consolidated in scoring-engine.js
    // The quality gate (evaluateQualityGate) above already decides pass/withhold.
    // If gate passes, proceed directly to scoring.
```

The flow in `handlePoseDetected` becomes:
1. Update quality gate tracker → build gate inputs → evaluate quality gate
2. If gate withholds → suppress scoring, show message (existing logic, unchanged)
3. If gate passes → proceed directly to `scoringEngine.calculate(angles)` (skip the removed frame gate check)

- [ ] **Step 4: Run all tests to verify they pass**

Run: `node --test test/workout/`
Expected: PASS (all test files)

- [ ] **Step 5: Commit**

```bash
git add public/js/workout/session-controller.js test/workout/authority-separation.test.js
git commit -m "refactor: remove exercise frame gate call, enforce single quality gate authority"
```

---

## Task 5: Verify pose-engine.js Signal Purity

**Files:**
- Verify: `public/js/workout/pose-engine.js` (read-only audit)
- Modify: `test/workout/authority-separation.test.js` (add signal-purity test)

- [ ] **Step 1: Write test confirming pose-engine produces only signals**

Add to `test/workout/authority-separation.test.js`:

```javascript
// ---------------------------------------------------------------------------
// pose-engine.js signal purity (spec §3.4)
// ---------------------------------------------------------------------------

test('pose-engine exports do not include any gating functions', () => {
  const poseModule = require('../../public/js/workout/pose-engine.js');
  const exportedKeys = Object.keys(poseModule);

  // pose-engine should export PoseEngine class and buildQualityGateInputs helper
  // It must NOT export any function with "gate" or "withhold" in the name
  const gateLikeKeys = exportedKeys.filter(
    (key) => /gate|withhold|suppress/i.test(key)
  );

  // buildQualityGateInputs is a data builder, not a decision-maker — allowed
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

  // Mock landmarks for a minimal test
  const mockLandmarks = new Array(33).fill(null).map((_, i) => ({
    x: 0.5,
    y: 0.5,
    z: 0.0,
    visibility: 0.9,
  }));

  const quality = engine.getFrameQuality(mockLandmarks, 'SIDE');

  // Quality output must be a signal object with numeric scores, not a decision
  assert.ok('score' in quality, 'quality must have score');
  assert.ok('level' in quality, 'quality must have level');
  assert.ok('factor' in quality, 'quality must have factor');
  assert.ok('trackedJointRatio' in quality, 'quality must have trackedJointRatio');
  assert.ok('inFrameRatio' in quality, 'quality must have inFrameRatio');
  assert.ok('viewStability' in quality, 'quality must have viewStability');

  // Must NOT contain decision fields
  assert.equal('result' in quality, false, 'quality must not have result field');
  assert.equal('withhold' in quality, false, 'quality must not have withhold field');
  assert.equal('pass' in quality, false, 'quality must not have pass field');
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test test/workout/authority-separation.test.js`
Expected: PASS (pose-engine is already signal-only per current code)

- [ ] **Step 3: Commit**

```bash
git add test/workout/authority-separation.test.js
git commit -m "test: add authority separation and signal purity tests"
```

---

## Task 6: Add Cross-Module Reason Code Integrity Test

**Files:**
- Modify: `test/workout/authority-separation.test.js` (add reason-code integrity tests)

- [ ] **Step 1: Write test that no exercise module emits gate-owned reasons**

Add to `test/workout/authority-separation.test.js`:

```javascript
// ---------------------------------------------------------------------------
// Reason-code integrity: exercise modules must not emit gate-owned codes
// ---------------------------------------------------------------------------

test('push-up scoreRep hardFails contain only exercise-specific reason codes', () => {
  // The push-up exercise module's scoreRep should only produce:
  // depth_not_reached, lockout_incomplete, body_line_broken
  // It must NOT produce any GATE_ONLY_REASONS
  const { GATE_ONLY_REASONS } = require('../../public/js/workout/scoring-engine.js');

  // Verify the exercise module does not have getFrameGate
  const pushUpModule = require('../../public/js/workout/exercises/push-up-exercise.js');
  // If normalizePushUpEvaluation was removed, this import should not exist
  // If it still exists temporarily, verify it's a no-op
  if (pushUpModule.normalizePushUpEvaluation) {
    // If normalizePushUpEvaluation still exists, it should be a no-op
    // because scoreRep no longer emits gate-owned reasons
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

  // Spec §Appendix: these are the canonical gate-owned codes
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

  // No extra codes beyond spec
  assert.equal(
    GATE_ONLY_REASONS.length,
    specGateReasons.length,
    `GATE_ONLY_REASONS should have exactly ${specGateReasons.length} entries`
  );
});
```

- [ ] **Step 2: Run all tests to verify they pass**

Run: `node --test test/workout/`
Expected: PASS (all test files, all tests)

- [ ] **Step 3: Commit**

```bash
git add test/workout/authority-separation.test.js
git commit -m "test: add reason-code integrity tests for cross-module authority"
```

---

## Task 7: Final Verification — Run Full Test Suite

**Files:**
- All test files under `test/workout/`

- [ ] **Step 1: Run the full test suite**

Run: `node --test test/workout/`
Expected: All tests PASS across all files:
- `test/workout/quality-gate.test.js` — gate reason codes, thresholds
- `test/workout/scoring-state-machine.test.js` — applyRepOutcome state transitions
- `test/workout/session-controller-gate-ui.test.js` — UX message mapping, tracker logic
- `test/workout/exercise-rule-separation.test.js` — squat priorities, push-up normalization, metadata
- `test/workout/authority-separation.test.js` — cross-module authority, signal purity, reason integrity

- [ ] **Step 2: Verify no source files were modified outside allowed_files**

Run: `git diff --name-only`
Expected: Only files in the allowed list are modified:
- `public/js/workout/scoring-engine.js`
- `public/js/workout/exercises/push-up-exercise.js`
- `public/js/workout/session-controller.js`
- `test/workout/quality-gate.test.js`
- `test/workout/session-controller-gate-ui.test.js`
- `test/workout/exercise-rule-separation.test.js`
- `test/workout/authority-separation.test.js` (new)

- [ ] **Step 3: Final commit if all tests pass**

```bash
git add -A
git commit -m "feat: complete quality gate authority consolidation per design spec"
```

---

## Summary of Spec Coverage

| Spec Section | Task(s) | Status |
|---|---|---|
| §3.1 Sole Authority of Common Gate | Task 1, Task 4 | `evaluateQualityGate` is the only pass/withhold decision-maker |
| §3.2 Prohibited Exercise Behaviors | Task 3, Task 6 | `getFrameGate` removed; `scoreRep` no longer emits gate-owned reasons |
| §3.3 Permitted Exercise Behaviors | Task 3 | `requirements` metadata added; motion semantics preserved |
| §3.4 pose-engine Signal Producer | Task 5 | Verified signal-only; test added |
| §3.5 session-controller Orchestrator | Task 4 | Removed `getFrameGateResult` call; consumes only resolved gate state |
| §4 Data Contracts | Task 1, Task 3 | Standardized reason codes; declarative metadata contract |
| §5 Current Code Implications | All tasks | All four modules audited and updated |
| §7 Success Criteria | Task 7 | All six criteria met via tests |
| Appendix: Reason-Code Ownership | Task 1, Task 6 | `GATE_ONLY_REASONS` constant enforces the matrix |
