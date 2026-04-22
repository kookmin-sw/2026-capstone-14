# 푸쉬업 채점 일관성 개선 명세서

## 메타데이터

- **날짜:** 2026-04-23
- **작성자:** FitPlus Engineering
- **상태:** 초안 — 검토 대기 중
- **관련 명세서:**
  - `2026-04-21-runtime-evaluation-spec-v3.md`
  - `2026-04-22-live-score-vs-rep-score-ux-spec.md`
  - `2026-04-22-quality-gate-authority-consolidation-design.md`

---

## 1. 문제 상황

현재 푸쉬업 용동 모듈(`push-up-exercise.js`)과 런타임 채점 통합(`scoring-engine.js`)은 최근 코드 감사에서 발견된 세 가지 일관성 결함을 안고 있습니다.

### 1.1 실시간 / 반복 점수 지표 스택 불일치 (P1)

`scoring-engine.js::calculate()`는 선언된 6개 프로필 지표 중 2개를 `getMetricValue()`가 `null`을 반환하기 때문에 걸러냅니다.

- `spine_stability` — `getMetricValue()`에 매핑이 존재하지 않습니다.
- `tempo` — `() => null`로 하드코딩되어 있습니다.

이 지표들은 `push-up-exercise.js`의 `scoreRep()` → `getMetricPlan()`에서는 정상적으로 평가됩니다. 결과적으로 실시간 피드백 스트림과 최종 반복 점수가 **서로 다른 루브릭**을 사용합니다. 사용자는 실시간으로 상체 안정성이나 템포 피드백을 보지 못하다가, 반복이 확정된 후 갑자기 이 지표들로 인해 감점당할 수 있습니다.

### 1.2 깊이 하드-페일이 채점 곡선보다 엄격함 (P1)

위상 탐지(`detectPhase()`)는 팔꿈치 각도가 약 103도 이하에서 최소 2프레임 이상 안정되어야 `bottomReached`를 설정합니다. 그러나 `scoreRep()`의 하드-페일 게이트는 `!bottomReached || bottomElbow > 110`인 모든 반복을 거부합니다. 연속 채점 곡선(`scoreDepth()`)은 105도~115도 사이에서도 부분 점수(82 → 45점)를 부여합니다. 따라서 104도~110도까지 낮추었지만 `bottomStableFrames >= 2` 조건을 만족하지 못한 반복은, 곡선상으로는 "이상적이지 않지만 허용 가능한 깊이"임에도 **하드-페일 상한 55점**을 받게 됩니다.

### 1.3 핵심 임계치에 대한 회귀 테스트 부재 (P3)

기존 테스트 스위트(`exercise-rule-separation.test.js`)는 구조적 계약(예: `requiredViews`, `getFrameGate` 부재)을 검증하지만, 사용자에게 노출되는 합격/불합격 동작을 정의하는 수치 임계치는 전혀 검증하지 않습니다. 향후 리팩토링에서 깊이 하드-페일을 110도에서 120도로 조용히 옮겨도 어떤 테스트도 실패하지 않을 것입니다.

---

## 2. 목표

1. **실시간과 반복 점수 지표 스택을 통일**하여 `getDefaultProfileMetrics()`에 선언된 모든 지표가 `ScoringEngine.calculate()`에서 null이 아닌 값을 생성하도록 합니다.
2. **깊이 하드-페일 임계치를 채점 곡선과 정렬**하여, 곡선이 0점보다 높은 점수를 주는 깊이에서 반복이 하드-페일되지 않도록 합니다.
3. **임계치 회귀 테스트를 추가**하여 현재 루브릭 값을 고정하고, 예기치 않은 변경 시 테스트가 실패하도록 합니다.

## 3. 비목표

1. **새로운 지표 추가**(예: 어깨 각도, 팔꿈치 경로). 포즈 엔진은 이미 `shoulderAngle`을 기록하지만, 문헌에서 합격/불합격 임계치를 유도하는 것은 이번 변경의 범위를 벗어납니다. 실시간 어깨 각도 데이터 분포를 충분히 수집한 후 재검토할 수 있습니다.
2. **UI / 피드백 문구 변경.** 실시간 채점에 새로 노출되는 지표를 제외하고 기존 한국어 피드백 문자열은 그대로 유지합니다.
3. **DB 스키마 또는 API 변경.** 모든 변경은 클라이언트 측 런타임(`public/js/workout/`)에 국한됩니다.

