# 스쿼트 점수 산출 로직 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스쿼트 자세 평가 로직을 NASM/PMC 등 전문 기준과 맞춰 개선하여 Trunk-Tibia 평행도, 발목/뒤꿈치 접지, Butt Wink, Hip Below Knee, Knee Valgus 측정을 추가하고 가중치를 재조정한다.

**Architecture:** 기존 `squat-exercise.js`의 `getSnapshot` → `createPhaseSummary` → `scoreRep` → `getMetricPlan` 파이프라인을 확장하여 새 메트릭을 수집하고, `scoring-engine.js`의 `getMetricValue`에 매핑을 추가한다. PoseEngine에서 새 각도가 날아온다고 가정하고 scoring 로직만 수정한다.

**Tech Stack:** JavaScript (Vanilla), Browser globals (window.WorkoutExerciseRegistry), CommonJS test exports.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `public/js/workout/exercises/squat-exercise.js` | 스쿼트 전용 메트릭 수집(snapshot/phase), rep 최종 점수 산출(scoreRep), 시점별 가중치(getMetricPlan) |
| `public/js/workout/scoring-engine.js` | 공통 메트릭 키 → angles 값 매핑(getMetricValue), 실시간 프레임 점수 계산(calculate) |
| `test/workout/scoring-state-machine.test.js` | 기존 스쿼트 rep 상태머신/채점 통합 테스트 |

---

## Task 1: Trunk-Tibia 평행도 메트릭 추가

**Files:**
- Modify: `public/js/workout/exercises/squat-exercise.js`
- Modify: `public/js/workout/scoring-engine.js`

**Context:** NASM/PMC Back Squat Assessment의 핵심 기준인 "Trunk is parallel to tibia"를 측정. spine_angle과 tibia_angle의 차이를 평가.

- [ ] **Step 1: snapshot/phase 수집 확장 (squat-exercise.js)**

`squat-exercise.js`의 `getSnapshot` 함수에 `tibiaAngle`과 `trunkTibiaAngle`을 추출하도록 추가:

```javascript
function getSnapshot(repCounter, angles, primaryAngle) {
  // ... existing code ...
  const tibiaAngle = repCounter.getAngleValue(angles, 'tibia_angle');
  const trunkTibiaAngle = angles.trunkTibiaAngle != null
    ? angles.trunkTibiaAngle
    : (Number.isFinite(angles.spine) && Number.isFinite(angles.tibia)
       ? Math.abs(angles.spine - angles.tibia)
       : null);

  return {
    kneeAngle: primaryAngle,
    hipAngle: repCounter.getAngleValue(angles, 'hip_angle'),
    spineAngle: repCounter.getAngleValue(angles, 'spine_angle'),
    tibiaAngle,
    trunkTibiaAngle,
    kneeSymmetry,
    kneeAlignment,
    qualityScore,
    view: angles.view || 'UNKNOWN',
    qualityLevel: angles.quality?.level || 'UNKNOWN'
  };
}
```

- [ ] **Step 2: phase metrics 등록 (squat-exercise.js)**

`createPhaseSummary` 함수의 `metrics` 객체에 두 키를 추가:

```javascript
metrics: {
  kneeAngle: repCounter.createMetricStats(),
  hipAngle: repCounter.createMetricStats(),
  spineAngle: repCounter.createMetricStats(),
  tibiaAngle: repCounter.createMetricStats(),
  trunkTibiaAngle: repCounter.createMetricStats(),
  kneeSymmetry: repCounter.createMetricStats(),
  kneeAlignment: repCounter.createMetricStats(),
  qualityScore: repCounter.createMetricStats()
}
```

같은 파일의 `recordPhaseFrame` 함수에도 두 `updateMetricStats` 호출을 추가:

```javascript
repCounter.updateMetricStats(target.metrics.tibiaAngle, snapshot.tibiaAngle);
repCounter.updateMetricStats(target.metrics.trunkTibiaAngle, snapshot.trunkTibiaAngle);
```

- [ ] **Step 3: scoreTrunkTibia 함수 추가 (squat-exercise.js)**

