# 2026-04-02 : FitPlus Current Scoring Spec

## 1. 문서 목적

이 문서는 현재 코드에 실제로 구현되어 있는 운동 점수 계산 방식을 설명한다.

이 문서는 목표 설계 문서인 `docs/2026-03-27_rule_based_scoring_refactor_spec.md`와 다르다.
`2026-03-27_rule_based_scoring_refactor_spec.md`는 지향점이고, 이 문서는 지금 동작하는 구현체 기준 스펙이다.

기준 파일은 다음과 같다.

- `public/js/workout/pose-engine.js`
- `public/js/workout/scoring-engine.js`
- `public/js/workout/rep-counter.js`
- `public/js/workout/session-buffer.js`
- `views/workout/session.ejs`

작성 기준 시점:

- 스쿼트는 `phase/view/confidence` 기반 rep scoring이 적용되어 있다.
- 다른 운동은 기존 frame scoring + rep 집계 구조를 유지한다.

---

## 2. 전체 구조 요약

현재 점수 계산은 2단계로 나뉜다.

1. `PoseEngine`가 프레임마다 관절 각도, view, quality를 계산한다.
2. `ScoringEngine.calculate()`가 프레임 점수를 만든다.
3. `RepCounter`가 rep 상태를 추적한다.
4. 스쿼트인 경우 rep 완료 시 `ScoringEngine.scoreRep()`가 rep summary를 다시 평가해 최종 rep 점수를 만든다.
5. `SessionBuffer`가 프레임 점수, rep 점수, 메트릭 요약을 저장한다.

즉 현재 구조는 아래와 같다.

- 실시간 화면용: frame score 중심
- rep 완료 결과용: 스쿼트만 rep score 재계산
- 세션 최종 점수: rep 점수 평균 우선

---

## 3. 입력 데이터

### 3.1 PoseEngine 출력

`PoseEngine.calculateAllAngles()`는 아래 데이터를 만든다.

- `leftKnee`, `rightKnee`
- `leftHip`, `rightHip`
- `leftElbow`, `rightElbow`
- `leftShoulder`, `rightShoulder`
- `spine`
- `kneeAlignment`
- `view`
- `angleSource`
- `quality`

### 3.2 각도 계산 규칙

- world landmark가 있으면 3D 각도를 우선 사용한다.
- 단, 측면(`SIDE`)에서는 굽힘각이 2D에서 더 안정적인 경우가 있어 2D를 우선 선택한다.
- 정면(`FRONT`)에서는 3D를 우선 선택한다.

### 3.3 view 판정

현재 view는 `worldLandmarks` 기준으로 계산한다.

- 좌우 어깨 z 차이 / x 차이
- 좌우 힙 z 차이 / x 차이
- 둘 중 큰 ratio를 사용
- ratio > `0.75` 이면 `SIDE`
- 그 외는 `FRONT`
- 최근 히스토리 다수결로 안정화한다

### 3.4 quality 계산

현재 quality는 아래 3개 요소를 합성한다.

- 주요 랜드마크 평균 visibility
- 주요 랜드마크 중 visibility `>= 0.6` 인 비율
- 현재 view가 최근 히스토리와 얼마나 일치하는지

사용 랜드마크:

- 양쪽 어깨
- 양쪽 힙
- 양쪽 무릎
- 양쪽 발목

공식:

```text
qualityScore = clamp(
  avgVisibility * 0.65 +
  visibleRatio * 0.20 +
  viewStability * 0.15,
  0,
  1
)
```

quality level 기준:

- `HIGH`: `>= 0.8`
- `MEDIUM`: `>= 0.6` and `< 0.8`
- `LOW`: `< 0.6`

quality factor 기준:

- `HIGH`: `1.0`
- `MEDIUM`: `0.85`
- `LOW`: `0.7`

---

## 4. Frame Scoring

### 4.1 개요

모든 운동은 먼저 프레임 단위 점수를 계산한다.

위치는 `public/js/workout/scoring-engine.js`의 `calculate()`이다.

