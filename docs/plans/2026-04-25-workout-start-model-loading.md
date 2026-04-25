# 운동 시작 직후 모델 로딩 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운동 세션 페이지에서 카메라 연결 직후가 아니라 사용자가 `운동 시작` 버튼을 누른 직후 AI 모델 로딩을 시작하고, 모델 로딩 중에는 카메라 오버레이에 스피너와 안내 문구를 표시한다.

**Architecture:** 기존 `public/js/workout/session-controller.js`의 단일 오케스트레이션 구조를 유지한다. `connectCameraSource()`는 카메라 프리뷰 연결만 담당하게 하고, `startWorkout()`이 `showModelLoadingOverlay()` -> `prepareAI()` -> 서버 세션 생성 -> 셋업 패널 접기 -> `runStartCountdown()` -> 운동 시작 순서로 흐름을 제어한다. 스타일은 `public/workout.css`에 기존 `.camera-overlay`와 `.start-countdown-*` 패턴에 맞춰 추가한다.

**Tech Stack:** Vanilla browser JavaScript, EJS inline `startWorkout()` binding, CSS, Node `--test`

---

## File Map

### 수정할 파일

- `public/js/workout/session-controller.js`
  - `connectCameraSource()`에서 모델 로딩 시작을 제거한다.
  - `prepareAI()`를 시작 버튼 클릭 시점에 기다릴 수 있도록 성공/실패 결과를 명확히 반환하게 만든다.
  - `startWorkout()` 초반에 모델 로딩 오버레이를 띄우고, 로딩 성공 후에 기존 카운트다운과 운동 시작 흐름을 이어간다.
  - 시작 실패 시 셋업 패널, 시작 버튼, 오버레이 상태를 복구한다.

- `public/workout.css`
  - 모델 로딩 오버레이용 스피너와 텍스트 스타일을 추가한다.
  - 기존 `connectCameraSource()`의 inline spinner 스타일을 CSS 클래스로 대체할 수 있게 한다.

### 테스트 파일

- `test/workout/session-controller-start-flow.test.js`
  - 소스 기반 회귀 테스트로 시작 흐름 순서를 검증한다.
  - 카메라 연결만으로는 `prepareAI()`가 호출되지 않고, `startWorkout()`에서 모델 로딩 UI와 `prepareAI()`가 실행되는지 확인한다.

### 유지할 파일

- `views/workout/session.ejs`
  - `startBtn`의 `onclick="startWorkout()"` 연결은 유지한다.

- `public/js/workout/pose-engine.js`
  - `PoseEngine.initialize()`와 MediaPipe 옵션은 변경하지 않는다.

---

### Task 1: 시작 흐름 회귀 테스트 추가

**Files:**
- Create: `test/workout/session-controller-start-flow.test.js`

- [x] **Step 1: 실패하는 테스트 파일을 작성한다**

`test/workout/session-controller-start-flow.test.js`를 새로 만들고 아래 테스트를 추가한다. 첫 번째 테스트는 현재 코드에서 실패해야 한다. 현재 `connectCameraSource()`가 카메라 연결 직후 `prepareAI()`를 호출하기 때문이다.

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerSource = fs.readFileSync(
  path.resolve(__dirname, '../../public/js/workout/session-controller.js'),
  'utf8',
);

function extractFunctionBody(source, functionName) {
  const signature = `function ${functionName}`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${functionName} should exist`);

  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }

  throw new Error(`${functionName} body was not closed`);
}

test('connectCameraSource only connects media and does not warm up the AI model', () => {
  const body = extractFunctionBody(controllerSource, 'connectCameraSource');

  assert.doesNotMatch(body, /prepareAI\s*\(/);
  assert.doesNotMatch(body, /warmUpGeneration\s*\+\+/);
  assert.match(body, /sessionCamera\.getStream\s*\(/);
  assert.match(body, /sessionCamera\.applyStream\s*\(/);
});

test('startWorkout shows model loading before countdown and starts AI from the click path', () => {
  const body = extractFunctionBody(controllerSource, 'startWorkout');

  const loadingIndex = body.indexOf('showModelLoadingOverlay');
  const prepareIndex = body.indexOf('prepareAI');
  const countdownIndex = body.indexOf('runStartCountdown');

  assert.ok(loadingIndex >= 0, 'startWorkout should show model loading overlay');
  assert.ok(prepareIndex > loadingIndex, 'prepareAI should run after loading UI appears');
  assert.ok(countdownIndex > prepareIndex, 'countdown should run after model preparation');
  assert.doesNotMatch(body, /AI 모델이 아직 준비 중입니다/);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run:

```bash
node --test test/workout/session-controller-start-flow.test.js
```

Expected:

```text
not ok 1 - connectCameraSource only connects media and does not warm up the AI model
```

첫 번째 실패 이유는 `connectCameraSource()` body 안에 `warmUpGeneration++` 또는 `prepareAI(warmUpGeneration)`가 남아 있기 때문이다.

---

### Task 2: 로딩 오버레이 CSS 추가

**Files:**
- Modify: `public/workout.css`

- [x] **Step 1: 모델 로딩 오버레이 스타일을 추가한다**

`public/workout.css`의 `.camera-overlay .muted` 블록 뒤에 아래 CSS를 추가한다.

```css
.camera-loading-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
}