---

## 4. 상세 설계

### 4.1 실시간 / 반복 점수 지표 스택 통일

#### 4.1.1 `spine_stability` (상체 안정성)

**현재 상태:** `getMetricValue()`에 `spine_stability` 항목이 없어 `calculate()`가 이를 걸러냅니다.

**변경안:** `scoring-engine.js`에 매핑을 추가합니다.

```js
'spine_stability': () => {
  if (!angles.spine) return null;
  // 안정성은 현재 반복의 활성 위상 동안 척추 각도의 범위(최대 - 최소)로 측정됩니다.
  // calculate()는 프레임 수준에서 실행되므로, rep 카운터가 추적하는 척추 기준선으로부터
  // 순간적 편차(|델타|)를 반환합니다.
  const baseline = angles.spineBaseline ?? angles.spine;
  return Math.abs(angles.spine - baseline);
}
```

**근거:** 반복 수준의 `scoreSpineRange()`는 이미 스칼라 "범위" 값을 기대합니다. 프레임 수준에서는 롤링 기준선으로부터의 순간적 편차로 근사할 수 있습니다. `WorkoutSession` / 반복 카운터는 이미 프레임별 `spineAngle`을 추적하고 있습니다. 현재 반복의 시작 척추 각도를 `angles` 스냅샷에 `spineBaseline`으로 노출하면, 엔진이 반복 카운터 낶부와 결합하지 않고도 편차를 계산할 수 있습니다.

**대안:** `spineBaseline`을 사용할 수 없는 경우(예: 반복의 첫 프레임), `null`을 반환하여 해당 지표를 건저뛰도록 합니다. 이렇게 하면 데이터가 없을 때 완벽한 안정성 점수(100점)를 잘못 부여하는 것을 방지할 수 있습니다.

#### 4.1.2 `tempo` (동작 템포)

**현재 상태:** `getMetricValue()`는 `tempo`에 대해 `null`을 반환합니다.

**변경안:** **현재 활성 반복**의 경과 시간(밀리초)을 반환합니다.

```js
'tempo': () => {
  // 런타임이 현재 반복의 경과 시간을 노출하면 사용합니다.
  // 그렇지 않으면 null (해당 지표를 걸러냅니다).
  return Number.isFinite(angles.repElapsedMs) ? angles.repElapsedMs : null;
}
```

**근거:** 반복 수준의 `scoreTempo()`는 총 반복 지속 시간(900~2500ms = 100점)을 기준으로 채점합니다. 진행 중인 지속 시간을 제공하면 실시간 점수가 사용자가 반복 중에 너무 빠르거나 느리게 움직이는지를 반영할 수 있습니다. `repElapsedMs` 값은 세션 컨트롤러가 `repCounter.currentRepSummary?.durationMs`에서 주입할 것입니다.

**범위 참고:** `tempo`는 단일 프레임에서 완성된 반복만큼 의미가 있지는 않습니다. 실시간 점수는 반복 점수와 동일한 가중치(0.1)로 평가하고, 최소 의미 있는 지속 시간(예: 300ms)을 초과하기 전까지는 피드백을 억제하여 반복 시작 직후에 "너무 빠름" 경고가 잘못 표시되지 않도록 합니다.

#### 4.1.3 `hold` 및 `tempo` 규칙 유형 처리

`getDefaultProfileMetrics()`는 다음과 같이 선언합니다.
- `spine_stability` — `rule: { type: 'hold' }`
- `tempo` — `rule: { type: 'tempo' }`

`ScoringEngine.evaluateMetric()`은 두 유형에 대한 분기를 이미 가지고 있지만 미흡합니다.
- `evaluateHold()`는 스칼라 편차를 임계치와 비교합니다.
- `evaluateTempo()`는 값에 관계없이 고정 `0.7 * maxScore`를 반환합니다.