입력:

- 현재 프레임의 `angles`
- DB의 `scoring_profile_metric`

출력:

- `score`
- `breakdown[]`
- `timestamp`

### 4.2 메트릭 값 추출

DB의 `metric.key`를 현재 포즈 값에 매핑한다.

대표 매핑은 다음과 같다.

- `knee_angle`: 좌우 무릎 평균
- `hip_angle`: 좌우 힙 중 더 작은 값
- `elbow_angle`: 좌우 팔꿈치 결합값
- `shoulder_angle`: 좌우 어깨 중 더 큰 값
- `spine_angle`: `angles.spine`
- `knee_symmetry`: 좌우 무릎 차이
- `knee_alignment`: 현재는 boolean 성격 점수로 변환
- `depth`: 무릎각을 `0~100` 깊이 점수로 환산

### 4.3 프레임 메트릭 평가 방식

지원되는 rule 타입:

- `symmetry`
- `position`
- `hold`
- `tempo`
- `range`
- `threshold`
- `optimal`
- `ideal_min / ideal_max` 기반 범위 평가

기본 동작:

- rule이 없으면 `maxScore * 0.7`
- 값이 없으면 해당 metric은 skip

### 4.4 프레임 최종 점수 공식

```text
frameScore = round(sum(metricScore * weight) / sum(weight))
```

### 4.5 프레임 피드백 규칙

metric score가 `maxScore * 0.7` 미만이면 해당 metric에 대한 피드백 후보를 만든다.

실시간 경고는 `views/workout/session.ejs`에서 아래 기준으로 띄운다.

- `feedback`가 있어야 함
- `item.score < item.maxScore * 0.6`
- rep 기반 운동은 rep 진행 중일 때만 검사

---

## 5. Rep Detection

### 5.1 공통 rep 상태

모든 반복 운동은 먼저 아래 3상태로 움직인다.

- `NEUTRAL`
- `TRANSITION`
- `ACTIVE`

### 5.2 공통 rep 완료 조건

기본 패턴은 다음과 같다.

```text
NEUTRAL -> ACTIVE -> NEUTRAL
```

rep가 인정되려면 다음 조건을 만족해야 한다.

- `hadActive === true`
- `repDuration >= pattern.minDuration`
- `activeTimeMs >= pattern.minActiveTime`

### 5.3 rep 진행 중 점수 집계

`RepCounter`는 진행 중 rep 점수 표시를 위해 프레임 점수를 누적한다.

- 우선 `ACTIVE` 구간 점수만 사용
- 없으면 `TRANSITION + ACTIVE` 전체 점수 fallback
- 집계 방식은 trimmed mean

스쿼트 예외:

- 스쿼트는 `DESCENT`, `BOTTOM`, `ASCENT` phase에서만 진행 중 점수를 누적한다.
- `LOCKOUT`과 `NEUTRAL`은 live score와 rep 기본 점수 집계에서 제외한다.

공식 개념:

- 샘플 정렬
- 상하위 5% 제거
- 나머지 평균 후 반올림

이 값은 진행 중 점수 표시용이며, 스쿼트의 최종 rep 점수와는 다를 수 있다.

---

## 6. Squat Phase Tracking

스쿼트는 공통 rep 상태 외에 별도 phase를 기록한다.

- `NEUTRAL`
- `DESCENT`
- `BOTTOM`
- `ASCENT`
- `LOCKOUT`

위치는 `public/js/workout/rep-counter.js`이다.

### 6.1 스쿼트 기본 rep 패턴

- primary angle: `knee_angle`
- neutral threshold: `160`
- active threshold: `100`
- direction: `decrease`
- min duration: `800ms`
- min active time: `200ms`

### 6.2 phase 판정 규칙

핵심 보조값:

- `delta = currentPrimaryAngle - previousPrimaryAngle`
- `nearBottom = kneeAngle <= active + 8`
- `nearLockout = kneeAngle >= neutral - 10` and `hipAngle >= 145`
- `movingDown = delta <= -1.5`
- `movingUp = delta >= 1.5`

