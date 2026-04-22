# Session Controller 분해 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `public/js/workout/session-controller.js`를 오케스트레이션 중심 파일로 축소하고, UI 렌더링, 루틴 진행 정책, 세션 측 품질 게이트 보조 로직을 별도 모듈로 분리한다.

**Architecture:** 현재 브라우저 전역 스크립트 구조를 유지한다. 새 모듈은 `window.*` 전역 팩토리 또는 네임스페이스로 노출하고, Node 테스트를 위해 CommonJS export guard를 함께 둔다. `session-controller.js`는 `createSessionUi`, `createRoutineSessionManager`, `SessionQualityGate`를 조합하는 최상위 오케스트레이터로 정리한다.

**Tech Stack:** Vanilla browser JavaScript, EJS script loading, Node `--test`, CommonJS test exports, browser global namespaces

---

## File Map

### 새로 만들 파일

- `public/js/workout/quality-gate-session.js`
  - 세션 측 품질 게이트 보조 로직 전담
  - withhold 메시지 매핑, stable-frame tracker, gate input builder, suppression / resume helper 포함

- `public/js/workout/session-ui.js`
  - DOM 렌더링 전담
  - 점수판, 상태 뱃지, 루틴 진행 UI, 플랭크 UI, alert / toast 렌더링 포함

- `public/js/workout/routine-session-manager.js`
  - 루틴 전용 진행 정책 전담
  - 단계 전환, 세트 완료 저장, 다음 세트/다음 운동/루틴 완료 액션 결정 포함

- `test/workout/quality-gate-session.test.js`
  - `quality-gate-session.js` 순수 헬퍼 테스트

- `test/workout/session-ui.test.js`
  - `session-ui.js`의 DOM 렌더링 팩토리 테스트

- `test/workout/routine-session-manager.test.js`
  - `routine-session-manager.js`의 루틴 액션 해석 테스트

### 수정할 파일

- `public/js/workout/session-controller.js`
  - helper 정의 제거
  - 새 모듈 호출로 orchestration만 남기기

- `views/workout/session.ejs`
  - 새 스크립트 파일 로드 순서 추가

- `test/workout/session-controller-gate-ui.test.js`
  - 기존 품질 게이트 헬퍼 테스트를 `quality-gate-session.js` 대상으로 전환

### 유지할 기존 런타임 파일

- `public/js/workout/scoring-engine.js`
  - 최종 quality gate authority 유지

- `public/js/workout/rep-counter.js`
  - rep / time 상태 머신 유지

- `public/js/workout/session-buffer.js`
  - 세션 이벤트/score/rep 저장 책임 유지

---

### Task 1: 품질 게이트 세션 헬퍼 분리

**Files:**
- Create: `public/js/workout/quality-gate-session.js`
- Modify: `public/js/workout/session-controller.js`
- Modify: `test/workout/session-controller-gate-ui.test.js`
- Create: `test/workout/quality-gate-session.test.js`

- [ ] **Step 1: 새 helper 모듈 테스트를 먼저 작성한다**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mapWithholdReasonToMessage,
  shouldResumeScoring,
  createQualityGateTracker,
  updateQualityGateTracker,
  buildGateInputsFromPoseData,
  shouldSuppressScoring,
  isFrameStable,
  shouldMirrorSourcePreview,
} = require('../../public/js/workout/quality-gate-session.js');

function makePoseData(qualityLevel, viewStability, view = 'FRONT') {
  return {
    angles: {
      view,
      quality: {
        level: qualityLevel,
        viewStability,
        avgVisibility: 0.8,
        minVisibility: 0.75,
        visibleRatio: 0.75,
        inFrameRatio: 0.95,
      },
    },
  };
}

test('mapWithholdReasonToMessage maps gate reasons to Korean guidance', () => {
  assert.equal(
    mapWithholdReasonToMessage('view_mismatch'),
    '현재 운동은 옆면 시점이 필요합니다.'
  );
});

test('shouldResumeScoring requires the full stable-frame streak', () => {
  assert.equal(shouldResumeScoring({ stableFrameCount: 7, threshold: 8 }), false);
  assert.equal(shouldResumeScoring({ stableFrameCount: 8, threshold: 8 }), true);
});