**변경안:**

1. **EvaluateHold** — 현재 로직(기본 임계치 10도)을 유지하고, 필요시 푸쉬업 지표 설정에서 안정성별 재정의를 추가합니다. 이번 명세에서는 변경이 필요 없습니다.
2. **EvaluateTempo** — 스텁을 `scoreTempo()`와 동일한 범위 평가로 교체합니다.

```js
evaluateTempo(value, rule, maxScore) {
  if (value == null) return Math.round(maxScore * 0.7);
  if (value >= 900 && value <= 2500) return maxScore;
  if (value >= 700 && value < 900)   return Math.round(maxScore * 0.85);
  if (value > 2500 && value <= 3500) return Math.round(maxScore * 0.85);
  if (value >= 500 && value < 700)   return Math.round(maxScore * 0.55);
  if (value > 3500 && value <= 5000) return Math.round(maxScore * 0.55);
  return Math.round(maxScore * 0.3);
}
```

이렇게 하면 실시간 채점이 `push-up-exercise.js::scoreTempo()`에 정의된 반복 수준 곡선과 일치합니다.

### 4.2 깊이 하드-페일 임계치 조정

#### 4.2.1 현재 불일치

| 메커니즘 | 임계치 | 동작 |
|----------|--------|------|
| `detectPhase` `nearBottom` | <= 103도 | 바닥 후보 로직 트리거 |
| `scoreRep` 하드-페일 | `bottomElbow > 110` 또는 `!bottomReached` | 점수를 55로 상한 |
| `scoreDepth` 곡선 | 105도 = 82점, 115도 = 45점 | 부분 점수 |

108도까지 내려갔지만 2프레임 안정 규칙을 충족하지 못한 반복은, `scoreDepth(108)`이 ~70점을 줄 것임에도 **하드-페일 상한 55점**을 받습니다.

#### 4.2.2 변경안

**옵션 A (권장):** 하드-페일 팔꿈치 임계치를 `110`에서 `115`로 상향합니다.

```js
// push-up-exercise.js::scoreRep
if (!summary.flags?.bottomReached || bottomElbow == null || bottomElbow > 115) {
  hardFails.push('depth_not_reached');
}
```

**근거:** 채점 곡선은 115도에서도 45점을 부여합니다. 110도에서 하드-페일을 하면 곡선이 "부분 점수"라고 하는 5도 사각 지대(110~115)가 생깁니다. 115도로 올리면 이 중첩이 사라집니다.

**부작용:**
- 약간 관대해집니다: 이전에 111~114도에서 실패했던 반복이 이제 하드-페일 게이트를 통과하고 45~55점 범위의 점수를 받게 됩니다.
- 이것은 **의도적인** 변경입니다 — 현재 동작은 임계치 불일치로 인한 우연이지 제품 결정이 아닙니다.

**옵션 B (대안):** `scoreDepth` 최저점을 110도로 내립니다.

```js
function scoreDepth(value) {
  if (value <= 95) return 100;
  if (value <= 105) return interpolate(value, 95, 105, 100, 82);
  if (value <= 110) return interpolate(value, 105, 110, 82, 45);
  return 15; // <= 110은 15점, 하드-페일 경계와 일치
}
```

이렇게 하면 하드-페일을 110도에 유지하면서 곡선과 일관성을 맞출 수 있습니다. 하지만 루브릭 전체가 더 엄격해집니다(115도가 이제 15점 대신 45점). 감사에서 현재 하드-페일을 *과도하게* 보수적이라고 식별했으므로 옵션 A가 선호됩니다.

#### 4.2.3 `bottomReached` 요구사항

`!summary.flags?.bottomReached` 조건은 그대로 유지됩니다. `bottomElbow`가 95도라도 위상 탐지기가 바닥 위상을 등록하지 않은 경우(예: 프레임 누락 또는 불안정한 추적), 해당 반복은 여전히 하드-페일됩니다. 이는 순수한 깊이 검사가 아니라 반복이 예상된 위상 순서를 거쳤는지에 대한 **구조적** 검사이므로 허용 가능합니다.

