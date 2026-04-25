# Workout Voice Feedback And Analysis Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browser-based Korean voice feedback for workout sessions while preserving a provider interface for future API TTS and structured feedback events for future history LLM analysis.

**Architecture:** Add a focused `session-voice.js` module that owns speech provider behavior, deduplication, cooldowns, and user enablement. Route live feedback through structured feedback events in `session-controller.js`, then deliver each event to `session-ui.js`, `session-voice.js`, and `SessionBuffer`. Preserve safe event payloads through `controllers/workout.js` so future `session_analysis.feature_json` builders can summarize repeated feedback.

**Tech Stack:** Vanilla browser JavaScript, Web Speech API, Node.js `node:test`, CommonJS/browser global dual exports, Express controller normalization.

---

## Source References

- Spec: `docs/specs/2026-04-26_workout_voice_feedback_and_llm_analysis_extension_spec.md`
- Main controller: `public/js/workout/session-controller.js`
- UI facade: `public/js/workout/session-ui.js`
- Session buffer: `public/js/workout/session-buffer.js`
- End-session persistence: `controllers/workout.js`
- Session template: `views/workout/session.ejs`
- Existing tests: `test/workout/session-controller-seam.test.js`, `test/workout/session-ui.test.js`, `test/session-buffer.test.js`

## File Structure

- Create `public/js/workout/session-voice.js`
  - Owns browser TTS provider abstraction.
  - Exports `createSessionVoice` and `createBrowserSpeechProvider`.
  - Exposes browser globals `window.createSessionVoice` and `window.createBrowserSpeechProvider`.
  - Exports CommonJS module for Node tests.
- Create `test/workout/session-voice.test.js`
  - Tests provider support detection, disabled mode, deduplication, cooldown, critical interruption, and persisted enablement.
- Modify `public/js/workout/session-buffer.js`
  - Extend `addEvent(type, payload)` without breaking `addEvent(type)`.
  - Make `recordEvent(event)` add a relative timestamp when missing.
  - Keep `export().events` as the browser-side source for feedback events.
- Modify `test/session-buffer.test.js`
  - Add tests for `addEvent(type, payload)` and `recordEvent(event)` preserving structured feedback events.
- Modify `controllers/workout.js`
  - Add a safe event payload allowlist helper.
  - Include `payload` in `normalizeEvents()` output when present.
  - Export `normalizeEvents` under `module.exports.__test` for focused tests.
- Create `test/workout/session-event-payload.test.js`
  - Tests server-side event payload preservation, trimming, and allowlist behavior.
- Modify `public/js/workout/session-ui.js`
  - Add `updateVoiceFeedbackToggle({ enabled, supported })` to keep voice toggle DOM text/state consistent.
- Modify `test/workout/session-ui.test.js`
  - Add a focused toggle state test.
- Modify `views/workout/session.ejs`
  - Load `session-voice.js` before `session-controller.js`.
  - Add a voice feedback toggle in the setup controls.
- Modify `public/js/workout/session-controller.js`
  - Load `session-voice.js` factory CommonJS-first.
  - Create voice instance during `initSession()`.
  - Add `createFeedbackEvent()` and `deliverFeedbackEvent()`.
  - Route `LOW_SCORE_HINT`, `REP_COMPLETE_FEEDBACK`, and selected `QUALITY_GATE_WITHHOLD` events through the shared path.
  - Bind the voice feedback toggle.
- Modify `test/workout/session-controller-seam.test.js`
  - Add `session-voice.js` to browser script-load order.
- Create `test/workout/session-controller-voice.test.js`
  - Static tests that enforce the controller routing points.

## Task 1: Voice Provider Module

**Files:**
- Create: `public/js/workout/session-voice.js`
- Create: `test/workout/session-voice.test.js`

- [ ] **Step 1: Write the failing voice module tests**