test('updateQualityGateTracker resets stable count on unstable frame', () => {
  const tracker = createQualityGateTracker();
  updateQualityGateTracker(makePoseData('HIGH', 0.8), tracker);
  updateQualityGateTracker(makePoseData('HIGH', 0.8), tracker);
  const metrics = updateQualityGateTracker(makePoseData('LOW', 0.4), tracker);
  assert.equal(metrics.stableFrameCount, 0);
  assert.equal(tracker.stableFrameCount, 0);
});

test('buildGateInputsFromPoseData returns normalized gate fields', () => {
  const result = buildGateInputsFromPoseData(makePoseData('HIGH', 0.7, 'SIDE'), {
    stableFrameCount: 5,
    unstableFrameRatio: 0.1,
  });

  assert.equal(result.estimatedView, 'SIDE');
  assert.equal(result.frameInclusionRatio, 0.95);
  assert.equal(result.stableFrameCount, 5);
});
```

- [ ] **Step 2: 테스트가 실제로 실패하는지 확인한다**

Run: `node --test test/workout/quality-gate-session.test.js`

Expected: `FAIL` because `public/js/workout/quality-gate-session.js` does not exist yet.

- [ ] **Step 3: `quality-gate-session.js`를 생성하고 helper를 이동한다**

```js
function mapWithholdReasonToMessage(reason) {
  const messages = {
    out_of_frame: '머리부터 발끝까지 프레임 안에 들어오도록 위치를 조정해주세요.',
    joints_missing: '어깨부터 손목, 골반과 하체까지 전신이 보이도록 카메라를 맞춰주세요.',
    tracked_joints_low: '팔과 하체가 모두 보이도록 카메라를 조금 더 멀리 두세요.',
    view_unstable: '몸 방향이 흔들리고 있습니다. 측면 자세를 유지해주세요.',
    view_mismatch: '현재 운동은 옆면 시점이 필요합니다.',
    low_confidence: '카메라 위치와 조명을 조정한 뒤 다시 자세를 잡아주세요.',
  };
  return messages[reason] || '카메라와 자세를 다시 맞춰 주세요.';
}

function shouldResumeScoring({ stableFrameCount, threshold }) {
  return stableFrameCount >= threshold;
}

function isFrameStable(poseData) {
  const quality = poseData?.angles?.quality;
  if (!quality) return false;
  return quality.level !== 'LOW' && quality.viewStability >= 0.5;
}

function shouldMirrorSourcePreview(sourceType) {
  return sourceType === 'mobile_front';
}

function createQualityGateTracker() {
  return {
    stableFrameCount: 0,
    recentStabilityWindow: [],
    isWithholding: false,
    withholdReason: null,
  };
}

function updateQualityGateTracker(poseData, tracker) {
  const stable = isFrameStable(poseData);
  tracker.recentStabilityWindow.push(stable);
  if (tracker.recentStabilityWindow.length > 12) {
    tracker.recentStabilityWindow.shift();
  }
  tracker.stableFrameCount = stable ? tracker.stableFrameCount + 1 : 0;

  const unstableCount = tracker.recentStabilityWindow.filter((value) => !value).length;
  return {
    stableFrameCount: tracker.stableFrameCount,
    unstableFrameRatio: tracker.recentStabilityWindow.length
      ? unstableCount / tracker.recentStabilityWindow.length
      : 0,
  };
}

function buildGateInputsFromPoseData(poseData, stabilityMetrics) {
  const quality = poseData?.angles?.quality || {};
  const rawInputs = {
    frameInclusionRatio: quality.inFrameRatio ?? 1.0,
    keyJointVisibilityAverage: quality.avgVisibility ?? 0,
    minKeyJointVisibility: quality.minVisibility ?? 0,
    estimatedView: poseData?.angles?.view || 'UNKNOWN',
    estimatedViewConfidence: quality.viewStability ?? 0,
    detectionConfidence: quality.avgVisibility ?? 0,
    trackingConfidence: quality.avgVisibility ?? 0,
    stableFrameCount: stabilityMetrics.stableFrameCount,
    unstableFrameRatio: stabilityMetrics.unstableFrameRatio,
    cameraDistanceOk: true,
  };

  if (typeof buildQualityGateInputs === 'function') {
    return buildQualityGateInputs(rawInputs);
  }
  return rawInputs;
}