.camera-loading-spinner {
  width: 36px;
  height: 36px;
  border: 4px solid rgba(255, 255, 255, 0.22);
  border-top-color: #fff;
  border-radius: 50%;
  animation: cameraLoadingSpin 0.9s linear infinite;
}

.camera-loading-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--workout-text);
}

.camera-loading-subtitle {
  margin: 0;
  font-size: 14px;
  color: var(--workout-muted);
}

@keyframes cameraLoadingSpin {
  to {
    transform: rotate(360deg);
  }
}
```

- [x] **Step 2: CSS 문법을 확인한다**

Run:

```bash
node --check public/js/workout/session-controller.js
```

Expected:

```text
```

`node --check`는 CSS를 검사하지 않지만, 이 단계에서는 아직 JS 변경 전이라 기존 JS 구문이 깨져 있지 않은 기준선을 확인한다.

---

### Task 3: 카메라 연결 흐름에서 모델 로딩 제거

**Files:**
- Modify: `public/js/workout/session-controller.js:683-741`

- [x] **Step 1: `connectCameraSource()`의 로딩 문구를 카메라 연결 전용으로 바꾼다**

현재 inline spinner HTML을 새 CSS 클래스를 쓰는 형태로 바꾼다.

```js
cameraOverlay.innerHTML = `
  <div class="camera-loading-overlay" aria-live="polite">
    <div class="camera-loading-spinner" aria-hidden="true"></div>
    <p class="camera-loading-title">카메라를 연결 중...</p>
    <p class="camera-loading-subtitle">브라우저 권한과 입력 소스를 확인하고 있습니다.</p>
  </div>
`;
cameraOverlay.hidden = false;
startBtn.disabled = true;
startBtn.textContent = "카메라 연결 중...";
aiReady = false;
```

- [x] **Step 2: 카메라 연결 성공 후 `prepareAI()` 호출을 제거한다**

`connectCameraSource()`의 성공 경로에서 아래 코드를 삭제한다.

```js
warmUpGeneration++;
prepareAI(warmUpGeneration);
```

대신 카메라 연결 완료 후 시작 버튼을 활성화한다.

```js
cameraOverlay.hidden = false;
cameraOverlay.innerHTML = cameraReadyHtml;
startBtn.disabled = !canStartCurrentExercise();
startBtn.textContent = originalStartBtnText;
```

이 단계에서는 `canStartCurrentExercise()`가 `aiReady`를 보고 있으므로 다음 Task에서 함께 조정해야 최종 테스트가 통과한다.

- [x] **Step 3: `canStartCurrentExercise()`에서 `aiReady` 의존성을 제거한다**

`public/js/workout/session-controller.js:287-292`의 helper를 아래처럼 바꾼다. 시작 가능 여부는 모델 준비가 아니라 사용자 입력 조건만 판단한다.

```js
const canStartCurrentExercise = () => {
  if (!isPlankExerciseCode()) return true;
  if (workoutData.mode === "ROUTINE") return getCurrentTargetSec() > 0;
  return getCurrentTargetSec() >= 10;
};
```

- [ ] **Step 4: Task 1 테스트를 다시 실행해 첫 번째 테스트가 통과하는지 확인한다**

Run:

```bash
node --test test/workout/session-controller-start-flow.test.js
```

Expected:

```text
not ok 2 - startWorkout shows model loading before countdown and starts AI from the click path
```

첫 번째 테스트는 통과하고 두 번째 테스트는 아직 `showModelLoadingOverlay`가 없어서 실패해야 한다.

---

### Task 4: 시작 버튼 클릭 직후 모델 로딩 실행

**Files:**
- Modify: `public/js/workout/session-controller.js:743-768`
- Modify: `public/js/workout/session-controller.js:898-1037`

- [x] **Step 1: 모델 로딩 오버레이 helper를 추가한다**

`runStartCountdown()` 바로 앞에 아래 helper를 추가한다.

```js
function showModelLoadingOverlay() {
  state.phase = "PREPARING";
  ui.updateStatus("preparing", "모델 로딩 중");
  cameraOverlay.hidden = false;
  cameraOverlay.innerHTML = `
    <div class="camera-loading-overlay" aria-live="polite">
      <div class="camera-loading-spinner" aria-hidden="true"></div>
      <p class="camera-loading-title">모델 로딩 중...</p>
      <p class="camera-loading-subtitle">잠시 후 카운트다운이 시작됩니다.</p>
    </div>
  `;
}
```

- [x] **Step 2: `prepareAI()`가 boolean 결과를 반환하게 한다**

`prepareAI(generation)`의 실패/성공 반환을 아래 규칙으로 정리한다.

```js
async function prepareAI(generation) {
  if (!aiEnginesInitialized) {
    if (!aiInitPromise) {
      aiInitPromise = initAIEngines();
    }
    const ok = await aiInitPromise;
    aiInitPromise = null;
    if (generation !== warmUpGeneration) return false;
    if (!ok) {
      cameraOverlay.hidden = false;
      cameraOverlay.innerHTML =
        '<p>AI 엔진 로딩 실패</p><p class="muted">페이지를 새로고침해주세요</p>';
      startBtn.textContent = originalStartBtnText;
      return false;
    }
    aiEnginesInitialized = true;
  }

  if (generation !== warmUpGeneration) return false;

  aiReady = true;
  startBtn.disabled = !canStartCurrentExercise();
  startBtn.textContent = originalStartBtnText;
  return true;
}
```

`prepareAI()`는 더 이상 성공 시 `cameraReadyHtml`을 강제로 다시 보여주지 않는다. 시작 클릭 경로에서는 다음 화면이 카운트다운이어야 하기 때문이다.

- [x] **Step 3: `startWorkout()` 초반의 `aiReady` alert guard를 제거한다**

아래 블록을 삭제한다.

```js
if (!aiReady) {
  alert("AI 모델이 아직 준비 중입니다. 잠시 후 다시 시도해주세요.");
  cameraOverlay.hidden = prevOverlayHidden;
  cameraOverlay.innerHTML = prevOverlayHtml || cameraReadyHtml;
  startBtn.hidden = prevStartHidden;
  startBtn.disabled = prevStartDisabled;
  return;
}
```

- [x] **Step 4: `startWorkout()`에서 모델 로딩을 서버 세션 생성 전에 기다린다**

`canStartCurrentExercise()` 검사 직후, `fetch("/api/workout/session")` 전에 아래 흐름을 넣는다.

```js
showModelLoadingOverlay();
warmUpGeneration++;
const aiPrepared = aiReady || (await prepareAI(warmUpGeneration));
if (!aiPrepared) {
  throw new Error("AI 모델 로딩에 실패했습니다.");
}
```

서버 세션은 모델 준비가 끝난 뒤 생성한다. 이렇게 해야 모델 로딩 실패 시 서버에 시작된 세션이 남지 않는다.

- [x] **Step 5: 시작 실패 복구에서 셋업 패널 상태도 복구한다**

`try` 진입 전에 셋업 패널과 선택 UI의 이전 상태를 함께 저장한다.

```js
const sourceSelectEl = document.getElementById("sourceSelect");
const setupPanelContainer = document.getElementById("setupPanelContainer");
const prevSourceSelectHidden = sourceSelectEl?.hidden || false;
const prevViewSelectHidden = viewSelectRoot?.hidden || false;
const prevPlankTargetHidden = plankTargetSelectRoot?.hidden || false;
const hadSetupPanelHiddenClass =
  setupPanelContainer?.classList.contains("hidden-during-workout") || false;