phase 판정 로직 요약:

- rep 초반: `DESCENT`
- 바닥 근처에서 2프레임 이상 안정되거나, 더 이상 내려가지 않으면 `BOTTOM`
- 바닥 이후 각도가 증가하면 `ASCENT`
- 다시 충분히 펴지고 `NEUTRAL`로 돌아오면 `LOCKOUT`

### 6.3 스쿼트 rep summary에 기록하는 값

phase별로 아래 값을 누적한다.

- `kneeAngle`
- `hipAngle`
- `spineAngle`
- `kneeSymmetry`
- `kneeAlignment`
- `qualityScore`
- `views`
- `qualityLevels`
- `samples`
- `durationMs`

각 metric은 아래 통계를 저장한다.

- `min`
- `max`
- `avg`
- `count`

rep 전체에는 추가로 아래를 저장한다.

- `flags.bottomReached`
- `flags.ascentStarted`
- `flags.lockoutReached`
- `dominantView`
- `confidence`
- `overall`
- `phases`

---

## 7. Squat Rep Scoring

스쿼트는 rep 완료 시 frame score를 그대로 쓰지 않고, rep summary를 다시 평가한다.

위치는 `public/js/workout/scoring-engine.js`의 `scoreSquatRep()`이다.

### 7.1 rep scoring 입력값

rep summary에서 실제로 꺼내 쓰는 대표 값은 다음과 같다.

- `bottomKnee`: `BOTTOM -> DESCENT -> ASCENT` 순으로 `kneeAngle.min`
- `bottomHip`: `BOTTOM -> DESCENT` 순으로 `hipAngle.min`
- `maxSpine`: `DESCENT -> BOTTOM -> ASCENT` 순으로 `spineAngle.max`
- `kneeSymmetry`: `BOTTOM -> ASCENT -> DESCENT` 순으로 `kneeSymmetry.avg`
- `kneeAlignment`: `BOTTOM -> ASCENT -> DESCENT` 순으로 `kneeAlignment.avg`
- `lockoutKnee`: `LOCKOUT -> ASCENT` 순으로 `kneeAngle.max`

추가 원칙:

- 스쿼트 최종 점수에 사용하는 metric score와 confidence는 `DESCENT`, `BOTTOM`, `ASCENT` 중심으로 계산한다.
- `LOCKOUT`은 품질 점수 평균에 넣지 않고, 완료 확인 및 `lockout_incomplete` 판정용으로만 사용한다.

### 7.2 hard fail 조건

현재 hard fail은 3종류다.

- `depth_not_reached`
  - `bottomReached`가 없거나
  - `bottomKnee == null` 이거나
  - `bottomKnee > 125`

- `lockout_incomplete`
  - `lockoutReached`가 없거나
  - `lockoutKnee < 150`

- `low_confidence`
  - rep confidence level이 `LOW`
  - 이 confidence는 스쿼트의 경우 `DESCENT`, `BOTTOM`, `ASCENT` phase 품질값으로 계산한다.

추가 규칙:

- `FRONT` 뷰의 `knee_alignment`는 rep scoring에서 `BOTTOM`, `ASCENT` phase 값만 사용한다.
- `DESCENT`만 있거나 `LOCKOUT`에만 값이 있는 경우에는 해당 phase 값으로 보정하지 않는다.

### 7.3 view별 metric weight

#### SIDE

- `depth`: `0.40`
- `hip_angle`: `0.25`
- `spine_angle`: `0.20`
- `knee_alignment`: `0.15`

#### FRONT

- `knee_symmetry`: `0.35`
- `knee_alignment`: `0.35`
- `depth`: `0.20`
- `spine_angle`: `0.10`

#### UNKNOWN

- `depth`: `0.30`
- `knee_alignment`: `0.25`
- `knee_symmetry`: `0.20`
- `spine_angle`: `0.15`
- `hip_angle`: `0.10`

### 7.4 metric별 점수 커브