파일 하단의 `scoreSpine` 함수 아래에 추가:

```javascript
function scoreTrunkTibia(value) {
  if (!Number.isFinite(value)) return null;
  if (value <= 10) return 100;
  if (value <= 20) return interpolate(value, 10, 20, 100, 70);
  if (value <= 35) return interpolate(value, 20, 35, 70, 30);
  if (value <= 50) return interpolate(value, 35, 50, 30, 5);
  return 0;
}
```

- [ ] **Step 4: scoreRep에 trunkTibia 추출 및 metricPlan 전달 (squat-exercise.js)**

`scoreRep` 함수 낸에서 `maxSpine` 아래에 추가:

```javascript
const maxTrunkTibia = scoringEngine.pickMetric(
  summary, ['DESCENT', 'BOTTOM', 'ASCENT'], 'trunkTibiaAngle', 'max'
);
```

그리고 `getMetricPlan` 호출 시 `maxTrunkTibia`를 전달:

```javascript
const metricPlan = getMetricPlan(view, {
  bottomKnee,
  bottomHip,
  maxSpine,
  maxTrunkTibia,
  kneeSymmetry,
  kneeAlignment
});
```

- [ ] **Step 5: getMetricPlan에 trunk_titia 등록 (squat-exercise.js)**

`common` 객체에 `trunkTibia` 항목 추가:

```javascript
const common = {
  // ... depth, hip, spine, symmetry, alignment ...
  trunkTibia: {
    key: 'trunk_tibia_angle',
    title: '상체-다리 평행도',
    scorer: () => scoreTrunkTibia(values.maxTrunkTibia),
    rawValue: () => values.maxTrunkTibia,
    feedback: '상체와 다리가 평행하도록 자세를 유지해주세요'
  }
};
```

SIDE plan에 추가 (spine 일부 가중치를 재조정: depth 35%, hip 25%, spine 15%, trunkTibia 15%, alignment 10%):

```javascript
SIDE: [
  { ...common.depth, weight: 0.35 },
  { ...common.hip, weight: 0.25 },
  { ...common.spine, weight: 0.15 },
  { ...common.trunkTibia, weight: 0.15 },
  { ...common.alignment, weight: 0.10 }
]
```

FRONT plan에서는 trunkTibia는 제외 (측면에서만 측정 가능).

- [ ] **Step 6: getDefaultProfileMetrics에 등록 (squat-exercise.js)**

반환 배열에 추가 (spine 아래, knee_alignment 위):

```javascript
{
  weight: 0.15,
  max_score: 15,
  rule: {
    ideal_min: 0,
    ideal_max: 10,
    acceptable_min: 0,
    acceptable_max: 20,
    feedback_low: '상체와 다리가 평행하도록 자세를 유지해주세요',
    feedback_high: '상체가 너무 누워있습니다'
  },
  metric: {
    metric_id: 'squat_trunk_tibia',
    key: 'trunk_tibia_angle',
    title: '상체-다리 평행도',
    unit: 'DEG'
  }
}
```

- [ ] **Step 7: scoring-engine.js getMetricValue 매핑 추가**

`keyMapping` 객체에 추가:

```javascript
'trunk_tibia_angle': () => {
  if (angles.trunkTibiaAngle != null) return angles.trunkTibiaAngle;
  const spine = angles.spine;
  const tibia = angles.tibia;
  if (spine == null || tibia == null) return null;
  return Math.abs(spine - tibia);
},
'tibia_angle': () => angles.tibia,
```

- [ ] **Step 8: shouldKeepLiveMetric / getMetricCategory 확장 (squat-exercise.js)**

`getMetricCategory`에 `trunk_tibia_angle`을 `torso` 카테고리로 분류:

```javascript
if (key.includes('spine') || key.includes('torso') || key.includes('back') || key.includes('trunk_tibia')) {
  return 'torso';
}
```

`shouldKeepLiveMetric`은 `torso`가 모든 phase에서 평가되므로 별도 수정 불필요.

- [ ] **Step 9: 피드백 템플릿 추가 (scoring-engine.js)**

