# 2026-04-09 : Push-Up Side-Only Phase-Aware Spec

## 1. 문서 목적

이 문서는 푸쉬업 1차 구현 기준을 고정하기 위한 spec이다.

이번 단계의 목표는 다음과 같다.

- 푸쉬업을 `SIDE only` 운동으로 확정한다.
- 스쿼트와 같은 `phase-aware rep scoring` 구조를 적용한다.
- 운동 시작 전에 선택한 view를 세션 전체에 고정한다.
- 설명 가능한 점수와 피드백을 제공한다.

이번 문서는 현재 기준 문서인 `docs/2026-04-09_rule_based_first_workout_spec.md`의 푸쉬업 상세 확장 문서다.

---

## 2. 핵심 결정

### 2.1 View 정책

푸쉬업 1차는 `SIDE only`로 제한한다.

- `allowed_views`: `['SIDE']`
- `default_view`: `SIDE`

이번 단계에서는 아래 view를 푸쉬업 채점 대상에서 제외한다.

- `FRONT`
- `DIAGONAL`

이유는 다음과 같다.

- 푸쉬업의 핵심 판정 요소는 `깊이`, `팔꿈치 굽힘`, `상하 이동`, `몸통 일직선 유지`다.
- 이 요소들은 정면보다 측면에서 훨씬 안정적으로 관측된다.
- 정면은 `좌우 대칭`, `팔 벌어짐`, `손 너비`에는 유리하지만 1차 핵심 점수에는 부적합하다.
- 대각선은 추후 별도 rule set 없이 재사용하기 어렵다.

### 2.2 Phase 정책

푸쉬업도 스쿼트처럼 phase를 나눠서 처리한다.

사용 phase는 다음과 같다.

- `NEUTRAL`
- `DESCENT`
- `BOTTOM`
- `ASCENT`
- `LOCKOUT`

점수 핵심 구간은 다음과 같다.

- `DESCENT`
- `BOTTOM`
- `ASCENT`
- `LOCKOUT`

`NEUTRAL`은 준비 상태와 예외 처리 중심으로 사용한다.

### 2.3 ML 정책

이번 단계에서는 ML을 사용하지 않는다.

- phase classifier 없음
- 라벨링 없음
- 학습 데이터 수집 없음
- runtime ML 추론 없음

---

## 3. 범위

### 3.1 포함 범위

- 푸쉬업 exercise module 추가
- `SIDE` view 기반 frame gate
- phase-aware rep 추적
- rep summary 기반 최종 재채점
- phase별 live feedback 필터링
- 결과 저장 및 수동 검증

### 3.2 제외 범위

- `FRONT` 푸쉬업 채점
- `DIAGONAL` 푸쉬업 채점
- 팔 벌어짐 정밀 판정
- 손 너비 정밀 판정
- 어깨 회전 및 견갑 움직임 판정
- ML 보정

---

## 4. 측정 원칙

푸쉬업 1차는 다음 원칙으로 채점한다.

- 메인 rep 신호는 `elbow_angle`
- 메인 자세 신호는 `hip_angle`과 `spine_angle`
- `shoulder_angle`은 보조 지표로만 취급한다.
- 관측 불안정한 항목은 점수에서 제외한다.
- 선택한 `SIDE` 자세가 무너지면 채점을 보류한다.

이번 단계에서 직접 점수화하지 않는 항목은 다음과 같다.

- 팔꿈치가 몸통에서 얼마나 벌어졌는지
- 손 너비
- 좌우 비대칭
- 어깨 말림

이 항목들은 정면 또는 대각선 view가 추가될 때 별도 rule set으로 다시 정의한다.

---

## 5. View 고정 정책

푸쉬업 세션은 운동 시작 전에 view를 고정한다.

동작 원칙은 다음과 같다.

1. 사용자는 운동 시작 전에 `SIDE`를 선택한다.
2. 세션 시작 후에는 `selectedView`를 잠근다.
3. 실시간 감지 view가 `SIDE`가 아니면 점수 계산을 멈춘다.
4. 이 경우 사용자에게 카메라 각도 또는 몸 방향 조정을 안내한다.

즉 푸쉬업 점수는 `push_up + SIDE` 조합에 대해서만 유효하다.

---

## 6. Phase 정의

### 6.1 NEUTRAL

의미:

- 운동 시작 전 준비 상태
- rep 시작 전 상단 대기 상태
- 판정 불가 상태

특징:

- 팔이 충분히 펴져 있음
- 하강 시작 전
- 점수 핵심 구간은 아님

### 6.2 DESCENT

의미:

- 상단에서 하단으로 내려가는 구간

판정 기준 초안:

- `elbow_angle` 감소 중
- `LOCKOUT` 이후 하강 시작
- 아직 바닥 구간 안정화 전