Create `test/workout/session-voice.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createBrowserSpeechProvider,
  createSessionVoice,
} = require('../../public/js/workout/session-voice.js');

function createProviderStub() {
  const calls = [];
  return {
    calls,
    cancelled: 0,
    isSupported() {
      return true;
    },
    speak(payload) {
      calls.push(payload);
      return { spoken: true };
    },
    cancel() {
      this.cancelled += 1;
    },
  };
}

function createStorageStub(initial = {}) {
  const values = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(values, key)
        ? values[key]
        : null;
    },
    setItem(key, value) {
      values[key] = String(value);
    },
  };
}

test('browser speech provider reports unsupported when Web Speech API is missing', () => {
  const provider = createBrowserSpeechProvider({
    speechSynthesis: null,
    SpeechSynthesisUtterance: null,
  });

  assert.equal(provider.name, 'browser-speech');
  assert.equal(provider.isSupported(), false);
});

test('browser speech provider creates a Korean utterance with rate and message', () => {
  const spoken = [];
  function FakeUtterance(text) {
    this.text = text;
  }

  const provider = createBrowserSpeechProvider({
    speechSynthesis: {
      speak(utterance) {
        spoken.push(utterance);
      },
      cancel() {},
    },
    SpeechSynthesisUtterance: FakeUtterance,
  });

  assert.equal(provider.isSupported(), true);

  provider.speak({
    message: '무릎을 바깥쪽으로 밀어주세요',
    lang: 'ko-KR',
    rate: 0.95,
  });

  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, '무릎을 바깥쪽으로 밀어주세요');
  assert.equal(spoken[0].lang, 'ko-KR');
  assert.equal(spoken[0].rate, 0.95);
});

test('session voice does not speak when disabled', () => {
  const provider = createProviderStub();
  const voice = createSessionVoice({
    provider,
    enabled: false,
    now: () => 1000,
  });

  const result = voice.speak('조금 더 깊이 앉아주세요', {
    type: 'LOW_SCORE_HINT',
  });

  assert.equal(result.spoken, false);
  assert.equal(result.reason, 'disabled');
  assert.equal(provider.calls.length, 0);
});

test('session voice suppresses duplicate messages inside duplicate window', () => {
  const provider = createProviderStub();
  let now = 1000;
  const voice = createSessionVoice({
    provider,
    enabled: true,
    minIntervalMs: 0,
    duplicateWindowMs: 6000,
    now: () => now,
  });

  assert.equal(
    voice.speak('무릎을 바깥쪽으로 밀어주세요', { type: 'LOW_SCORE_HINT' }).spoken,
    true,
  );
  now = 2000;
  const result = voice.speak('무릎을 바깥쪽으로 밀어주세요', {
    type: 'LOW_SCORE_HINT',
  });

  assert.equal(result.spoken, false);
  assert.equal(result.reason, 'duplicate');
  assert.equal(provider.calls.length, 1);
});

test('session voice respects minimum interval for non-critical messages', () => {
  const provider = createProviderStub();
  let now = 1000;
  const voice = createSessionVoice({
    provider,
    enabled: true,
    minIntervalMs: 2500,
    duplicateWindowMs: 0,
    now: () => now,
  });

  assert.equal(voice.speak('좋아요', { type: 'REP_COMPLETE_FEEDBACK' }).spoken, true);
  now = 2000;

  const result = voice.speak('조금 더 깊이 앉아주세요', {
    type: 'LOW_SCORE_HINT',
    severity: 'warning',
  });

  assert.equal(result.spoken, false);
  assert.equal(result.reason, 'cooldown');
  assert.equal(provider.calls.length, 1);
});

test('critical session voice cancels active speech and bypasses minimum interval', () => {
  const provider = createProviderStub();
  let now = 1000;
  const voice = createSessionVoice({
    provider,
    enabled: true,
    minIntervalMs: 2500,
    duplicateWindowMs: 0,
    now: () => now,
  });

  voice.speak('좋아요', { type: 'REP_COMPLETE_FEEDBACK' });
  now = 1200;

  const result = voice.speak('카메라에 전신이 보이도록 해주세요', {
    type: 'NO_PERSON',
    severity: 'critical',
  });

  assert.equal(result.spoken, true);
  assert.equal(provider.cancelled, 1);
  assert.equal(provider.calls.length, 2);
});

test('session voice persists enabled preference when storage is provided', () => {
  const provider = createProviderStub();
  const storage = createStorageStub({ fitplus_voice_feedback_enabled: 'false' });

  const voice = createSessionVoice({
    provider,
    enabled: true,
    storage,
  });

  assert.equal(voice.isEnabled(), false);
  voice.setEnabled(true);
  assert.equal(voice.isEnabled(), true);
  assert.equal(storage.getItem('fitplus_voice_feedback_enabled'), 'true');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test test/workout/session-voice.test.js
```

Expected:

```text
FAIL
Cannot find module '../../public/js/workout/session-voice.js'
```

- [ ] **Step 3: Implement `session-voice.js`**

Create `public/js/workout/session-voice.js`:

```js
const DEFAULT_STORAGE_KEY = 'fitplus_voice_feedback_enabled';

function createBrowserSpeechProvider({
  speechSynthesis = typeof window !== 'undefined' ? window.speechSynthesis : null,
  SpeechSynthesisUtterance = typeof window !== 'undefined'
    ? window.SpeechSynthesisUtterance
    : null,
} = {}) {
  return {
    name: 'browser-speech',
    isSupported() {
      return Boolean(speechSynthesis && SpeechSynthesisUtterance);
    },
    speak({ message, lang = 'ko-KR', rate = 1.0 } = {}) {
      if (!this.isSupported() || !message) {
        return { spoken: false, reason: 'unsupported' };
      }

      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = lang;
      utterance.rate = rate;
      speechSynthesis.speak(utterance);
      return { spoken: true };
    },
    cancel() {
      if (speechSynthesis?.cancel) {
        speechSynthesis.cancel();
      }
    },
  };
}

function readStoredEnabled(storage, storageKey, fallback) {
  if (!storage?.getItem) return fallback;
  const stored = storage.getItem(storageKey);
  if (stored === 'true') return true;
  if (stored === 'false') return false;
  return fallback;
}

function createSessionVoice({
  provider = createBrowserSpeechProvider(),
  enabled = true,
  minIntervalMs = 2500,
  duplicateWindowMs = 6000,
  defaultLang = 'ko-KR',
  defaultRate = 1.0,
  storage = typeof window !== 'undefined' ? window.localStorage : null,
  storageKey = DEFAULT_STORAGE_KEY,
  now = Date.now,
} = {}) {
  let voiceEnabled = readStoredEnabled(storage, storageKey, enabled);
  let lastSpokenAt = -Infinity;
  const lastMessageAt = new Map();

  function isSupported() {
    return Boolean(provider?.isSupported?.());
  }

  function isEnabled() {
    return voiceEnabled && isSupported();
  }

  function setEnabled(nextEnabled) {
    voiceEnabled = nextEnabled === true;
    if (storage?.setItem) {
      storage.setItem(storageKey, voiceEnabled ? 'true' : 'false');
    }
    if (!voiceEnabled) {
      provider?.cancel?.();
    }
  }

  function cancel() {
    provider?.cancel?.();
  }

  function speak(message, context = {}) {
    const normalizedMessage = typeof message === 'string' ? message.trim() : '';
    if (!normalizedMessage) {
      return { spoken: false, reason: 'empty' };
    }
    if (!voiceEnabled) {
      return { spoken: false, reason: 'disabled' };
    }
    if (!isSupported()) {
      return { spoken: false, reason: 'unsupported' };
    }

    const currentTime = Number(now()) || 0;
    const severity = context?.severity || 'info';
    const isCritical = severity === 'critical';
    const previousMessageAt = lastMessageAt.get(normalizedMessage);

    if (
      !isCritical &&
      Number.isFinite(previousMessageAt) &&
      currentTime - previousMessageAt < duplicateWindowMs
    ) {
      return { spoken: false, reason: 'duplicate' };
    }

    if (!isCritical && currentTime - lastSpokenAt < minIntervalMs) {
      return { spoken: false, reason: 'cooldown' };
    }

    if (isCritical) {
      provider.cancel?.();
    }

    const result = provider.speak({
      message: normalizedMessage,
      lang: context?.lang || defaultLang,
      rate: context?.rate || defaultRate,
      context,
    }) || { spoken: true };

    if (result.spoken !== false) {
      lastSpokenAt = currentTime;
      lastMessageAt.set(normalizedMessage, currentTime);
      return { spoken: true };
    }

    return result;
  }

  return {
    cancel,
    isEnabled,
    isSupported,
    setEnabled,
    speak,
  };
}

if (typeof window !== 'undefined') {
  window.createBrowserSpeechProvider = createBrowserSpeechProvider;
  window.createSessionVoice = createSessionVoice;
}

if (typeof module !== 'undefined') {
  module.exports = {
    createBrowserSpeechProvider,
    createSessionVoice,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --test test/workout/session-voice.test.js
```

Expected:

```text
PASS test/workout/session-voice.test.js
```

- [ ] **Step 5: Commit**

Run:

```bash
git add public/js/workout/session-voice.js test/workout/session-voice.test.js
git commit -m "feat(workout): add voice feedback provider"
```

## Task 2: Structured SessionBuffer Events

**Files:**
- Modify: `public/js/workout/session-buffer.js:209-225`
- Modify: `test/session-buffer.test.js`

- [ ] **Step 1: Write failing SessionBuffer event tests**

Append these tests to `test/session-buffer.test.js`:

```js
test('addEvent preserves a payload while keeping legacy type-only calls working', () => {
  const SessionBuffer = loadSessionBuffer();
  const buffer = new SessionBuffer('session-voice');

  buffer.addEvent('SESSION_START');
  buffer.addEvent('LOW_SCORE_HINT', {
    message: '무릎을 바깥쪽으로 밀어주세요',
    metric_key: 'knee_valgus',
    delivery: { visual: true, voice: true },
  });

  assert.equal(buffer.events.length, 2);
  assert.equal(buffer.events[0].type, 'SESSION_START');
  assert.equal(typeof buffer.events[0].timestamp, 'number');
  assert.deepEqual(buffer.events[1].payload, {
    message: '무릎을 바깥쪽으로 밀어주세요',
    metric_key: 'knee_valgus',
    delivery: { visual: true, voice: true },
  });
});

test('recordEvent adds a relative timestamp when feedback event has none', () => {
  const SessionBuffer = loadSessionBuffer();
  const buffer = new SessionBuffer('session-voice');

  buffer.recordEvent({
    type: 'REP_COMPLETE_FEEDBACK',
    message: '3회 좋아요',
    exercise_code: 'squat',
    delivery: { visual: true, voice: true },
  });

  const exported = buffer.export();
  assert.equal(exported.events[0].type, 'REP_COMPLETE_FEEDBACK');
  assert.equal(exported.events[0].message, '3회 좋아요');
  assert.equal(typeof exported.events[0].timestamp, 'number');
  assert.deepEqual(exported.events[0].delivery, {
    visual: true,
    voice: true,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test test/session-buffer.test.js
```