`generateFeedback` 낸의 `feedbackTemplates`에 추가:

```javascript
'trunk_tibia_angle': {
  low: '상체와 다리가 평행하도록 자세를 유지해주세요',
  high: '상체가 너무 누워있습니다'
},
'tibia_angle': {
  low: '무릎을 조금 더 굽혀주세요',
  high: '무릎이 너무 앞으로 나갔습니다'
}
```

- [ ] **Step 10: Commit**

```bash
git add public/js/workout/exercises/squat-exercise.js public/js/workout/scoring-engine.js
git commit -m "feat(squat): add trunk-tibia parallelism metric"
```

---

## Task 2: 발목/뒤꿈치 접지(Heel Contact) 메트릭 추가

**Files:**
- Modify: `public/js/workout/exercises/squat-exercise.js`
- Modify: `public/js/workout/scoring-engine.js`

**Context:** NASM 기준 "Entire foot remains in contact with the ground". 뒤꿈치가 뜨면 발목 dorsiflexion 부족을 의미.

- [ ] **Step 1: snapshot/phase 수집 확장 (squat-exercise.js)**

`getSnapshot`에 `heelContact` 추가. PoseEngine이 `heelContact` boolean 또는 `heelY`, `toeY` 좌표를 준다고 가정:

```javascript
const heelContact = angles.heelContact != null
  ? angles.heelContact
  : (Number.isFinite(angles.heelY) && Number.isFinite(angles.toeY)
     ? angles.heelY <= angles.toeY + 0.02  // 허용 오차 2cm
     : null);

return {
  // ... existing fields ...
  heelContact,
  // ...
};
```

`createPhaseSummary`의 `metrics`에 `heelContact: repCounter.createMetricStats()` 추가.
`recordPhaseFrame`에 `repCounter.updateMetricStats(target.metrics.heelContact, snapshot.heelContact)` 추가.

- [ ] **Step 2: scoreHeelContact 함수 추가 (squat-exercise.js)**

```javascript
function scoreHeelContact(value) {
  if (value === null || value === undefined) return null;
  return value === true || value === 1 ? 100 : 0;
}
```

- [ ] **Step 3: scoreRep에 heelContact 추출 (squat-exercise.js)**

```javascript
const minHeelContact = scoringEngine.pickMetric(
  summary, ['DESCENT', 'BOTTOM', 'ASCENT'], 'heelContact', 'min'
);
```

`getMetricPlan` 호출 시 전달.

- [ ] **Step 4: getMetricPlan에 등록 (squat-exercise.js)**

```javascript
heelContact: {
  key: 'heel_contact',
  title: '뒤꿈치 접지',
  scorer: () => scoreHeelContact(values.minHeelContact),
  rawValue: () => values.minHeelContact,
  feedback: '뒤꿈치가 떨어지지 않도록 유지해주세요'
}
```

SIDE plan에 추가 (depth 30%, hip 20%, spine 15%, trunkTibia 15%, heelContact 10%, alignment 10%):

```javascript
SIDE: [
  { ...common.depth, weight: 0.30 },
  { ...common.hip, weight: 0.20 },
  { ...common.spine, weight: 0.15 },
  { ...common.trunkTibia, weight: 0.15 },
  { ...common.heelContact, weight: 0.10 },
  { ...common.alignment, weight: 0.10 }
]
```

- [ ] **Step 5: getDefaultProfileMetrics에 등록 (squat-exercise.js)**

```javascript
{
  weight: 0.10,
  max_score: 10,
  rule: {
    type: 'boolean'
  },
  metric: {
    metric_id: 'squat_heel_contact',
    key: 'heel_contact',
    title: '뒤꿈치 접지',
    unit: 'BOOL'
  }
}
```

- [ ] **Step 6: scoring-engine.js getMetricValue 매핑 추가**

```javascript
'heel_contact': () => {
  if (angles.heelContact != null) return angles.heelContact ? 100 : 0;
  if (Number.isFinite(angles.heelY) && Number.isFinite(angles.toeY)) {
    return angles.heelY <= angles.toeY + 0.02 ? 100 : 0;
  }
  return null;
},
```