핵심 평가:

- 하강 제어
- 몸통 라인 유지
- 속도 안정성

### 6.3 BOTTOM

의미:

- 최저 지점에 도달한 구간

판정 기준 초안:

- `elbow_angle`이 바닥 임계값 이하
- 1~2 frame 이상 안정화되거나
- 하강이 멈추고 상승 시작 직전 상태

핵심 평가:

- 깊이 도달
- 바닥 구간 흔들림
- 몸통 유지

### 6.4 ASCENT

의미:

- 바닥 이후 다시 밀어 올리는 구간

판정 기준 초안:

- `BOTTOM` 이후 `elbow_angle` 증가 중

핵심 평가:

- 상승 중 몸통 무너짐 여부
- 반동 여부
- 상승 안정성

### 6.5 LOCKOUT

의미:

- 상단 복귀 후 팔이 충분히 펴진 구간

판정 기준 초안:

- `elbow_angle`이 상단 임계값 이상
- rep 종료 조건 충족

핵심 평가:

- 완전 신전
- 탑 포지션 안정성
- rep 종료 확정

---

## 7. Threshold 초안

초기값은 아래처럼 잡고, 실제 영상으로 튜닝한다.

- `LOCKOUT` 진입 기준: `elbow_angle >= 145~150`
- `BOTTOM` 진입 기준: `elbow_angle <= 90~100`
- `DESCENT` 판정 기준: 직전 frame 대비 `elbow_angle` 감소
- `ASCENT` 판정 기준: `BOTTOM` 이후 직전 frame 대비 `elbow_angle` 증가

보조 기준은 다음과 같다.

- 몸통 라인 유지: `hip_angle`이 기준 이하로 무너지지 않을 것
- 상체 안정성: `spine_angle` 급격한 변형이 없을 것
- 품질 기준: `quality.score`, `trackedJointRatio`, `inFrameRatio`, `viewStability`가 최소값 이상일 것

이번 단계에서는 임계값을 코드 상수로 시작하고, 수동 테스트 후 조정한다.

---

## 8. 1차 핵심 metric

### 8.1 점수 핵심 metric

- `elbow_angle`
- `hip_angle`
- `spine_angle`
- `quality.score`

### 8.2 보조 metric

- `shoulder_angle`
- phase별 duration
- rep 전체 duration
- quality level 분포

### 8.3 제외 metric

- `elbow_symmetry`
- `shoulder_symmetry`
- hand width 관련 metric
- flare 전용 metric

이 항목들은 1차 구현에서는 기록 또는 디버깅 용도로만 고려할 수 있으나, 최종 점수에는 반영하지 않는다.

---

## 9. Phase별 점수 설계

### 9.1 DESCENT

평가 항목:

- 내려가는 동안 팔꿈치 각도 감소가 안정적인지
- 몸통 라인이 유지되는지
- 지나치게 급하게 떨어지지 않는지

대표 오류:

- 하강 중 엉덩이 처짐
- 하강 중 상체 무너짐
- 통제되지 않은 급하강

### 9.2 BOTTOM

평가 항목:

- 충분한 깊이에 도달했는지
- 바닥 구간에서 흔들림이 과하지 않은지
- 바닥에서도 몸통 라인이 유지되는지

대표 오류:

- depth 부족
- 바닥에서 무너짐
- 바닥 구간 불안정

### 9.3 ASCENT

평가 항목:

- 상승 중 몸통 라인 유지
- 반동 없이 밀어 올리는지
- 상체와 엉덩이가 따로 놀지 않는지

대표 오류:

- 상승 중 힙이 먼저 올라감
- 상체 버티기 실패
- 반동 사용

### 9.4 LOCKOUT

평가 항목:

- 팔이 충분히 펴졌는지
- 상단에서 자세가 안정적인지
- rep 종료 조건이 명확한지

대표 오류:

- lockout 미완료
- 상단에서 팔 신전 부족
- rep 종료 모호함

---

## 10. Hard Fail / Soft Fail 초안

### 10.1 Hard Fail

다음 조건은 점수 상한 또는 rep 실패 조건으로 사용한다.

- `depth_not_reached`
- `lockout_incomplete`
- `body_line_broken`
- `view_mismatch`
- `low_confidence`

### 10.2 Soft Fail

다음 조건은 감점 및 피드백 조건으로 사용한다.

- `descent_unstable`
- `bottom_unstable`
- `ascent_unstable`
- `tempo_inconsistent`
- `torso_control_low`

---

## 11. Frame Gate 초안

푸쉬업용 frame gate는 스쿼트와 같은 quality gate 구조를 사용하되, `SIDE` 전용 조건을 강화한다.

gate 목적은 다음과 같다.

- 잘린 프레임 채점 방지
- 잘못된 view에서의 오판정 방지
- 품질이 낮은 frame에 대한 점수 오염 방지