### 4.3 임계치 회귀 테스트

#### 4.3.1 테스트 파일

`test/workout/push-up-scoring.test.js`를 새로 생성합니다.

#### 4.3.2 `scoreRep` 단위 테스트

이 테스트는 모의 `ScoringEngine` 및 `repRecord` 객체와 함께 `pushUpExercise.scoreRep()`를 직접 호출합니다.

**테스트 매트릭스 (하드-페일 임계치):**

| bottomReached | bottomElbow | lockoutReached | lockoutElbow | minHip | 예상 hardFails |
|---------------|-------------|----------------|--------------|--------|----------------|
| true          | 95          | true           | 170          | 165    | []             |
| true          | 108         | true           | 170          | 165    | []             |
| true          | 116         | true           | 170          | 165    | [depth_not_reached] |
| false         | 95          | true           | 170          | 165    | [depth_not_reached] |
| true          | 95          | true           | 144          | 165    | [lockout_incomplete] |
| true          | 95          | true           | 170          | 139    | [body_line_broken] |
| true          | 116         | true           | 144          | 139    | [depth, lockout, body_line] |

**검증 기준:**
- 정확한 `hardFails` 배열 내용
- `finalScore` 상한 동작 (depth_not_reached → 최대 55, lockout_incomplete → 최대 65, body_line_broken → 최대 60)
- 하드-페일이 없을 때 `finalScore`가 `weightedScore * confidence.factor`에서 도출되는지

#### 4.3.3 채점 곡선 단위 테스트

`push-up-exercise.js`의 로컬 채점 함수를 직접 테스트합니다.

| 함수 | 입력 | 예상 출력 |
|------|------|-----------|
| `scoreDepth(95)` | 95 | 100 |
| `scoreDepth(105)` | 105 | 82 |
| `scoreDepth(110)` | 110 | ~63.5 |
| `scoreDepth(115)` | 115 | 45 |
| `scoreDepth(120)` | 120 | 15 |
| `scoreLockout(170)` | 170 | 100 |
| `scoreLockout(155)` | 155 | ~87.5 |
| `scoreLockout(145)` | 145 | 55 |
| `scoreLockout(140)` | 140 | 20 |
| `scoreBodyLine(170)` | 170 | 100 |
| `scoreBodyLine(150)` | 150 | ~72.5 |
| `scoreBodyLine(140)` | 140 | 45 |
| `scoreSpineRange(5)` | 5 | 100 |
| `scoreSpineRange(20)` | 20 | ~57.1 |
| `scoreTempo(1200)` | 1200 | 100 |
| `scoreTempo(800)` | 800 | ~85 |
| `scoreTempo(4000)` | 4000 | ~52.5 |

이 테스트는 **테이블 기반**입니다: 테스트 파일이 JSON 배열의 케이스를 읽고 각각을 단언합니다. 새로운 엣지 케이스를 추가하려면 JSON만 편집하면 됩니다.

#### 4.3.4 `detectPhase` + `scoreRep` 통합 테스트

프레임 시퀀스를 시뮬레이션하여 종단 간 깊이 하드-페일 동작을 검증합니다.

```
시퀀스 (팔꿈치 각도): 160, 150, 130, 115, 108, 105, 108, 115, 130, 150, 160
```

안정적인 델타로(예: 하강 시 -2도/프레임, 상승 시 +2도/프레임):
- 프레임 5 (108도): `nearBottom`은 참이지만, 상승이 시작되기 전에 `bottomStableFrames`가 2에 도달하지 못하면 `bottomReached`는 거짓으로 유지됩니다.
- 예상: 반복이 `depth_not_reached`로 하드-페일됩니다. `bottomElbow`(DESCENT/BOTTOM 최소값)는 105도입니다.

이 테스트는 알려진 보수적 동작을 문서화하고, 안정성 요구사항이 느슨해지거나 엄격해지면 실패할 것입니다.

#### 4.3.5 실시간 지표 노출 테스트

`ScoringEngine.calculate()`가 `spine_stability` 또는 `tempo`를 더 이상 걸러내지 않는지 테스트합니다.