- [ ] **Step 7: shouldKeepLiveMetric / getMetricCategory 확장 (squat-exercise.js)**

`getMetricCategory`에 `heel_contact`를 `alignment` 카테고리로 분류 (하체 정렬 관련):

```javascript
if (key === 'knee_alignment' || key === 'knee_over_toe' || key === 'heel_contact') {
  return 'alignment';
}
```

`shouldKeepLiveMetric`은 `alignment`가 DESCENT/BOTTOM/ASCENT에서만 평가되므로 별도 수정 불필요.

- [ ] **Step 8: 피드백 템플릿 추가 (scoring-engine.js)**

```javascript
'heel_contact': {
  default: '뒤꿈치가 떨어지지 않도록 유지해주세요'
}
```

- [ ] **Step 9: Commit**

```bash
git add public/js/workout/exercises/squat-exercise.js public/js/workout/scoring-engine.js
git commit -m "feat(squat): add heel contact metric"
```

---

## Task 3: Butt Wink (Lumbar Neutral) 메트릭 추가

**Files:**
- Modify: `public/js/workout/exercises/squat-exercise.js`
- Modify: `public/js/workout/scoring-engine.js`

**Context:** Bottom position에서 골반 후방 경사(butt wink)로 인한 lumbar flexion은 하부 척추 부하를 증가시킴. lumbar_angle의 neutral 유지 여부 측정.

- [ ] **Step 1: snapshot/phase 수집 확장 (squat-exercise.js)**

`getSnapshot`에 `lumbarAngle` 추가:

```javascript
const lumbarAngle = repCounter.getAngleValue(angles, 'lumbar_angle');

return {
  // ... existing fields ...
  lumbarAngle,
  // ...
};
```

`createPhaseSummary`의 `metrics`에 `lumbarAngle: repCounter.createMetricStats()` 추가.
`recordPhaseFrame`에 `repCounter.updateMetricStats(target.metrics.lumbarAngle, snapshot.lumbarAngle)` 추가.

- [ ] **Step 2: scoreButtWink 함수 추가 (squat-exercise.js)**

Bottom에서 lumbar_angle이 10도 이하로 유지되면 만점, 25도 이상이면 급격한 감점:

```javascript
function scoreButtWink(value) {
  if (!Number.isFinite(value)) return null;
  if (value <= 10) return 100;
  if (value <= 18) return interpolate(value, 10, 18, 100, 70);
  if (value <= 25) return interpolate(value, 18, 25, 70, 30);
  if (value <= 35) return interpolate(value, 25, 35, 30, 5);
  return 0;
}
```

- [ ] **Step 3: scoreRep에 buttWink 추출 (squat-exercise.js)**

```javascript
const maxLumbar = scoringEngine.pickMetric(
  summary, ['BOTTOM'], 'lumbarAngle', 'max'
);
```

`getMetricPlan` 호출 시 전달.

- [ ] **Step 4: getMetricPlan에 등록 (squat-exercise.js)**

```javascript
buttWink: {
  key: 'lumbar_angle',
  title: '요추 중립 유지',
  scorer: () => scoreButtWink(values.maxLumbar),
  rawValue: () => values.maxLumbar,
  feedback: '엉덩이가 뒤로 말리지 않도록 코어를 단단히 잡아주세요'
}
```

SIDE plan에 추가 (depth 25%, hip 20%, spine 15%, trunkTibia 15%, buttWink 10%, heelContact 8%, alignment 7%):

```javascript
SIDE: [
  { ...common.depth, weight: 0.25 },
  { ...common.hip, weight: 0.20 },
  { ...common.spine, weight: 0.15 },
  { ...common.trunkTibia, weight: 0.15 },
  { ...common.buttWink, weight: 0.10 },
  { ...common.heelContact, weight: 0.08 },
  { ...common.alignment, weight: 0.07 }
]
```

- [ ] **Step 5: getDefaultProfileMetrics에 등록 (squat-exercise.js)**