Expected:

```text
FAIL
Expected values to be strictly deep-equal
```

The first new test should fail because `addEvent(type, payload)` currently ignores the payload.

- [ ] **Step 3: Update SessionBuffer event methods**

In `public/js/workout/session-buffer.js`, replace the current `addEvent` and `recordEvent` methods with:

```js
  /**
   * 이벤트 기록
   */
  addEvent(type, payload = null) {
    const event = {
      type,
      timestamp: Date.now() - this.startTime
    };

    if (payload && typeof payload === 'object') {
      event.payload = { ...payload };
    }

    this.events.push(event);
  }

  /**
   * 구조화된 이벤트 기록 (feedback, withhold, gate 판정 등)
   * 기존 addEvent(type)는 하위 호환 유지
   */
  recordEvent(event) {
    if (!event || typeof event !== 'object') return;
    this.events.push({
      timestamp: Date.now() - this.startTime,
      ...event
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --test test/session-buffer.test.js
```

Expected:

```text
PASS test/session-buffer.test.js
```

- [ ] **Step 5: Commit**

Run:

```bash
git add public/js/workout/session-buffer.js test/session-buffer.test.js
git commit -m "feat(workout): preserve structured session events"
```

## Task 3: Server Event Payload Persistence

**Files:**
- Modify: `controllers/workout.js:680-704`
- Modify: `controllers/workout.js:2155-2165`
- Create: `test/workout/session-event-payload.test.js`

- [ ] **Step 1: Write failing server normalization tests**

Create `test/workout/session-event-payload.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const workoutController = require('../../controllers/workout.js');

test('normalizeEvents preserves a safe feedback payload subset', () => {
  assert.equal(typeof workoutController.__test?.normalizeEvents, 'function');

  const rows = workoutController.__test.normalizeEvents(
    [
      {
        type: 'LOW_SCORE_HINT',
        timestamp: 1200,
        message: '무릎을 바깥쪽으로 밀어주세요',
        exercise_code: 'squat',
        metric_key: 'knee_valgus',
        metric_name: '무릎 정렬',
        score: 42,
        max_score: 100,
        normalized_score: 42,
        rep_number: 3,
        set_number: 1,
        severity: 'warning',
        source: 'live_feedback',
        delivery: { visual: true, voice: true },
        ignored_private_value: 'must not be saved',
      },
    ],
    77,
    '2026-04-26T00:00:00.000Z',
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].session_id, 77);
  assert.equal(rows[0].type, 'LOW_SCORE_HINT');
  assert.equal(rows[0].event_time, '2026-04-26T00:00:01.200Z');
  assert.deepEqual(rows[0].payload, {
    message: '무릎을 바깥쪽으로 밀어주세요',
    exercise_code: 'squat',
    metric_key: 'knee_valgus',
    metric_name: '무릎 정렬',
    score: 42,
    max_score: 100,
    normalized_score: 42,
    rep_number: 3,
    set_number: 1,
    severity: 'warning',
    source: 'live_feedback',
    delivery: { visual: true, voice: true },
  });
});

test('normalizeEvents trims long feedback messages and supports nested payload', () => {
  const longMessage = '가'.repeat(700);

  const rows = workoutController.__test.normalizeEvents(
    [
      {
        type: 'REP_COMPLETE_FEEDBACK',
        timestamp_ms: 0,
        payload: {
          message: longMessage,
          exercise_code: 'squat',
          delivery: { visual: true, voice: false },
        },
      },
    ],
    88,
    '2026-04-26T00:00:00.000Z',
  );

  assert.equal(rows[0].payload.message.length, 500);
  assert.deepEqual(rows[0].payload.delivery, {
    visual: true,
    voice: false,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test test/workout/session-event-payload.test.js
```

Expected:

```text
FAIL
Expected values to be strictly equal
```

The test should fail because `controllers/workout.js` does not export `__test.normalizeEvents` yet.

- [ ] **Step 3: Add safe event payload normalization**

In `controllers/workout.js`, add these helpers immediately above `normalizeEvents`:

```js
const toEventText = (value, maxLength = 500) => {
    if (value == null) return null;
    const normalized = String(value).trim();
    return normalized ? normalized.slice(0, maxLength) : null;
};

const toEventNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const toEventBoolean = (value) => value === true;

const normalizeEventDelivery = (delivery) => {
    if (!delivery || typeof delivery !== 'object') return null;
    return {
        visual: toEventBoolean(delivery.visual),
        voice: toEventBoolean(delivery.voice)
    };
};

const buildSafeEventPayload = (event) => {
    const source = event?.payload && typeof event.payload === 'object'
        ? { ...event, ...event.payload }
        : event;
    const payload = {};

    const textFields = [
        'message',
        'exercise_code',
        'metric_key',
        'metric_name',
        'severity',
        'source',
        'withhold_reason',
        'selected_view',
        'quality_level'
    ];
    textFields.forEach((field) => {
        const normalized = toEventText(source?.[field]);
        if (normalized != null) payload[field] = normalized;
    });

    const numberFields = [
        'score',
        'max_score',
        'normalized_score',
        'rep_number',
        'set_number'
    ];
    numberFields.forEach((field) => {
        const normalized = toEventNumber(source?.[field]);
        if (normalized != null) payload[field] = normalized;
    });

    const delivery = normalizeEventDelivery(source?.delivery);
    if (delivery) payload.delivery = delivery;

    return Object.keys(payload).length > 0 ? payload : null;
};
```