1. `spine: 12, spineBaseline: 10, repElapsedMs: 1200`이 포함된 `angles` 객체를 제공합니다.
2. breakdown에 null이 아닌 `actualValue`를 가진 두 지표가 모두 포함되어 있는지 단언합니다.
3. `spine_stability`의 `actualValue`가 `2`(절대 차이)인지 확인합니다.
4. `tempo`의 `actualValue`가 `1200`인지 확인합니다.

---

## 5. 아키텍처 및 데이터 흐름

### 5.1 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `public/js/workout/scoring-engine.js` | `getMetricValue()`에 `spine_stability` 및 `tempo` 매핑 추가; `evaluateTempo()` 구현 업데이트 |
| `public/js/workout/exercises/push-up-exercise.js` | 깊이 하드-페일 임계치를 110에서 115로 상향; 테스트를 위한 로컬 채점 함수 내보내기 |
| `public/js/workout/pose-engine.js` | `angles` 출력에 `spineBaseline` 주입 (반복 카운터 상태 또는 활성 반복의 첫 프레임에서 도출) |
| `public/js/workout/workout-session.js` (또는 동등한 컨트롤러) | `ScoringEngine.calculate()`에 전달하기 전에 `angles`에 `repElapsedMs` 주입 |
| `test/workout/push-up-scoring.test.js` | **신규** — 임계치 및 곡선에 대한 테이블 기반 단위 테스트 |

### 5.2 시퀀스: 통합 지표를 사용한 실시간 채점

```
[PoseEngine] --angles--> [WorkoutSession]
                              |
                              v
                     [RepCounter]가 spineBaseline,
                     repElapsedMs를 활성 반복별로 추적
                              |
                              v
                     [WorkoutSession]이 angles에
                     spineBaseline, repElapsedMs를 보강
                              |
                              v
                     [ScoringEngine.calculate(angles)]
                     -> 6개 지표 breakdown 반환
                              |
                              v
                     [PushUpExercise.filterLiveFeedback]
                     -> 위상 인식 지표 필터링
                              |
                              v
                     [UI] 실시간 점수 + 피드백 표시
```

### 5.3 시퀀스: 반복 확정

```
[RepCounter.finalizeRep] -> 위상 지표가 포함된 summary
                              |
                              v
                     [ScoringEngine.scoreRep(summary)]
                     -> pushUpExercise.scoreRep() 호출
                     -> 동일한 루브릭 사용 (getMetricPlan)
                              |
                              v
                     [WorkoutSession] REP_RECORD 이벤트 발생
```

두 경로가 이제 동일한 6개 지표를 소비하므로, 실시간 점수는 반복 점수의 **미리보기**가 됩니다.

---

## 6. 테스트 전략

### 6.1 신규 테스트 파일: `test/workout/push-up-scoring.test.js`

**의존성:**
- Node.js 내장 `test`, `assert/strict`
- `scoring-engine.js`의 `ScoringEngine`
- `push-up-exercise.js`의 `pushUpExercise`

**설정:**
- `exercise-rule-separation.test.js`의 기존 `WorkoutExerciseRegistry` shim을 재사용합니다.
- 푸쉬업 기본 프로필 지표를 사용하는 최소 `ScoringEngine` 인스턴스를 생성합니다.

**테스트 그룹:**
1. `scoreRep 하드-페일 임계치`
2. `scoreRep 점수 상한`
3. `채점 곡선 함수`
4. `실시간 지표 노출`
5. `detectPhase + scoreRep 통합`

### 6.2 테이블 기반 데이터

테스트 케이스 테이블을 `test/workout/fixtures/push-up-thresholds.json`에 저장합니다.

```json
{
  "depthHardFailCases": [
    { "bottomReached": true, "bottomElbow": 95,  "expectedHardFails": [] },
    { "bottomReached": true, "bottomElbow": 115, "expectedHardFails": [] },
    { "bottomReached": true, "bottomElbow": 116, "expectedHardFails": ["depth_not_reached"] },
    { "bottomReached": false, "bottomElbow": 95, "expectedHardFails": ["depth_not_reached"] }
  ],
  "scoringCurveCases": [
    { "function": "scoreDepth", "input": 95, "expected": 100 },
    { "function": "scoreDepth", "input": 105, "expected": 82 },
    { "function": "scoreDepth", "input": 115, "expected": 45 }
  ]
}
```