```javascript
{
  weight: 0.10,
  max_score: 10,
  rule: {
    ideal_min: 0,
    ideal_max: 10,
    acceptable_min: 0,
    acceptable_max: 20,
    feedback_low: '요추를 중립으로 유지해주세요',
    feedback_high: '엉덩이가 뒤로 말리고 있습니다'
  },
  metric: {
    metric_id: 'squat_lumbar_neutral',
    key: 'lumbar_angle',
    title: '요추 중립 유지',
    unit: 'DEG'
  }
}
```

- [ ] **Step 6: scoring-engine.js getMetricValue 매핑 추가**

```javascript
'lumbar_angle': () => angles.lumbarAngle ?? angles.lumbar ?? null,
```

- [ ] **Step 7: shouldKeepLiveMetric / getMetricCategory 확장 (squat-exercise.js)**

`getMetricCategory`에 `lumbar_angle`을 `torso` 카테고리로 분류.

- [ ] **Step 8: 피드백 템플릿 추가 (scoring-engine.js)**

```javascript
'lumbar_angle': {
  low: '요추를 중립으로 유지해주세요',
  high: '엉덩이가 뒤로 말리고 있습니다'
}
```

- [ ] **Step 9: Commit**

```bash
git add public/js/workout/exercises/squat-exercise.js public/js/workout/scoring-engine.js
git commit -m "feat(squat): add butt wink / lumbar neutral metric"
```

---

## Task 4: Depth 기준 보완 (Hip Below Knee)

**Files:**
- Modify: `public/js/workout/exercises/squat-exercise.js`

**Context:** Powerlifting gold standard "hip crease below top of knee". 현재는 knee_angle만으로 깊이를 판정.

- [ ] **Step 1: snapshot/phase 수집 확장 (squat-exercise.js)**

`getSnapshot`에 `hipBelowKnee` boolean 추가:

```javascript
const hipBelowKnee = angles.hipBelowKnee != null
  ? angles.hipBelowKnee
  : (Number.isFinite(angles.hipY) && Number.isFinite(angles.kneeY)
     ? angles.hipY > angles.kneeY  // y좌표가 아래로 갈수록 큰 경우
     : null);

return {
  // ... existing fields ...
  hipBelowKnee,
  // ...
};
```

`createPhaseSummary`의 `metrics`에 `hipBelowKnee: repCounter.createMetricStats()` 추가.
`recordPhaseFrame`에 `repCounter.updateMetricStats(target.metrics.hipBelowKnee, snapshot.hipBelowKnee)` 추가.

- [ ] **Step 2: scoreRep에서 depth hard fail 보완 (squat-exercise.js)**

기존 depth_not_reached hard fail 조건을 보완:

```javascript
const bottomHipBelowKnee = scoringEngine.pickMetric(
  summary, ['BOTTOM'], 'hipBelowKnee', 'min'
);

const hardFails = [];
if (!summary.flags?.bottomReached || bottomKnee == null || bottomKnee > 125) {
  hardFails.push('depth_not_reached');
}
if (bottomHipBelowKnee === false) {
  hardFails.push('depth_not_reached');
}
```

- [ ] **Step 3: getDefaultProfileMetrics에 depth 관련 피드백 보완 (squat-exercise.js)**

기존 `squat_depth` 메트릭의 `feedback_low`를 더 구체적으로:

```javascript
feedback_low: '무릎이 90도 이상 굽혀지고 엉덩이가 무릎보다 낮아지도록 더 깊이 앉아주세요'
```

- [ ] **Step 4: Commit**

```bash
git add public/js/workout/exercises/squat-exercise.js
git commit -m "feat(squat): add hip-below-knee depth check"
```

---

## Task 5: Knee Valgus 정량적 측정 개선

**Files:**
- Modify: `public/js/workout/exercises/squat-exercise.js`
- Modify: `public/js/workout/scoring-engine.js`

**Context:** 무릎이 안쪽으로 무너지는(valgus) 정도를 정량적으로 측정. 현재 `kneeAlignment`는 방향 일치 여부만 측정.

- [ ] **Step 1: snapshot/phase 수집 확장 (squat-exercise.js)**

`getSnapshot`에 `kneeValgus` 추가:

```javascript
const kneeValgus = angles.kneeValgus != null
  ? angles.kneeValgus
  : (angles.kneeAlignment
     ? (Math.abs(angles.kneeAlignment.left || 0) + Math.abs(angles.kneeAlignment.right || 0)) / 2
     : null);

return {
  // ... existing fields ...
  kneeValgus,
  // ...
};
```

`createPhaseSummary`의 `metrics`에 `kneeValgus: repCounter.createMetricStats()` 추가.
`recordPhaseFrame`에 `repCounter.updateMetricStats(target.metrics.kneeValgus, snapshot.kneeValgus)` 추가.

- [ ] **Step 2: scoreKneeValgus 함수 추가 (squat-exercise.js)**

```javascript
function scoreKneeValgus(value) {
  if (!Number.isFinite(value)) return null;
  if (value <= 0.03) return 100;
  if (value <= 0.06) return interpolate(value, 0.03, 0.06, 100, 70);
  if (value <= 0.10) return interpolate(value, 0.06, 0.10, 70, 30);
  if (value <= 0.15) return interpolate(value, 0.10, 0.15, 30, 5);
  return 0;
}
```

- [ ] **Step 3: scoreRep에 kneeValgus 추출 (squat-exercise.js)**

```javascript
const avgKneeValgus = scoringEngine.pickMetric(
  summary, ['BOTTOM', 'ASCENT', 'DESCENT'], 'kneeValgus', 'avg'
);
```

`getMetricPlan` 호출 시 전달.

- [ ] **Step 4: getMetricPlan에 등록 및 기존 alignment 대체 (squat-exercise.js)**

FRONT view에서 기존 `alignment` 가중치를 `kneeValgus`와 분리/보완:

```javascript
kneeValgus: {
  key: 'knee_valgus',
  title: '무릎 안쪽 무너짐',
  scorer: () => scoreKneeValgus(values.avgKneeValgus),
  rawValue: () => values.avgKneeValgus,
  feedback: '무릎이 안쪽으로 무너지지 않도록 바깥쪽 힘으로 밀어주세요'
}
```

FRONT plan 재조정 (symmetry 30%, kneeValgus 25%, alignment 20%, depth 15%, spine 10%):

```javascript
FRONT: [
  { ...common.symmetry, weight: 0.30 },
  { ...common.kneeValgus, weight: 0.25 },
  { ...common.alignment, weight: 0.20 },
  { ...common.depth, weight: 0.15 },
  { ...common.spine, weight: 0.10 }
]
```

- [ ] **Step 5: getDefaultProfileMetrics에 등록 (squat-exercise.js)**

```javascript
{
  weight: 0.20,
  max_score: 20,
  rule: {
    ideal_min: 0,
    ideal_max: 0.03,
    acceptable_min: 0,
    acceptable_max: 0.08,
    feedback_low: '무릎이 안쪽으로 무너지지 않도록 바깥쪽 힘으로 밀어주세요',
    feedback_high: '무릎이 지나치게 바깥으로 벌어졌습니다'
  },
  metric: {
    metric_id: 'squat_knee_valgus',
    key: 'knee_valgus',
    title: '무릎 안쪽 무너짐',
    unit: 'RATIO'
  }
}
```

- [ ] **Step 6: scoring-engine.js getMetricValue 매핑 추가**

```javascript
'knee_valgus': () => {
  if (angles.kneeValgus != null) return angles.kneeValgus;
  if (!angles.kneeAlignment) return null;
  return (Math.abs(angles.kneeAlignment.left || 0) + Math.abs(angles.kneeAlignment.right || 0)) / 2;
},
```

- [ ] **Step 7: shouldKeepLiveMetric / getMetricCategory 확장 (squat-exercise.js)**

`getMetricCategory`에 `knee_valgus`를 `alignment` 카테고리로 분류.

- [ ] **Step 8: 피드백 템플릿 추가 (scoring-engine.js)**

```javascript
'knee_valgus': {
  low: '무릎이 안쪽으로 무너지지 않도록 바깥쪽 힘으로 밀어주세요',
  high: '무릎이 지나치게 바깥으로 벌어졌습니다'
}
```