- [ ] **Step 4: Include payload in normalized event rows**

Replace the return object inside `normalizeEvents()` with:

```js
            const payload = buildSafeEventPayload(event);
            const row = {
                session_id: sessionId,
                type: type.slice(0, 50),
                event_time: eventTime
            };

            if (payload) {
                row.payload = payload;
            }

            return row;
```

- [ ] **Step 5: Export `normalizeEvents` for tests**

At the bottom of `controllers/workout.js`, update `module.exports` to include `__test` after `getExercises`:

```js
module.exports = {
    getFreeWorkoutPage,
    getFreeWorkoutSession,
    getRoutineWorkoutSession,
    startWorkoutSession,
    endWorkoutSession,
    abortWorkoutSession,
    recordWorkoutSet,
    recordSessionEvent,
    getWorkoutResult,
    getExercises,
    __test: {
        normalizeEvents
    }
};
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
node --test test/workout/session-event-payload.test.js
```

Expected:

```text
PASS test/workout/session-event-payload.test.js
```

- [ ] **Step 7: Run existing controller-related tests**

Run:

```bash
node --test test/history-metric-series.test.js test/workout/session-event-payload.test.js
```

Expected:

```text
PASS
```

- [ ] **Step 8: Commit**

Run:

```bash
git add controllers/workout.js test/workout/session-event-payload.test.js
git commit -m "feat(workout): persist safe session event payloads"
```

## Task 4: Voice Toggle UI Facade And Template

**Files:**
- Modify: `public/js/workout/session-ui.js`
- Modify: `test/workout/session-ui.test.js`
- Modify: `views/workout/session.ejs`

- [ ] **Step 1: Write failing UI toggle test**

Append this test to `test/workout/session-ui.test.js`:

```js
test('updateVoiceFeedbackToggle reflects enabled and unsupported states', () => {
  const refs = {
    voiceFeedbackToggle: createElementStub(),
    voiceFeedbackStatus: createElementStub(),
    voiceFeedbackHint: createElementStub(),
  };

  const ui = createSessionUi({
    refs,
    createElement: () => createElementStub(),
    formatClock: (value) => `00:${String(value).padStart(2, '0')}`,
  });

  ui.updateVoiceFeedbackToggle({
    enabled: true,
    supported: true,
  });

  assert.equal(refs.voiceFeedbackToggle.textContent, '켜짐');
  assert.equal(refs.voiceFeedbackToggle.disabled, false);
  assert.equal(refs.voiceFeedbackStatus.textContent, '음성 피드백 켜짐');
  assert.equal(refs.voiceFeedbackHint.textContent, '운동 중 주요 피드백을 음성으로 안내합니다.');

  ui.updateVoiceFeedbackToggle({
    enabled: false,
    supported: false,
  });

  assert.equal(refs.voiceFeedbackToggle.textContent, '미지원');
  assert.equal(refs.voiceFeedbackToggle.disabled, true);
  assert.equal(refs.voiceFeedbackStatus.textContent, '음성 피드백 미지원');
  assert.equal(refs.voiceFeedbackHint.textContent, '이 브라우저에서는 음성 피드백을 사용할 수 없습니다.');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test test/workout/session-ui.test.js
```

Expected:

```text
FAIL
TypeError: ui.updateVoiceFeedbackToggle is not a function
```

- [ ] **Step 3: Add UI facade method**

In `public/js/workout/session-ui.js`, add this function before the final `return` object:

```js
  /**
   * 음성 피드백 토글 상태를 표시합니다.
   * @param {Object} params
   * @param {boolean} params.enabled - 사용자 설정상 음성 피드백이 켜져 있는지
   * @param {boolean} params.supported - 현재 브라우저가 TTS를 지원하는지
   */
  function updateVoiceFeedbackToggle({ enabled, supported }) {
    if (refs.voiceFeedbackToggle) {
      refs.voiceFeedbackToggle.disabled = !supported;
      refs.voiceFeedbackToggle.textContent = supported
        ? (enabled ? '켜짐' : '꺼짐')
        : '미지원';
      refs.voiceFeedbackToggle.classList?.toggle?.('active', supported && enabled);
    }

    if (refs.voiceFeedbackStatus) {
      refs.voiceFeedbackStatus.textContent = supported
        ? `음성 피드백 ${enabled ? '켜짐' : '꺼짐'}`
        : '음성 피드백 미지원';
    }

    if (refs.voiceFeedbackHint) {
      refs.voiceFeedbackHint.textContent = supported
        ? '운동 중 주요 피드백을 음성으로 안내합니다.'
        : '이 브라우저에서는 음성 피드백을 사용할 수 없습니다.';
    }
  }
```