```

`catch`에서 아래 복구를 추가한다.

```js
if (sourceSelectEl) sourceSelectEl.hidden = prevSourceSelectHidden;
if (viewSelectRoot) viewSelectRoot.hidden = prevViewSelectHidden;
if (plankTargetSelectRoot) plankTargetSelectRoot.hidden = prevPlankTargetHidden;
if (setupPanelContainer && !hadSetupPanelHiddenClass) {
  setupPanelContainer.classList.remove("hidden-during-workout");
}
```

- [x] **Step 6: Task 1 테스트를 통과시킨다**

Run:

```bash
node --test test/workout/session-controller-start-flow.test.js
```

Expected:

```text
# pass 2
# fail 0
```

---

### Task 5: 전체 구문과 기존 회귀 테스트 확인

**Files:**
- Verify: `public/js/workout/session-controller.js`
- Verify: `test/workout/session-controller-seam.test.js`
- Verify: `test/workout/session-controller-start-flow.test.js`

- [x] **Step 1: JS 구문 검사를 실행한다**

Run:

```bash
node --check public/js/workout/session-controller.js
```

Expected:

```text
```

- [x] **Step 2: 세션 컨트롤러 관련 테스트를 실행한다**

Run:

```bash
node --test test/workout/session-controller-seam.test.js test/workout/session-controller-start-flow.test.js
```

Expected:

```text
# fail 0
```

- [x] **Step 3: 전체 테스트를 실행한다**

Run:

```bash
npm test
```

Expected:

```text
# fail 0
```

---

### Task 6: 브라우저 수동 검증

**Files:**
- Verify: `views/workout/session.ejs`
- Verify: `public/js/workout/session-controller.js`
- Verify: `public/workout.css`

- [ ] **Step 1: 서버를 실행한다**

Run:

```bash
node app.js
```

Expected:

```text
Server is running on port 3000
```

`PORT` 환경 변수를 설정한 경우에는 콘솔에 표시된 포트로 접속한다.

- [ ] **Step 2: 일반 운동 시작 흐름을 확인한다**

브라우저에서 운동 세션 페이지에 들어가 아래 순서를 확인한다.

```text
1. 카메라 연결 중... 오버레이 표시
2. 카메라 연결 완료 후 운동 시작 버튼 활성화
3. 운동 시작 클릭 직후 모델 로딩 중... 스피너 표시
4. 모델 로딩 완료 후 5, 4, 3, 2, 1 카운트다운 표시
5. 카운트다운 종료 후 상태가 운동 중으로 바뀌고 포즈 감지 시작
```

- [ ] **Step 3: 플랭크 목표 시간 조건을 확인한다**

플랭크 자유 운동에서 목표 시간이 10초 미만이면 시작 버튼이 비활성화되거나 시작이 막히는지 확인한다. 목표 시간을 10초 이상으로 설정하면 시작 버튼 클릭 후 모델 로딩 오버레이가 표시되어야 한다.

- [ ] **Step 4: 모델 로딩 실패 복구를 확인한다**

DevTools Network에서 MediaPipe CDN 요청을 차단하거나 오프라인 상태를 켠 뒤 시작 버튼을 누른다.

Expected:

```text
1. 모델 로딩 중... 오버레이 표시
2. 실패 후 운동 시작에 실패했습니다: AI 모델 로딩에 실패했습니다. alert 표시
3. 시작 버튼과 셋업 패널이 다시 사용 가능한 상태로 복구
```

---

## Risk Notes

- `prepareAI()`가 성공 시 `cameraReadyHtml`을 다시 그리지 않도록 바꾸기 때문에, 카메라 소스 전환 경로에서는 `connectCameraSource()`가 카메라 준비 오버레이를 직접 복구해야 한다.
- 서버 세션 생성은 모델 준비 이후로 이동해야 한다. 반대로 서버 세션을 먼저 만들면 모델 로딩 실패 시 실제 운동을 시작하지 않았는데도 세션이 생성될 수 있다.
- `canStartCurrentExercise()`에서 `aiReady`를 제거하면 시작 버튼은 카메라와 운동 입력 조건만 반영한다. 모델 준비 상태는 `startWorkout()` 내부에서 처리한다.
- `warmUpGeneration`은 시작 클릭마다 증가시켜 이전 로딩 결과가 뒤늦게 현재 시작 흐름을 덮어쓰지 않게 유지한다.

---

## Self-Review

- Spec coverage: 시작 버튼 직후 모델 로딩, 스피너 표시, 카운트다운 이후 운동 시작, 실패 복구를 각 Task에 반영했다.
- Placeholder scan: `TBD`, `TODO`, `나중에`, `적절히` 같은 미정 표현 없이 파일 경로, 코드 조각, 명령, 기대 결과를 명시했다.
- Type consistency: 기존 함수명 `connectCameraSource`, `prepareAI`, `runStartCountdown`, `startWorkout`, 상태 변수 `aiReady`, `warmUpGeneration`, DOM id `setupPanelContainer`, `sourceSelect`를 현재 코드와 일치시켰다.