테스트 러너는 이 배열을 순회하며 동등성을 단언합니다. 이렇게 하면 루브릭이 **기계 판독 가능**해지고 감사가 쉬워집니다.

### 6.3 기존 테스트 호환성

`exercise-rule-separation.test.js`는 수정 없이 계속 통과해야 합니다. 푸쉬업 운동 모듈은 동일한 인터페이스(`requirements`, `scoreRep` 등)를 계속 노출합니다. 내부 임계치 값과 스코어링 엔진 매핑만 변경됩니다.

---

## 7. 롤아웃 및 리스크

### 7.1 리스크: 실시간 점수 동작 변경

**영향:** 사용자가 이제 반복 중에 `spine_stability` 및 `tempo` 피드백을 보게 됩니다. 화면 피드백 밀도가 증가할 수 있습니다.

**완화:** `filterLiveFeedback()` 메커니즘이 이미 위상별로 지표를 억제합니다. 다음을 검증합니다.
- `spine_stability`는 DESCENT 및 ASCENT 중에 표시됩니다(상체 움직임이 가장 관련성 높을 때).
- `tempo`는 활성 반복 시간이 300ms를 초과한 후에만 표시되어 반복 시작 시 깜빡임을 방지합니다.

### 7.2 리스크: 깊이 하드-페일 관대화

**영향:** 임계치를 110에서 115로 올리면 루브릭이 약간 쉬워집니다. 이전에 111~114도에서 실패했던 반복이 이제 45~55점을 받게 됩니다.

**완화:** 이것은 **버그 수정**이지 제품 완화가 아닙니다. 이전 110도 임계치는 채점 곡선과 일관성이 없었습니다. 커밋 메시지에 이를 문서화하고, 필요한 경우 사용자 대향 패치 노트에 "깊이 평가 일관성 개선"으로 기록합니다.

### 7.3 리스크: `spineBaseline` 주입 의존성

**영향:** 세션 컨트롤러가 `spineBaseline` 주입에 실패하면 `spine_stability`가 `0`(편차 = 0)을 반환하여 항상 100점을 받게 되어 과도하게 관대해집니다.

**완화:** 방어적 검사를 추가합니다. `spineBaseline`이 누락된 경우 `getMetricValue`에서 `null`을 반환하여 해당 지표를 건너뛰도록 합니다. 이는 사용 불가능한 각도에 대한 현재 동작과 동일합니다.

---

## 8. 성공 기준

1. `ScoringEngine.calculate()`는 유효한 입력 각도가 제공될 때 6개 푸쉬업 지표 모두가 null이 아닌 `actualValue`를 가진 breakdown을 반환합니다.
2. `bottomElbow = 114`이고 `bottomReached = true`인 반복은 깊이로 인해 하드-페일되지 **않습니다**.
3. `bottomElbow = 116`이고 `bottomReached = true`인 반복은 깊이로 인해 하드-페일됩니다.
4. `push-up-scoring.test.js`의 모든 테스트가 통과합니다.
5. `exercise-rule-separation.test.js`가 수정 없이 계속 통과합니다.

---

## 9. 미해결 질문

1. `tempo` 실시간 피드백을 반복이 최소 지속 시간(예: 300ms)을 초과할 때까지 완전히 억제해야 할까요, 아니면 프레임 델타가 매우 빠른 움직임을 암시하는 경우 즉시 "너무 빠름" 경고를 표시해야 할까요?
2. 깊이 하드-페일 임계치는 운동 프로필별로 구성 가능(DB 기반)하게 해야 할까요, 아니면 운동 모듈의 하드코딩 상수로 남겨야 할까요?

이 질문들은 명세를 차단하지 않습니다. 구현 검토 중에 해결할 수 있습니다.