Add `updateVoiceFeedbackToggle` to the returned object:

```js
    updateVoiceFeedbackToggle,
```

- [ ] **Step 4: Run UI test to verify it passes**

Run:

```bash
node --test test/workout/session-ui.test.js
```

Expected:

```text
PASS test/workout/session-ui.test.js
```

- [ ] **Step 5: Add template script and voice controls**

In `views/workout/session.ejs`, add the script after `session-ui.js` and before `routine-session-manager.js`:

```ejs
  <script src="/js/workout/session-ui.js"></script>
  <script src="/js/workout/session-voice.js"></script>
  <script src="/js/workout/routine-session-manager.js"></script>
```

In the setup panel, after the `viewSelect` block and before the `plankTargetSelect` block, add:

```ejs
          <div class="source-select" id="voiceFeedbackSelect" role="group" aria-label="음성 피드백 설정">
            <span class="source-select-label muted" id="voiceFeedbackStatus">음성 피드백 켜짐</span>
            <div class="source-select-buttons">
              <button
                type="button"
                class="ghost source-btn active"
                id="voiceFeedbackToggle"
                data-voice-feedback-toggle="true">
                켜짐
              </button>
            </div>
            <p class="source-select-hint muted" id="voiceFeedbackHint">운동 중 주요 피드백을 음성으로 안내합니다.</p>
          </div>
```

- [ ] **Step 6: Commit**

Run:

```bash
git add public/js/workout/session-ui.js test/workout/session-ui.test.js views/workout/session.ejs
git commit -m "feat(workout): add voice feedback toggle UI"
```

## Task 5: Controller Voice Loading And Feedback Routing

**Files:**
- Modify: `public/js/workout/session-controller.js`
- Modify: `test/workout/session-controller-seam.test.js`
- Create: `test/workout/session-controller-voice.test.js`

- [ ] **Step 1: Write failing controller voice routing tests**

Create `test/workout/session-controller-voice.test.js`:

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

test('session-controller has a CommonJS-first voice factory loader', () => {
  const body = extractFunctionBody(controllerSource, 'loadSessionVoiceFactory');

  assert.match(body, /require\('\.\/session-voice\.js'\)\.createSessionVoice/);
  assert.match(body, /window\.createSessionVoice/);
});