기본 조건은 다음과 같다.

- 어깨, 팔꿈치, 손목, 골반, 무릎, 발목이 충분히 추적될 것
- 몸 전체가 프레임 안에 들어올 것
- 현재 감지 view가 `SIDE`일 것
- `quality.score`가 최소 기준 이상일 것

실패 시 예시 메시지는 다음과 같다.

- 몸을 측면으로 돌려주세요
- 전신이 보이도록 카메라를 조금 더 멀리 두세요
- 팔과 하체가 모두 보이도록 카메라를 조정해주세요

---

## 12. Rep 추적 구조

푸쉬업도 스쿼트와 동일한 구조로 rep summary를 만든다.

요약 구조는 아래를 포함한다.

- `exerciseCode`
- `durationMs`
- `finalPhase`
- `flags`
- `views`
- `confidence`
- `overall`
- `phases.DESCENT`
- `phases.BOTTOM`
- `phases.ASCENT`
- `phases.LOCKOUT`

phase별 metric summary에는 최소 아래 값이 들어간다.

- `elbowAngle`
- `hipAngle`
- `spineAngle`
- `qualityScore`

필요 시 이후 단계에서 아래를 확장할 수 있다.

- `shoulderAngle`
- `repTempo`
- `lockoutHoldMs`

---

## 13. 최종 rep 점수 방식

푸쉬업 rep 점수는 frame 평균 점수가 아니라, rep summary 기반 재채점으로 계산한다.

원칙은 다음과 같다.

- `DESCENT`, `BOTTOM`, `ASCENT`, `LOCKOUT` phase metric을 각각 평가한다.
- phase별 핵심 metric을 가중합한다.
- `hard fail`이 있으면 점수 상한을 둔다.
- confidence가 낮으면 추가 상한을 둔다.

이번 단계의 기본 방향은 다음과 같다.

- `BOTTOM`: depth 비중 가장 높음
- `DESCENT`: control 비중 높음
- `ASCENT`: body line 유지 비중 높음
- `LOCKOUT`: 완전 신전과 마무리 비중 높음

---

## 14. Live Feedback 정책

실시간 feedback은 현재 phase에 맞는 항목만 보여준다.

예시는 다음과 같다.

- `DESCENT`: 내려가는 제어, 몸통 유지
- `BOTTOM`: 더 깊게 내려가기, 바닥 자세 유지
- `ASCENT`: 몸통 일직선 유지, 안정적으로 밀어 올리기
- `LOCKOUT`: 끝까지 밀어 올리기

즉 스쿼트처럼 phase와 무관한 metric이 잘못된 시점에 계속 보이지 않도록 필터링한다.

---

## 15. 구현 대상 파일

이번 spec을 구현할 때 주요 대상 파일은 다음과 같다.

- `public/js/workout/exercises/push-up-exercise.js`
- `public/js/workout/rep-counter.js`
- `public/js/workout/scoring-engine.js`
- `public/js/workout/session-controller.js`
- `views/workout/session.ejs`

운동 메타데이터 기준으로는 아래도 함께 확인해야 한다.

- exercise의 `allowed_views`
- exercise의 `default_view`

---

## 16. 수동 검증 항목

1차 구현 후 최소 아래 케이스를 수동 검증한다.

1. 정상 푸쉬업
2. half rep
3. 바닥 깊이 부족
4. lockout 부족
5. 하강 중 엉덩이 처짐
6. 상승 중 힙 먼저 올라감
7. 카메라가 정면에 가까운 잘못된 view
8. 전신 일부가 잘린 상태
9. 조명 또는 추적 품질 저하 상태

검증 포인트는 다음과 같다.

- rep count가 안정적인지
- phase 전환이 자연스러운지
- 잘못된 자세에서 설명 가능한 감점이 되는지
- 잘못된 view에서 점수 계산이 멈추는지

---

## 17. 향후 확장 범위

이번 단계 이후 확장은 다음 순서로 검토한다.

1. 푸쉬업 `FRONT` 보조 분석 추가
2. `DIAGONAL` 전용 rule set 검토
3. flare, hand width, symmetry metric 추가
4. `body_line_angle` 같은 신규 metric 추가
5. 푸쉬업 phase별 세부 taxonomy 고도화

단, 위 확장은 `SIDE only` 1차가 안정화된 뒤 진행한다.

---

## 18. 결론

푸쉬업 1차 구현 방향은 아래처럼 정리한다.

```text
푸쉬업은 우선 SIDE only로 제한한다.
스쿼트처럼 phase-aware rep scoring 구조를 적용한다.
점수는 elbow_angle + body line 유지 중심으로 계산한다.
정면과 대각선은 후속 단계에서 별도 rule set으로 확장한다.
```