모든 스쿼트 rep metric은 내부적으로 `0~100` normalized score를 만든 뒤, 프로필의 `max_score`로 환산한다.

#### depth (`bottomKnee`)

- `<= 100`: `100`
- `100 ~ 115`: `100 -> 80` 선형 감소
- `115 ~ 125`: `80 -> 35` 선형 감소
- `> 125`: `15`

#### hip angle (`bottomHip`)

- `<= 120`: `100`
- `120 ~ 140`: `100 -> 65`
- `140 ~ 155`: `65 -> 25`
- `> 155`: `10`

#### spine angle (`maxSpine`)

- `<= 25`: `100`
- `25 ~ 40`: `100 -> 80`
- `40 ~ 55`: `80 -> 45`
- `> 55`: `20`

#### knee symmetry (`kneeSymmetry`)

- `<= 8`: `100`
- `8 ~ 15`: `100 -> 75`
- `15 ~ 25`: `75 -> 35`
- `> 25`: `15`

#### knee alignment (`kneeAlignment`)

- `<= 0.05`: `100`
- `0.05 ~ 0.08`: `100 -> 75`
- `0.08 ~ 0.12`: `75 -> 35`
- `> 0.12`: `15`

### 7.5 rep 기본 점수 공식

```text
baseRepScore = sum(normalizedMetricScore * weight) / sum(weight)
repScore = baseRepScore * confidence.factor
```

confidence factor:

- `HIGH`: `1.0`
- `MEDIUM`: `0.85`
- `LOW`: `0.7`

### 7.6 hard fail 점수 상한

hard fail이 있으면 최종 점수는 상한이 걸린다.

- `depth_not_reached`: 최대 `55`
- `lockout_incomplete`: 최대 `65`
- `low_confidence`: 최대 `60`

최종 점수는 `0~100`으로 clamp 후 반올림한다.

### 7.7 soft fail 정의

현재 soft fail은 아래 기준이다.

- rep breakdown 중 `score / maxScore < 0.7` 인 metric key 목록

즉 soft fail은 현재 별도 점수 penalty보다 분류/설명용 태그에 가깝다.

### 7.8 스쿼트 rep 피드백 우선순위

현재 rep 피드백은 아래 우선순위를 따른다.

1. `low_confidence`면 카메라 위치 조정 안내
2. `depth_not_reached`면 깊이 부족 피드백
3. `lockout_incomplete`면 lockout 부족 피드백
4. 가장 낮은 metric의 feedback
5. `SIDE` 뷰에서 힙 또는 상체 문제 보강 문구
6. 기본 긍정 문구

### 7.9 스쿼트 rep 디버그 로그

rep 완료 시 브라우저 콘솔에 아래 정보가 로그로 남는다.

- `repNumber`
- `scoreBeforeRepScoring`
- `finalScore`
- `view`
- `confidenceLevel`, `confidenceScore`
- `bottomKnee`, `bottomHip`, `maxSpine`
- `kneeSymmetry`, `kneeAlignment`, `lockoutKnee`
- `hardFails`, `softFails`
- `feedback`

로그 prefix는 다음과 같다.

```text
[ScoringEngine][Squat] Rep evaluation:
```

---

## 8. Non-Squat Scoring

스쿼트 외 운동은 아직 rep summary 기반 재채점을 하지 않는다.

현재 구조는 다음과 같다.

- frame마다 `ScoringEngine.calculate()` 수행
- `RepCounter`가 공통 3상태로 rep 완료 판단
- rep 점수는 rep 동안 모은 frame score의 trimmed mean
- 세션 최종 점수는 rep 평균 또는 score timeline 평균

즉 다음 운동들은 아직 기존 경로를 사용한다.

- `push_up`
- `lunge`
- `plank`
- `burpee`
- `deadlift`
- `shoulder_press`
- `bicep_curl`

---

## 9. UI 표시 방식

위치는 `views/workout/session.ejs`이다.

현재 UI는 아래 원칙으로 동작한다.