function shouldSuppressScoring(gateResult, tracker, threshold) {
  if (gateResult.result === 'withhold') {
    tracker.isWithholding = true;
    tracker.withholdReason = gateResult.reason;
    return { suppress: true, reason: gateResult.reason };
  }

  if (tracker.isWithholding && !shouldResumeScoring({
    stableFrameCount: tracker.stableFrameCount,
    threshold,
  })) {
    return {
      suppress: true,
      reason: tracker.withholdReason || 'insufficient_stable_frames',
    };
  }

  tracker.isWithholding = false;
  tracker.withholdReason = null;
  return { suppress: false, reason: null };
}

const SessionQualityGate = {
  mapWithholdReasonToMessage,
  shouldResumeScoring,
  isFrameStable,
  shouldMirrorSourcePreview,
  createQualityGateTracker,
  updateQualityGateTracker,
  buildGateInputsFromPoseData,
  shouldSuppressScoring,
};

if (typeof window !== 'undefined') {
  window.SessionQualityGate = SessionQualityGate;
}

if (typeof module !== 'undefined') {
  module.exports = SessionQualityGate;
}
```

- [ ] **Step 4: controller와 기존 테스트를 새 모듈 기준으로 바꾼다**

```js
// session-controller.js 상단 helper 사용부
const qualityGateHelpers = window.SessionQualityGate || {};
const {
  mapWithholdReasonToMessage,
  shouldMirrorSourcePreview,
  createQualityGateTracker,
  updateQualityGateTracker,
  buildGateInputsFromPoseData,
  shouldSuppressScoring,
} = qualityGateHelpers;

let qualityGateTracker = createQualityGateTracker
  ? createQualityGateTracker()
  : {
      stableFrameCount: 0,
      recentStabilityWindow: [],
      isWithholding: false,
      withholdReason: null,
    };
```

```js
// test/workout/session-controller-gate-ui.test.js
const {
  mapWithholdReasonToMessage,
  shouldResumeScoring,
  createQualityGateTracker,
  updateQualityGateTracker,
  buildGateInputsFromPoseData,
  shouldSuppressScoring,
  isFrameStable,
  shouldMirrorSourcePreview,
} = require('../../public/js/workout/quality-gate-session.js');
```

- [ ] **Step 5: helper 테스트를 다시 실행한다**

Run: `node --test test/workout/quality-gate-session.test.js test/workout/session-controller-gate-ui.test.js`

Expected: `PASS` with all quality-gate helper tests green.

- [ ] **Step 6: Task 1 커밋을 만든다**

```bash
git add public/js/workout/quality-gate-session.js public/js/workout/session-controller.js test/workout/quality-gate-session.test.js test/workout/session-controller-gate-ui.test.js
git commit -m "refactor: extract session quality gate helpers"
```

---

### Task 2: DOM 렌더링을 `session-ui.js`로 분리

**Files:**
- Create: `public/js/workout/session-ui.js`
- Modify: `public/js/workout/session-controller.js`
- Modify: `views/workout/session.ejs`
- Create: `test/workout/session-ui.test.js`

- [ ] **Step 1: UI 팩토리 테스트를 먼저 작성한다**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionUi } = require('../../public/js/workout/session-ui.js');

function createElementStub() {
  return {
    textContent: '',
    hidden: false,
    className: '',
    style: {},
    value: '',
    disabled: false,
    innerHTML: '',
    dataset: {},
    children: [],
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = nodes;
    },
    querySelectorAll() {
      return [];
    },
    setAttribute(name, value) {
      this[name] = value;
    },
    removeAttribute(name) {
      delete this[name];
    },
  };
}

test('createSessionUi updates status badge text and class', () => {
  const refs = {
    statusBadge: createElementStub(),
    liveScoreEl: createElementStub(),
    scoreBreakdownEl: createElementStub(),
    alertContainer: createElementStub(),
    alertTitle: createElementStub(),
    alertMessage: createElementStub(),
    repCountEl: createElementStub(),
    repCountLabelEl: createElementStub(),
    plankTargetHint: createElementStub(),
    plankTargetReadoutEl: createElementStub(),
    timerLabelEl: createElementStub(),
    scoreModeLabelEl: createElementStub(),
    startBtn: createElementStub(),
  };

  const ui = createSessionUi({
    refs,
    createElement: () => createElementStub(),
    formatClock: (value) => `00:${String(value).padStart(2, '0')}`,
  });

  ui.updateStatus('running', '운동 중');

  assert.equal(refs.statusBadge.className, 'status running');
  assert.equal(refs.statusBadge.textContent, '운동 중');
});

test('syncPlankTargetUi reflects target time in hint and readout', () => {
  const refs = {
    statusBadge: createElementStub(),
    liveScoreEl: createElementStub(),
    scoreBreakdownEl: createElementStub(),
    alertContainer: createElementStub(),
    alertTitle: createElementStub(),
    alertMessage: createElementStub(),
    repCountEl: createElementStub(),
    repCountLabelEl: createElementStub(),
    plankTargetHint: createElementStub(),
    plankTargetReadoutEl: createElementStub(),
    timerLabelEl: createElementStub(),
    scoreModeLabelEl: createElementStub(),
    startBtn: createElementStub(),
    plankTargetSelectRoot: createElementStub(),
    plankTargetInput: createElementStub(),
  };

  refs.plankTargetSelectRoot.querySelectorAll = () => [];

  const ui = createSessionUi({
    refs,
    createElement: () => createElementStub(),
    formatClock: (value) => `00:${String(value).padStart(2, '0')}`,
  });

  ui.syncPlankTargetUi({
    isPlank: true,
    isRoutinePlank: false,
    showFreeTargetUi: true,
    targetSec: 30,
    canStart: true,
    phase: 'PREPARING',
  });

  assert.equal(refs.plankTargetReadoutEl.textContent, '30초');
  assert.equal(refs.scoreModeLabelEl.textContent, '현재 자세 점수');
  assert.equal(refs.timerLabelEl.textContent, '플랭크 시간');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/workout/session-ui.test.js`