- [ ] **Step 9: Commit**

```bash
git add public/js/workout/exercises/squat-exercise.js public/js/workout/scoring-engine.js
git commit -m "feat(squat): add knee valgus metric and refactor front view weights"
```

---

## Task 6: pickFeedback 함수 업데이트

**Files:**
- Modify: `public/js/workout/exercises/squat-exercise.js`

- [ ] **Step 1: pickFeedback에 새 메트릭 대응 추가 (squat-exercise.js)**

`pickFeedback` 함수 낸에서 `worstMetric` 이후, view-specific 조건문에 추가:

```javascript
if (view === 'SIDE' && Number.isFinite(values.maxTrunkTibia) && values.maxTrunkTibia > 25) {
  return '상체와 다리가 평행하도록 자세를 유지해주세요';
}
if (view === 'SIDE' && values.minHeelContact === false) {
  return '뒤꿈치가 떨어지지 않도록 유지해주세요';
}
if (view === 'SIDE' && Number.isFinite(values.maxLumbar) && values.maxLumbar > 20) {
  return '엉덩이가 뒤로 말리지 않도록 코어를 단단히 잡아주세요';
}
if (view === 'FRONT' && Number.isFinite(values.avgKneeValgus) && values.avgKneeValgus > 0.08) {
  return '무릎이 안쪽으로 무너지지 않도록 바깥쪽 힘으로 밀어주세요';
}
```

- [ ] **Step 2: Commit**

```bash
git add public/js/workout/exercises/squat-exercise.js
git commit -m "feat(squat): update pickFeedback for new metrics"
```

---

## Task 7: 테스트 업데이트

**Files:**
- Modify: `test/workout/scoring-state-machine.test.js`

- [ ] **Step 1: 기존 squat 관련 테스트에 새 메트릭 mock 데이터 추가**

테스트의 mock `angles` 객체에 `tibia_angle`, `trunkTibiaAngle`, `heelContact`, `lumbarAngle`, `hipBelowKnee`, `kneeValgus` 등을 추가하여 하위 호환성 확인.

- [ ] **Step 2: 새 메트릭에 대한 단위 테스트 추가**

`scoreTrunkTibia`, `scoreHeelContact`, `scoreButtWink`, `scoreKneeValgus` 함수들에 대해 경계값 테스트 작성:

```javascript
describe('squat new metrics', () => {
  test('scoreTrunkTibia 10deg = 100', () => {
    expect(scoreTrunkTibia(10)).toBe(100);
  });
  test('scoreTrunkTibia 50deg = 5', () => {
    expect(scoreTrunkTibia(50)).toBe(5);
  });
  // ... similar for heelContact, buttWink, kneeValgus
});
```

- [ ] **Step 3: getMetricPlan 가중치 합산 검증**

각 view(SIDE, FRONT, UNKNOWN)의 `getMetricPlan` 반환 배열의 weight 합이 1.0(또는 근접)인지 확인.

- [ ] **Step 4: Run tests**

```bash
npm test -- test/workout/scoring-state-machine.test.js
```

- [ ] **Step 5: Commit**

```bash
git add test/workout/scoring-state-machine.test.js
git commit -m "test(squat): add unit tests for new metrics"
```

---

## Self-Review

1. **Spec coverage:**
   - Trunk-Tibia parallelism → Task 1
   - Heel contact / ankle mobility → Task 2
   - Butt wink / lumbar neutral → Task 3
   - Hip below knee depth check → Task 4
   - Knee valgus quantitative → Task 5
   - Feedback messages → Task 6
   - Tests → Task 7

2. **Placeholder scan:** 모든 step에 실제 코드와 명령어 포함. "TODO/TBD" 없음.

3. **Type consistency:** `trunkTibiaAngle`, `heelContact`, `lumbarAngle`, `hipBelowKnee`, `kneeValgus` 키가 snapshot → phase → scoreRep → getMetricPlan → scorer 함수 전반에 일관되게 사용됨.

---

## Execution Handoff

**Plan complete.** Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