test('checkFeedback routes low-score feedback through structured delivery', () => {
  const body = extractFunctionBody(controllerSource, 'checkFeedback');

  assert.match(body, /createFeedbackEvent\s*\(/);
  assert.match(body, /type:\s*["']LOW_SCORE_HINT["']/);
  assert.match(body, /deliverFeedbackEvent\s*\(/);
  assert.doesNotMatch(body, /showAlert\("자세 교정 필요",\s*lowScoreItem\.feedback\)/);
});

test('showRepFeedback routes rep completion feedback through structured delivery', () => {
  const body = extractFunctionBody(controllerSource, 'showRepFeedback');

  assert.match(body, /createFeedbackEvent\s*\(/);
  assert.match(body, /type:\s*["']REP_COMPLETE_FEEDBACK["']/);
  assert.match(body, /deliverFeedbackEvent\s*\(/);
  assert.doesNotMatch(body, /ui\.showToast\(`\$\{repRecord\.repNumber\}회 \$\{msg\}`\)/);
});

test('handlePoseDetected records quality-gate feedback events before returning', () => {
  const body = extractFunctionBody(controllerSource, 'handlePoseDetected');

  assert.match(body, /type:\s*["']QUALITY_GATE_WITHHOLD["']/);
  assert.match(body, /deliverFeedbackEvent\s*\(/);
});
```

- [ ] **Step 2: Update failing browser script-load test expectation**

In `test/workout/session-controller-seam.test.js`, update the `files` array in `browser script loading does not throw when helper scripts load first`:

```js
  const files = [
    'quality-gate-session.js',
    'session-ui.js',
    'session-voice.js',
    'routine-session-manager.js',
    'onboarding-guide.js',
    'session-controller.js',
  ];
```

Add this assertion at the end of the same test:

```js
  assert.equal(typeof context.createSessionVoice, 'function');
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
node --test test/workout/session-controller-voice.test.js test/workout/session-controller-seam.test.js
```

Expected:

```text
FAIL
loadSessionVoiceFactory should exist
```

- [ ] **Step 4: Add voice loader**

Near the existing loader functions at the top of `public/js/workout/session-controller.js`, after `loadSessionUiFactory()`, add:

```js
function loadSessionVoiceFactory() {
  if (typeof module !== 'undefined' && typeof require === 'function') {
    return require('./session-voice.js').createSessionVoice;
  }

  if (typeof window !== 'undefined') {
    return window.createSessionVoice || null;
  }

  return null;
}

const sessionVoiceFactory = loadSessionVoiceFactory();
```

Do not throw if `sessionVoiceFactory` is unavailable. Voice feedback must degrade safely.

- [ ] **Step 5: Add DOM refs and create voice instance**

Inside `initSession()`, add DOM refs after the onboarding refs:

```js
  const voiceFeedbackToggle = document.getElementById("voiceFeedbackToggle");
  const voiceFeedbackStatus = document.getElementById("voiceFeedbackStatus");
  const voiceFeedbackHint = document.getElementById("voiceFeedbackHint");
```

Add these refs into `uiRefs`:

```js
    voiceFeedbackHint,
    voiceFeedbackStatus,
    voiceFeedbackToggle,
```

After `const ui = sessionUiFactory(...)`, create the voice instance:

```js
  const voice = typeof sessionVoiceFactory === 'function'
    ? sessionVoiceFactory({
        enabled: true,
        storage: typeof window !== 'undefined' ? window.localStorage : null,
      })
    : null;
```

- [ ] **Step 6: Add feedback event helpers**

Add these helper functions after `formatClock()` and before UI creation or immediately after UI creation:

```js
  function getFeedbackTimestamp() {
    return sessionBuffer?.startTime
      ? Date.now() - sessionBuffer.startTime
      : 0;
  }

  function buildDeliveryResult(visual, voiceResult) {
    return {
      visual: visual === true,
      voice: voiceResult?.spoken === true,
    };
  }

  function createFeedbackEvent({
    type,
    message,
    metric = null,
    repRecord = null,
    severity = 'info',
    source = 'session',
    withholdReason = null,
  }) {
    const normalizedMessage = (message || '').toString().trim();
    const event = {
      type,
      timestamp: getFeedbackTimestamp(),
      message: normalizedMessage,
      exercise_code: getCurrentExerciseCode(),
      severity,
      source,
      selected_view: state.selectedView,
    };

    if (metric) {
      event.metric_key = metric.key || metric.metric_key || null;
      event.metric_name = metric.title || metric.metric_name || null;
      event.score = Number.isFinite(Number(metric.score)) ? Number(metric.score) : null;
      event.max_score = Number.isFinite(Number(metric.maxScore))
        ? Number(metric.maxScore)
        : 100;
      event.normalized_score = Number.isFinite(Number(metric.normalizedScore))
        ? Number(metric.normalizedScore)
        : getNormalizedMetricScore(metric);
    }

    if (repRecord) {
      event.rep_number = repRecord.repNumber || repRecord.rep_number || null;
      event.score = Number.isFinite(Number(repRecord.score))
        ? Number(repRecord.score)
        : event.score;
    }

    if (state.currentSet) {
      event.set_number = state.currentSet;
    }

    if (withholdReason) {
      event.withhold_reason = withholdReason;
    }

    return event;
  }

  function shouldSpeakFeedbackEvent(event) {
    if (!event?.message) return false;
    if (event.type === 'QUALITY_GATE_WITHHOLD') {
      return ['out_of_frame', 'view_mismatch', 'no_person'].includes(event.withhold_reason);
    }
    return true;
  }

  function deliverFeedbackEvent(event, options = {}) {
    if (!event?.message) return;

    const visual = options.visual !== false;
    if (visual) {
      if (options.alertTitle) {
        showAlert(options.alertTitle, event.message);
      } else if (options.toast) {
        ui.showToast(event.message);
      }
    }

    const voiceResult = shouldSpeakFeedbackEvent(event)
      ? voice?.speak(event.message, event)
      : { spoken: false, reason: 'policy' };

    const eventWithDelivery = {
      ...event,
      delivery: buildDeliveryResult(visual, voiceResult),
    };

    if (sessionBuffer?.recordEvent) {
      sessionBuffer.recordEvent(eventWithDelivery);
    } else if (sessionBuffer?.addEvent) {
      sessionBuffer.addEvent(eventWithDelivery.type, eventWithDelivery);
    }
  }
```

Keep the helper names exactly as shown because later tests search for them.

- [ ] **Step 7: Bind voice toggle**

Add this helper near other setup helpers:

```js
  function syncVoiceFeedbackToggle() {
    ui.updateVoiceFeedbackToggle?.({
      enabled: voice?.isEnabled ? voice.isEnabled() : false,
      supported: voice?.isSupported ? voice.isSupported() : false,
    });
  }

  function setupVoiceFeedbackToggle() {
    syncVoiceFeedbackToggle();
    if (!voiceFeedbackToggle || !voice?.setEnabled) return;

    voiceFeedbackToggle.addEventListener("click", () => {
      const nextEnabled = !voice.isEnabled();
      voice.setEnabled(nextEnabled);
      syncVoiceFeedbackToggle();
    });
  }
```

Call it in the init sequence before camera connection:

```js
  setupVoiceFeedbackToggle();
```

- [ ] **Step 8: Route quality gate withhold feedback**

Inside the `if (suppression.suppress)` branch of `handlePoseDetected()`, replace the direct `showAlert(...)` and `sessionBuffer.addEvent("QUALITY_GATE_WITHHOLD", ...)` block with:

```js
      const message = mapGateWithholdReasonToMessage(suppression.reason);
      updateScoreDisplay({
        score: 0,
        breakdown: [],
        gated: true,
        message,
      });
      const event = createFeedbackEvent({
        type: "QUALITY_GATE_WITHHOLD",
        message,
        severity: "warning",
        source: "quality_gate",
        withholdReason: suppression.reason,
      });
      event.stable_frame_count = stabilityMetrics.stableFrameCount;
      deliverFeedbackEvent(event, {
        alertTitle: "자세 인식 대기",
      });
      return;
```

Remove the old duplicate `sessionBuffer.addEvent("QUALITY_GATE_WITHHOLD", ...)` from that branch. `deliverFeedbackEvent()` now records the event.

- [ ] **Step 9: Route low score feedback**

Replace the body of `checkFeedback()` with:

```js
  function checkFeedback(scoreResult) {
    if (state.alertCooldown) return;

    const lowScoreItem = selectAlertFeedbackItem(scoreResult);

    if (lowScoreItem) {
      const event = createFeedbackEvent({
        type: "LOW_SCORE_HINT",
        message: lowScoreItem.feedback,
        metric: lowScoreItem,
        severity: "warning",
        source: "live_feedback",
      });

      deliverFeedbackEvent(event, {
        alertTitle: "자세 교정 필요",
      });
    }
  }
```

- [ ] **Step 10: Route rep completion feedback**

Replace only the final `ui.showToast(...)` call in `showRepFeedback()` with:

```js
    const event = createFeedbackEvent({
      type: "REP_COMPLETE_FEEDBACK",
      message: `${repRecord.repNumber}회 ${msg}`,
      repRecord,
      severity: repRecord.score >= 80 ? "success" : "info",
      source: "rep_complete",
    });

    deliverFeedbackEvent(event, {
      toast: true,
    });
```

- [ ] **Step 11: Run controller voice tests**

Run:

```bash
node --test test/workout/session-controller-voice.test.js test/workout/session-controller-seam.test.js
```

Expected:

```text
PASS
```

- [ ] **Step 12: Commit**

Run:

```bash
git add public/js/workout/session-controller.js test/workout/session-controller-seam.test.js test/workout/session-controller-voice.test.js
git commit -m "feat(workout): route session feedback to voice events"
```

## Task 6: End-To-End Validation Bundle

**Files:**
- Verify only.

- [ ] **Step 1: Run syntax checks**

Run:

```bash
node --check public/js/workout/session-voice.js
node --check public/js/workout/session-ui.js
node --check public/js/workout/session-buffer.js
node --check public/js/workout/session-controller.js
node --check controllers/workout.js
```

Expected:

```text
no output and exit code 0 for each command
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
node --test test/workout/session-voice.test.js test/workout/session-ui.test.js test/session-buffer.test.js test/workout/session-event-payload.test.js test/workout/session-controller-voice.test.js test/workout/session-controller-seam.test.js
```

Expected:

```text
PASS
```

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected:

```text
PASS
```

- [ ] **Step 4: Browser manual verification**

Start the app with the project’s normal command:

```bash
node app.js
```

Then verify in a browser:

- Open a free workout session.
- Confirm the setup panel shows `음성 피드백`.
- Click the toggle and confirm the label changes between `켜짐` and `꺼짐`.
- Start a workout after camera connection.
- Trigger a low score posture feedback and confirm Korean TTS speaks once.
- Keep the same incorrect posture and confirm the same sentence is not repeated every frame.
- Complete a rep and confirm a short rep feedback is spoken once.
- Turn voice feedback off and confirm visual feedback still appears without speech.

- [ ] **Step 5: Commit validation notes if any docs changed**

No commit is required if no files changed during validation. If a small doc note is added, run:

```bash
git add docs
git commit -m "docs: note voice feedback validation"
```

## Risk Notes

- Browser TTS quality differs by OS/browser. This implementation only guarantees that supported browsers receive `ko-KR` utterances, not that every device has a natural Korean voice.
- Browser TTS generally works best after a user gesture. The session flow initializes voice settings in the page and only speaks during/after user-driven workout start.
- Do not call `speechSynthesis.speak()` directly from `session-controller.js`. All speech must go through `voice.speak()`.
- Do not send raw video, raw landmarks, or browser/device identifiers in event payloads.
- Do not persist unlimited payload fields. `controllers/workout.js` must only store the allowlisted fields in this plan.

## Self-Review Checklist

- Spec section 4.1 is covered by Tasks 1, 2, 4, and 5.
- Spec section 4.2 is covered by Tasks 1, 2, 3, and 5.
- Spec section 8 event contract is covered by Tasks 2, 3, and 5.
- Spec section 10 speech policy is covered by Task 1 and the policy branch in Task 5.
- Spec section 11 UI control is covered by Task 4.
- Spec section 12 payload persistence is covered by Task 3.
- Spec section 13 LLM extension is covered by persisted structured event payloads; actual `session_analysis` feature generation remains outside this first implementation plan by spec.
- Every task includes exact files, test commands, expected outcomes, and commit commands.