Expected: `FAIL` because `public/js/workout/session-ui.js` does not exist yet.

- [ ] **Step 3: `session-ui.js` 팩토리를 생성한다**

```js
function createSessionUi({ refs, createElement = document.createElement.bind(document), formatClock }) {
  function updateStatus(className, text) {
    if (!refs.statusBadge) return;
    refs.statusBadge.className = `status ${className}`;
    refs.statusBadge.textContent = text;
  }

  function showAlert(title, message) {
    if (!refs.alertContainer || !refs.alertTitle || !refs.alertMessage) return;
    refs.alertTitle.textContent = title;
    refs.alertMessage.textContent = message;
    refs.alertContainer.hidden = false;
  }

  function showToast(message) {
    const toast = createElement('div');
    toast.className = 'toast workout-session-toast';
    toast.textContent = message;
    if (typeof document !== 'undefined' && document.body) {
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2000);
    }
    return toast;
  }

  function updatePrimaryCounterDisplay({ isTimeBased, isRoutineTimeTarget, currentSegmentSec, currentSetWorkSec, currentRep }) {
    if (refs.repCountLabelEl) {
      refs.repCountLabelEl.textContent =
        isTimeBased || isRoutineTimeTarget ? '시간(초)' : '횟수';
    }
    const value = isTimeBased
      ? Math.max(0, Math.round(currentSegmentSec))
      : isRoutineTimeTarget
        ? Math.max(0, Math.round(currentSetWorkSec))
        : Math.max(0, Math.round(currentRep));
    if (refs.repCountEl) {
      refs.repCountEl.textContent = String(value);
    }
  }

  function updateRoutineStepDisplay({ stepIndex, totalSteps, progressPercent, currentExerciseName, targetSummary }) {
    if (refs.routineStepEl) {
      refs.routineStepEl.textContent = `현재 ${stepIndex + 1} / ${totalSteps} 운동`;
    }
    if (refs.routineProgressEl) {
      refs.routineProgressEl.style.width = `${progressPercent}%`;
    }
    if (refs.routineCurrentExerciseEl) {
      refs.routineCurrentExerciseEl.textContent = currentExerciseName;
    }
    if (refs.routineTargetSummaryEl) {
      refs.routineTargetSummaryEl.textContent = targetSummary;
    }
  }

  function updateScoreDisplay({ score, breakdown = [], gated = false, message = null }) {
    if (refs.liveScoreEl) {
      refs.liveScoreEl.textContent = score > 0 ? String(score) : '--';
    }

    if (!refs.scoreBreakdownEl) return;

    if (gated && message) {
      refs.scoreBreakdownEl.innerHTML = `<div class="score-item"><span class="muted">${message}</span></div>`;
      return;
    }

    if (!breakdown.length) {
      refs.scoreBreakdownEl.innerHTML = '<div class="score-item"><span class="muted">포즈 감지 중...</span></div>';
      return;
    }

    refs.scoreBreakdownEl.innerHTML = breakdown
      .slice(0, 3)
      .map((item) => `
        <div class="score-item">
          <span>${item.title || item.key}</span>
          <span>${Math.round(item.score ?? item.normalizedScore ?? 0)}</span>
        </div>
      `)
      .join('');
  }

  function syncPlankTargetUi({ isPlank, isRoutinePlank, showFreeTargetUi, targetSec, canStart, phase }) {
    if (refs.plankTargetSelectRoot) {
      refs.plankTargetSelectRoot.hidden = !showFreeTargetUi;
      refs.plankTargetSelectRoot.querySelectorAll('[data-plank-target-sec]').forEach((button) => {
        const buttonSec = Number(button.getAttribute('data-plank-target-sec'));
        button.classList.toggle('active', buttonSec === targetSec);
        button.disabled = isRoutinePlank;
      });
    }

    if (refs.plankTargetInput) {
      if (targetSec > 0) refs.plankTargetInput.value = String(targetSec);
      refs.plankTargetInput.disabled = isRoutinePlank;
    }

    if (refs.plankTargetHint) {
      refs.plankTargetHint.textContent = isRoutinePlank
        ? `루틴 목표 시간 ${targetSec}초가 자동으로 적용됩니다.`
        : '플랭크는 목표 시간을 먼저 정한 뒤 시작합니다. 목표 시간은 세션 종료 시 점수 정규화 기준이 됩니다.';
    }

    if (refs.plankTargetReadoutEl) {
      refs.plankTargetReadoutEl.textContent = targetSec > 0 ? `${targetSec}초` : '--';
    }

    if (refs.scoreModeLabelEl) refs.scoreModeLabelEl.textContent = isPlank ? '현재 자세 점수' : '이번 rep 점수';
    if (refs.timerLabelEl) refs.timerLabelEl.textContent = isPlank ? '플랭크 시간' : '운동 시간';
    if (refs.startBtn && phase === 'PREPARING') {
      refs.startBtn.textContent = isPlank ? '플랭크 시작' : '운동 시작';
      refs.startBtn.disabled = !canStart;
    }
  }

  return {
    updateStatus,
    showAlert,
    showToast,
    updatePrimaryCounterDisplay,
    updateRoutineStepDisplay,
    updateScoreDisplay,
    syncPlankTargetUi,
  };
}

if (typeof window !== 'undefined') {
  window.createSessionUi = createSessionUi;
}

if (typeof module !== 'undefined') {
  module.exports = { createSessionUi };
}
```