- 실시간 계산은 계속 frame score 기준으로 진행
- rep 진행 중 점수 표시는 `RepCounter.getCurrentRepScore()` 사용
- 첫 rep 전에는 `--` 표시
- rep 완료 후에는 마지막 rep 점수를 유지
- breakdown은 진행 중 rep buffer 또는 마지막 rep breakdown을 사용

스쿼트 점수 표시 예외:

- 진행 중 점수와 진행 중 breakdown은 `DESCENT`, `BOTTOM`, `ASCENT`에서만 누적한다.
- `LOCKOUT`, `NEUTRAL`은 스쿼트 품질 점수 구간으로 보지 않는다.

스쿼트 live feedback 예외 규칙:

- `NEUTRAL` 또는 `LOCKOUT`에서는 다리 관련 시각 피드백을 표시하지 않는다.
- 즉 `depth`, `knee_angle`, `knee_symmetry`, `knee_alignment` 계열은 서있는 구간에서 라인 색상에 반영되지 않는다.
- `FRONT` 뷰에서는 `BOTTOM`, `ASCENT`가 아닐 때 `knee_alignment` 계열 live feedback을 숨긴다.
- 이 예외는 live visual feedback과 실시간 alert 완화용이며, 스쿼트 최종 rep scoring과는 별도 목적을 가진다.

스쿼트 rep가 완료되면 아래 정보가 UI/이벤트에 반영된다.

- `score`
- `breakdown`
- `feedback`
- `phase`
- `view`
- `confidence.level`

---

## 10. 저장 방식

위치는 `public/js/workout/session-buffer.js`이다.

### 10.1 score timeline

- frame score는 1초에 1번 다운샘플링해서 저장
- `detail.score_timeline`에 들어감

### 10.2 rep records

- rep 완료 시 `repRecord` 전체를 저장
- 스쿼트는 `summary`, `breakdown`, `feedback`, `hardFails`, `softFails`까지 포함될 수 있음
- `detail.rep_records`에 들어감

### 10.3 metric 결과

- rep breakdown이 있으면 `repMetricAccumulators`를 우선 사용
- 없으면 frame breakdown 누적값 사용
- 최종적으로 `session_metric_result`에 평균 점수/평균 raw값 저장

### 10.4 세션 최종 점수

공식:

```text
if repRecords.length > 0:
  finalScore = average(rep.score)
else:
  finalScore = average(scoreTimeline.score)
```

즉 반복 운동은 rep 점수 평균이 세션 최종 점수가 된다.

---

## 11. 현재 구현의 특징

현재 구현의 핵심 특징은 다음과 같다.

- DB 기반 frame scoring은 그대로 유지된다.
- 스쿼트만 rep summary 기반 재채점이 추가되었다.
- 스쿼트 rep scoring은 view-aware다.
- 스쿼트 rep scoring은 confidence-aware다.
- hard fail은 점수 상한 방식으로 적용된다.
- soft fail은 설명용 태그 역할이 더 크다.
- 세션 최종 점수는 rep 평균을 우선 사용한다.

---

## 12. 현재 구현의 한계

현재 구현은 목표 설계 대비 아직 아래 제약이 있다.

- 스쿼트만 phase-aware rep scoring이 적용됨
- frame score와 rep score가 동시에 존재해 경로가 이원화되어 있음
- 실시간 alert는 여전히 frame breakdown 중심임
- quality는 visibility + view 안정성 기반의 간단한 휴리스틱임
- jitter, 속도 안정성, hold quality 같은 세부 안정성 지표는 아직 제한적임
- soft fail은 점수 체계보다 태그 체계에 가까움

---

## 13. 한 줄 요약

현재 FitPlus scoring은 아래처럼 이해하면 된다.

- 공통 기반: DB rule 기반 frame scoring
- rep 인식: `RepCounter`
- 스쿼트만 예외적으로: rep summary를 다시 읽어 `phase/view/confidence` 기반 최종 rep score 계산
- 세션 최종 점수: rep 점수 평균 우선