- [ ] **Step 4: view와 controller를 새 UI 팩토리를 사용하도록 바꾼다**

```ejs
<script src="/js/workout/session-buffer.js"></script>
<script src="/js/workout/session-camera.js"></script>
<script src="/js/workout/quality-gate-session.js"></script>
<script src="/js/workout/session-ui.js"></script>
<script src="/js/workout/session-controller.js"></script>
```

```js
// session-controller.js
const ui = window.createSessionUi({
  refs: {
    statusBadge,
    liveScoreEl,
    scoreBreakdownEl,
    alertContainer,
    alertTitle,
    alertMessage,
    repCountEl,
    repCountLabelEl,
    plankTargetSelectRoot,
    plankTargetInput,
    plankTargetHint,
    plankTargetReadoutEl,
    timerLabelEl,
    scoreModeLabelEl,
    startBtn,
  },
  formatClock,
});

ui.updateStatus('preparing', '준비 중');
```

- [ ] **Step 5: UI 테스트와 문법 검사를 실행한다**

Run: `node --test test/workout/session-ui.test.js && node --check public/js/workout/session-ui.js && node --check public/js/workout/session-controller.js`

Expected: 모든 명령이 `PASS` 또는 종료 코드 `0`으로 끝난다.

- [ ] **Step 6: Task 2 커밋을 만든다**

```bash
git add public/js/workout/session-ui.js public/js/workout/session-controller.js views/workout/session.ejs test/workout/session-ui.test.js
git commit -m "refactor: extract session ui renderer"
```

---

### Task 3: 루틴 진행 정책을 `routine-session-manager.js`로 분리

**Files:**
- Create: `public/js/workout/routine-session-manager.js`
- Modify: `public/js/workout/session-controller.js`
- Modify: `views/workout/session.ejs`
- Create: `test/workout/routine-session-manager.test.js`

- [ ] **Step 1: 루틴 액션 해석 테스트를 먼저 작성한다**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveRoutineAdvanceAction,
} = require('../../public/js/workout/routine-session-manager.js');

test('resolveRoutineAdvanceAction returns NEXT_SET when server asks for next set', () => {
  const result = resolveRoutineAdvanceAction({
    action: 'NEXT_SET',
    restSec: 30,
    nextSessionId: 42,
  });

  assert.deepEqual(result, {
    action: 'NEXT_SET',
    restSec: 30,
    nextSessionId: 42,
  });
});

test('resolveRoutineAdvanceAction falls back to ROUTINE_COMPLETE for final step', () => {
  const result = resolveRoutineAdvanceAction({
    action: '',
    currentSet: 3,
    totalSets: 3,
    hasNextExerciseStep: false,
    fallbackRestSec: 0,
  });

  assert.equal(result.action, 'ROUTINE_COMPLETE');
  assert.equal(result.restSec, 0);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test test/workout/routine-session-manager.test.js`

Expected: `FAIL` because `public/js/workout/routine-session-manager.js` does not exist yet.

- [ ] **Step 3: 루틴 매니저 모듈을 생성한다**

```js
function resolveRoutineAdvanceAction({
  action,
  restSec = 0,
  nextSessionId = null,
  currentSet = 1,
  totalSets = 1,
  hasNextExerciseStep = false,
  fallbackRestSec = 0,
}) {
  const normalizedAction = String(action || '').toUpperCase();

  if (normalizedAction === 'NEXT_SET') {
    return { action: 'NEXT_SET', restSec, nextSessionId };
  }
  if (normalizedAction === 'NEXT_STEP') {
    return { action: 'NEXT_STEP', restSec, nextSessionId };
  }
  if (normalizedAction === 'ROUTINE_COMPLETE') {
    return { action: 'ROUTINE_COMPLETE', restSec, nextSessionId };
  }

  if (currentSet < totalSets) {
    return { action: 'NEXT_SET', restSec: fallbackRestSec, nextSessionId };
  }
  if (hasNextExerciseStep) {
    return { action: 'NEXT_STEP', restSec: fallbackRestSec, nextSessionId };
  }
  return { action: 'ROUTINE_COMPLETE', restSec: fallbackRestSec, nextSessionId };
}

function createRoutineSessionManager(deps) {
  const {
    state,
    workoutData,
    sessionBuffer,
    repCounter,
    resetSessionBufferForSession,
    bindEnginesToCurrentExercise,
    syncPlankTargetUi,
    refreshRoutineCounterUi,
    updatePrimaryCounterDisplay,
    updateRoutineStepDisplay,
    showAlert,
    startRest,
    finishWorkout,
  } = deps;

  async function recordRoutineSetCompletion(payload) {
    const response = await fetch(`/api/workout/session/${state.sessionId}/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.success) {
      throw new Error(data?.error || data?.message || '루틴 세트 저장에 실패했습니다.');
    }
    return data.routine || null;
  }

  async function checkRoutineProgress({ actualValue, targetValue, currentSet, totalSets, hasNextExerciseStep, payload }) {
    if (actualValue < targetValue) {
      return { action: 'NONE', restSec: 0, nextSessionId: null };
    }

    const routineState = await recordRoutineSetCompletion(payload);
    const action = resolveRoutineAdvanceAction({
      action: routineState?.action,
      restSec: Math.max(0, Number(routineState?.rest_sec) || 0),
      nextSessionId: Number(routineState?.next_session?.session_id) || null,
      currentSet,
      totalSets,
      hasNextExerciseStep,
      fallbackRestSec: Math.max(0, Number(payload?.rest_sec) || 0),
    });

    if (action.action === 'NEXT_SET' && action.restSec > 0) {
      startRest(action.restSec, 'NEXT_SET');
    }

    if (action.action === 'NEXT_STEP' && action.restSec > 0) {
      startRest(action.restSec, 'NEXT_EXERCISE');
    }

    if (action.action === 'ROUTINE_COMPLETE' && action.restSec === 0) {
      finishWorkout();
    }

    return action;
  }

  return {
    resolveRoutineAdvanceAction,
    recordRoutineSetCompletion,
    checkRoutineProgress,
  };
}

if (typeof window !== 'undefined') {
  window.createRoutineSessionManager = createRoutineSessionManager;
}

if (typeof module !== 'undefined') {
  module.exports = {
    createRoutineSessionManager,
    resolveRoutineAdvanceAction,
  };
}
```

- [ ] **Step 4: view와 controller를 새 루틴 매니저 기준으로 바꾼다**

```ejs
<script src="/js/workout/quality-gate-session.js"></script>
<script src="/js/workout/session-ui.js"></script>
<script src="/js/workout/routine-session-manager.js"></script>
<script src="/js/workout/session-controller.js"></script>
```

```js
// session-controller.js
const routineManager = window.createRoutineSessionManager({
  state,
  workoutData,
  sessionBuffer,
  repCounter,
  resetSessionBufferForSession,
  bindEnginesToCurrentExercise,
  syncPlankTargetUi: (...args) => ui.syncPlankTargetUi(...args),
  refreshRoutineCounterUi,
  updatePrimaryCounterDisplay: (...args) => ui.updatePrimaryCounterDisplay(...args),
  updateRoutineStepDisplay: (...args) => ui.updateRoutineStepDisplay?.(...args),
  showAlert: (...args) => ui.showAlert(...args),
  startRest,
  finishWorkout,
});
```

- [ ] **Step 5: 루틴 매니저 테스트와 문법 검사를 실행한다**

Run: `node --test test/workout/routine-session-manager.test.js && node --check public/js/workout/routine-session-manager.js && node --check public/js/workout/session-controller.js`

Expected: 모든 명령이 `PASS` 또는 종료 코드 `0`으로 끝난다.

- [ ] **Step 6: Task 3 커밋을 만든다**

```bash
git add public/js/workout/routine-session-manager.js public/js/workout/session-controller.js views/workout/session.ejs test/workout/routine-session-manager.test.js
git commit -m "refactor: extract routine session manager"
```

---

### Task 4: controller를 orchestration 중심으로 정리하고 전체 회귀 검증

**Files:**
- Modify: `public/js/workout/session-controller.js`
- Modify: `views/workout/session.ejs`
- Modify: `test/workout/session-controller-gate-ui.test.js`
- Modify: `test/workout/quality-gate-session.test.js`
- Modify: `test/workout/session-ui.test.js`
- Modify: `test/workout/routine-session-manager.test.js`

- [ ] **Step 1: controller 내부 helper 정의를 제거하고 orchestration 순서만 남긴다**

```js
async function initSession(workoutData) {
  let poseEngine = null;
  let scoringEngine = null;
  let repCounter = null;
  let sessionBuffer = null;
  let exerciseModule = null;

  const state = {
    phase: 'PREPARING',
    sessionId: null,
    selectedView: null,
    currentSet: 1,
    currentRep: 0,
    currentStepIndex: 0,
    totalTime: 0,
    restTimeLeft: 0,
    liveScore: 0,
    isPaused: false,
    timerInterval: null,
    restInterval: null,
    alertCooldown: false,
    frameLoop: null,
    lastViewInfoAt: 0,
    lastViewInfoText: '',
    repInProgressPrev: false,
    repMetricBuffer: {},
    lastRepMetricSummary: [],
    currentSetWorkSec: 0,
    restAfterAction: null,
    currentTargetSec: 0,
    currentSegmentSec: 0,
    bestHoldSec: 0,
    plankGoalReached: false,
    routineSetSyncPending: false,
    pauseRepScoring: false,
    currentWithholdReason: null,
  };

  const qualityGate = window.SessionQualityGate;
  const ui = window.createSessionUi({ refs: {/* DOM refs */}, formatClock });
  const routineManager = window.createRoutineSessionManager({ /* deps */ });

  function handlePoseDetected(poseData) {
    const stabilityMetrics = qualityGate.updateQualityGateTracker(poseData, qualityGateTracker);
    const gateInputs = qualityGate.buildGateInputsFromPoseData(poseData, stabilityMetrics);
    const gateResult = evaluateQualityGate(gateInputs, {
      allowedViews: getAllowedViews(),
      selectedView: state.selectedView,
    });
    const suppression = qualityGate.shouldSuppressScoring(gateResult, qualityGateTracker, gateThreshold);

    if (suppression.suppress) {
      ui.updateScoreDisplay({
        score: 0,
        breakdown: [],
        gated: true,
        message: qualityGate.mapWithholdReasonToMessage(suppression.reason),
      });
      ui.showAlert('자세 인식 대기', qualityGate.mapWithholdReasonToMessage(suppression.reason));
      return;
    }

    const rawScoreResult = scoringEngine.calculate(poseData.angles);
    const timeOrRepResult = repCounter.update(poseData.angles, rawScoreResult.score);
    ui.updateScoreDisplay(rawScoreResult);
  }
}
```

- [ ] **Step 2: 최종 검증 명령을 실행한다**

Run:

```bash
node --test test/workout/quality-gate-session.test.js test/workout/session-controller-gate-ui.test.js test/workout/session-ui.test.js test/workout/routine-session-manager.test.js
node --check public/js/workout/quality-gate-session.js
node --check public/js/workout/session-ui.js
node --check public/js/workout/routine-session-manager.js
node --check public/js/workout/session-controller.js
```

Expected:

- 모든 `node --test`가 `PASS`
- 모든 `node --check`가 종료 코드 `0`

- [ ] **Step 3: 브라우저 수동 회귀 테스트를 수행한다**

Run:

```bash
npm test
```

Expected:

- 프로젝트 기본 테스트가 깨지지 않는다.
- 이후 브라우저에서 직접 아래 흐름을 확인한다.
  - free workout 시작 → 점수/알림/종료 정상
  - routine workout 시작 → 세트 저장/휴식/다음 운동 전환 정상
  - plank workout 시작 → 목표 시간 UI, 진행률, 종료 저장 정상

- [ ] **Step 4: 최종 커밋을 만든다**

```bash
git add public/js/workout/quality-gate-session.js public/js/workout/session-ui.js public/js/workout/routine-session-manager.js public/js/workout/session-controller.js views/workout/session.ejs test/workout/quality-gate-session.test.js test/workout/session-controller-gate-ui.test.js test/workout/session-ui.test.js test/workout/routine-session-manager.test.js
git commit -m "refactor: split session controller responsibilities"
```

---

## Spec Coverage Check

- `quality-gate-session.js` 분리
  - Task 1에서 구현
- `session-ui.js` 분리
  - Task 2에서 구현
- `routine-session-manager.js` 분리
  - Task 3에서 구현
- `session-controller.js`를 orchestration 중심으로 축소
  - Task 4에서 구현
- 기존 진입점 및 런타임 동작 유지
  - Task 4 검증 단계에서 확인

---

## Placeholder Scan

이 계획서는 다음 항목을 포함하지 않는다.

- TODO
- TBD
- "나중에 구현"
- "적절히 처리"
- "유사하게 반복"

모든 task는 실제 파일 경로, 테스트 파일, 명령, 커밋 메시지를 포함한다.

---

## Type / Interface Consistency Check

- 품질 게이트 모듈 전역 이름: `window.SessionQualityGate`
- UI 팩토리 전역 이름: `window.createSessionUi`
- 루틴 매니저 팩토리 전역 이름: `window.createRoutineSessionManager`
- controller 공개 진입점: `initSession(workoutData)`

이 이름들은 plan 전체에서 동일하게 유지한다.
