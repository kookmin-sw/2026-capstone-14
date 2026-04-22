# 스쿼트 폼 규칙 정렬 패치 스펙

**작성일:** 2026-04-22  
**상태:** Draft  
**관련 문서:**  
- [런타임 중심 운동 평가 신뢰도 개선 통합 실행 스펙 v3](./2026-04-21-runtime-evaluation-spec-v3.md)  
- [Quality Gate Authority Consolidation — Design Spec](./2026-04-22-quality-gate-authority-consolidation-design.md)

---

## 1. 목적

외부 스쿼트 폼 가이드와 최근 생체역학 리뷰를 기준으로, 현재 코드베이스의 스쿼트 평가 로직을 다음 원칙에 맞게 정렬한다.

1. **선택한 시점(`FRONT`/`SIDE`)을 실제로 강제한다.**
2. **스쿼트에 필요한 raw signal만 pose-engine에서 실제 계산한다.**
3. **문헌상 측정 가능한 규칙만 점수화한다.**
4. **측정 정의와 피드백 문구를 일치시킨다.**
5. **현재 테스트가 놓치는 스쿼트 오채점 경로를 회귀 테스트로 고정한다.**

이번 스펙은 구현 가능한 패치 범위를 확정하는 문서다. DB 스키마 변경이나 신규 모델 도입은 포함하지 않는다.

---

## 2. 배경 문제

정적 코드 검토와 외부 근거 대조 결과, 현재 스쿼트 평가는 다음 문제를 가진다.

### 2.1 선택한 view가 실제 gate에서 강제되지 않음

- `session-controller.js`는 `selectedView`를 gate context에 전달한다.
- 그러나 `evaluateQualityGate()`는 `allowedViews`만 보고 `selectedView`는 무시한다.
- 스쿼트는 `FRONT/SIDE/DIAGONAL`을 모두 허용하므로, 사용자가 `FRONT`를 골라도 실제로는 `SIDE`로 서서 채점이 진행될 수 있다.
- 이후 rep scoring에서는 다시 `selectedView`를 우선 사용하므로, 실제 시점과 다른 기준으로 점수를 낼 수 있다.

### 2.2 스쿼트 채점이 기대하는 signal 중 일부가 실제로 생성되지 않음

현재 스쿼트 rep scoring은 다음 값을 사용하거나 사용하려고 한다.

- `trunkTibiaAngle`
- `heelContact`
- `lumbarAngle`
- `hipBelowKnee`

하지만 현재 `pose-engine.js`는 사실상 `knee / hip / spine / kneeAlignment / kneeValgus / quality / view`만 안정적으로 생성한다. 따라서 위 항목들은 대부분 `null`로 남고, 스쿼트 문헌에서 중요한 규칙이 실제 런타임에서는 꺼져 있는 상태다.

### 2.3 `knee_alignment`의 의미가 문헌상 규칙과 다름

- 현재 구현의 `getKneeAlignment()`는 `knee.x - ankle.x` 차이로 정의된다.
- 주석은 “무릎이 발끝보다 앞으로 나왔는지”라고 설명한다.
- 그러나 이 값은 실제로는 주로 **정면 기준 좌우 정렬/안쪽 붕괴 근사치**에 가깝고, 측면 기준 anterior knee travel을 직접 측정하지 못한다.
- 즉 “용어”, “계산식”, “피드백”이 서로 어긋나 있다.

### 2.4 직접 측정 불가능한 lumbar-neutral 규칙을 점수화하려고 함

- 문헌상 `neutral spine`은 중요하다.
- 하지만 현재 MediaPipe Pose landmark 세트만으로는 **요추 굴곡 자체를 직접적으로 측정하기 어렵다.**
- 그럼에도 `lumbar_angle` 규칙과 피드백이 정의되어 있고, rep scoring에서 활성 메트릭처럼 다뤄진다.
- 이 상태는 “측정 가능한 규칙만 점수화한다”는 원칙에 어긋난다.

---

## 3. 외부 규칙 기준선

이번 패치의 기준선은 다음 다섯 가지다.

### 3.1 발은 바닥에 안정적으로 닿고, 뒤꿈치가 뜨지 않아야 함

- NSCA 자료는 발/뒤꿈치 접지 유지와 안정적인 체중 분산을 기본 코칭 포인트로 둔다.
- Myer et al.는 `heels on the ground`를 스쿼트 관찰 기준으로 둔다.

### 3.2 무릎은 발 방향을 따라가고, 과도한 dynamic valgus는 피해야 함

- NSCA와 Myer et al.는 `knees track over the toes / foot`를 반복적으로 강조한다.
- Straub & Powers (2024)는 발 회전과 stance width가 knee valgus moment에 영향을 준다고 정리한다.

### 3.3 깊이는 최소 평행 이상이 기준이며, 더 깊은 범위는 neutral spine을 유지할 수 있을 때 허용됨

- NSCA manual과 Myer et al.는 `thigh parallel` 또는 `hip joint at or slightly below knee joint`를 기본 기준으로 둔다.
- 최근 리뷰는 deep squat 자체보다 **깊이 증가 시 spine neutrality가 깨지는지**를 더 중요한 제한 조건으로 본다.

### 3.4 trunk와 tibia의 상대 관계는 knee-bias vs hip-bias 해석에 중요함

- Straub & Powers (2024)는 trunk inclination과 tibia inclination을 함께 봐야 knee/hip demand를 해석할 수 있다고 정리한다.
- 따라서 `spine angle`만 단독으로 보는 것보다 `trunk-tibia relationship`을 유지하는 편이 합리적이다.

### 3.5 선택한 시점에서만 신뢰 가능한 metric을 점수화해야 함

- 정면에서는 knee valgus / 좌우 대칭성이 상대적으로 잘 보인다.
- 측면에서는 depth / hip hinge / heel contact / trunk-tibia가 상대적으로 잘 보인다.
- 따라서 **view-aware metric plan**은 유지하되, gate가 실제로 그 view를 보장해야 한다.

---

## 4. 패치 목표

이번 패치의 목표는 다음과 같다.

1. `selectedView`를 공통 quality gate에서 실제로 enforce한다.
2. 스쿼트 점수에 필요한 `tibia`, `trunkTibiaAngle`, `heelContact`, `hipBelowKnee`를 실제 raw signal로 채운다.
3. `kneeAlignment`를 “knee-over-toe”가 아니라 “frontal-plane knee tracking proxy”로 정리한다.
4. 직접적으로 측정할 수 없는 `lumbar_angle`은 이번 패치에서 활성 점수 메트릭에서 제거하거나 비활성 처리한다.
5. 깊이 규칙은 `parallel-or-below + control maintained` 원칙으로 유지한다.
6. 스쿼트 관련 회귀 테스트를 추가해 동일 문제가 재발하지 않게 한다.

---

## 5. 범위

### 포함

- `public/js/workout/scoring-engine.js`
- `public/js/workout/session-controller.js`
- `public/js/workout/pose-engine.js`
- `public/js/workout/exercises/squat-exercise.js`
- `test/workout/quality-gate.test.js`
- 신규 스쿼트 테스트 파일 또는 기존 테스트 확장

### 제외

- DB 스키마 변경
- 관리자 채점 프로필 UI 변경
- 사용자별 anthropometry 보정
- stance width / toe-out 각도 직접 채점
- 바벨 경로, 호흡, 속도 같은 추가 고급 항목
- 요추 굴곡 직접 추정용 신규 모델 도입

---

## 6. 설계

### 6.1 공통 quality gate에서 `selectedView`를 최우선으로 강제

#### 현재 문제

- `allowedViews`는 “운동이 허용하는 view 집합”이다.
- `selectedView`는 “이번 세션에서 사용자가 선택한 채점 기준 view”다.
- 현재 gate는 전자만 보고 후자는 무시한다.

#### 변경 원칙

- `selectedView`가 존재하고 `DIAGONAL`이 아니면, gate는 `estimatedView === selectedView`를 요구한다.
- `selectedView`가 없거나 `DIAGONAL`이면 기존처럼 `allowedViews` 기반 검사를 사용한다.
- gate 권한은 계속 `scoring-engine.js`에만 둔다.

#### 기대 효과

- 사용자가 `FRONT`를 선택했는데 실제로 `SIDE`로 서 있는 상태를 채점하지 않는다.
- view-aware metric plan이 실제로 의미를 갖는다.

### 6.2 스쿼트 raw signal을 `pose-engine.js`에서 실제 생성

#### 추가할 signal

- `tibia`
  - 정의: 무릎-발목 세그먼트의 수직 대비 기울기
  - 목적: `trunkTibiaAngle` 계산 기반 제공

- `trunkTibiaAngle`
  - 정의: `abs(spine - tibia)`
  - 목적: trunk-only 해석 오류 감소

- `heelContact`
  - 정의: `HEEL`과 `FOOT_INDEX`를 사용한 뒤꿈치 접지 bool
  - 목적: “발/뒤꿈치 접지 유지” 규칙 활성화

- `hipBelowKnee`
  - 정의: 하단 구간에서 hip midpoint가 knee midpoint보다 충분히 아래인지 여부
  - 목적: 평행 이상 깊이 보조 판정

#### 구현 원칙

- 모두 `pose-engine.js`가 raw signal producer로 계산한다.
- `session-controller.js`와 `squat-exercise.js`는 계산된 signal만 소비한다.
- fallback 계산은 최소화한다. “있으면 쓰고 없으면 추정” 대신, 가능한 한 `pose-engine`에서 한 번만 정의한다.

### 6.3 `kneeAlignment`의 의미를 정리하고 SIDE 플랜에서 역할 축소

#### 변경 원칙

- `kneeAlignment`는 더 이상 “knee-over-toe”로 설명하지 않는다.
- 의미를 `frontal-plane knee tracking proxy` 또는 `knee tracks with foot line proxy`로 제한한다.
- `SIDE` view에서는 `kneeAlignment`를 핵심 채점 축으로 사용하지 않는다.
- `FRONT` view에서는 `kneeValgus`와 함께 정렬 보조 축으로 유지한다.

#### 기대 효과

- 코드 주석, 피드백 문구, 계산식 간 의미 일치
- 측면 채점에서 잘못된 좌표축 신호를 과신하지 않음

### 6.4 직접 측정 불가능한 `lumbar_angle`은 이번 패치에서 비활성

#### 결정

- 이번 패치에서는 `lumbar_angle`을 **활성 채점 메트릭에서 제거**한다.
- `neutral spine` 자체는 계속 중요 규칙으로 유지하되, 현재 landmark 세트만으로 직접 측정 가능한 것으로 가장하지 않는다.
- 대신 다음 조합으로 우회적으로 통제한다.
  - `spineAngle`
  - `trunkTibiaAngle`
  - `heelContact`
  - `hipBelowKnee`

#### 이유

- 현재 구조에서 `lumbarAngle`는 실제 raw signal이 없고, 추정 근거도 약하다.
- 신뢰할 수 없는 규칙을 점수화하는 것보다, 이번 패치에서는 제거하는 편이 정확하다.

### 6.5 깊이 규칙은 `parallel-or-below + control maintained` 원칙으로 유지

#### 변경 원칙

- hard fail은 계속 `depth_not_reached` 중심으로 둔다.
- `hipBelowKnee`와 `bottomKnee`를 함께 사용해 평행 이상 깊이를 판정한다.
- 깊어졌다는 이유만으로 감점하지 않는다.
- 대신 다음 통제 실패가 동반되면 soft fail 또는 피드백을 준다.
  - 뒤꿈치 접지 상실
  - 과도한 trunk-tibia 불균형
  - 과도한 frontal knee collapse

#### UX 문구 변경

- `depth` 관련 기본 피드백에서 “너무 깊습니다”는 제거한다.
- 깊이 피드백은 `더 깊이 앉아주세요` 중심으로 단순화한다.

---

## 7. 파일별 변경안

### 7.1 `public/js/workout/scoring-engine.js`

- `evaluateQualityGate()`에 `selectedView` 우선 규칙 추가
- `allowedViews`는 fallback 용도로만 사용
- `knee_over_toe` 관련 기본 피드백 문구 제거 또는 축소
- 테스트 가능한 순수 함수 경로 유지

### 7.2 `public/js/workout/session-controller.js`

- gate context에 넘기는 `selectedView` 의미를 주석으로 명확화
- `buildGateInputsFromPoseData()`가 스쿼트용 raw signal을 덮어쓰지 않도록 유지
- 현재처럼 quality gate authority는 `scoring-engine.js`에만 둠

### 7.3 `public/js/workout/pose-engine.js`

- `tibia` 계산 추가
- `heelContact` 계산 추가
- `hipBelowKnee` 계산 추가
- 필요한 경우 `kneeAlignment` 주석/함수명 수준 의미 정리
- `lumbarAngle`는 추가하지 않음

### 7.4 `public/js/workout/exercises/squat-exercise.js`

- SIDE metric plan에서 dead metric 제거
- `lumbar_angle`를 metric plan과 feedback priority에서 제거
- `kneeAlignment` 사용 범위를 FRONT 보조 지표 위주로 정리
- `depth_not_reached` 판정은 `bottomKnee + hipBelowKnee` 조합 유지
- 피드백 문구에서 측정 불가능하거나 과장된 항목 제거

### 7.5 테스트

#### `test/workout/quality-gate.test.js`

- `allowedViews`와 `selectedView`가 다를 때 `selectedView`가 우선되는지 검증
- 스쿼트 세션에서 `selectedView=FRONT`, `estimatedView=SIDE`이면 `view_mismatch`가 나는지 검증

#### 신규 스쿼트 테스트

- `pose-engine` 또는 순수 helper 수준에서 `heelContact`, `hipBelowKnee`, `tibia` 계산 검증
- `squat-exercise`가 `lumbar_angle` 없이도 rep scoring 가능한지 검증
- `FRONT` plan이 `kneeValgus/kneeAlignment`를 우선하고 `SIDE` plan이 `depth/hip/trunk-tibia`를 우선하는지 검증
- 깊이는 충분하지만 view가 틀린 경우, hard fail이 아니라 gate withhold로 빠지는지 검증

---

## 8. 구현 순서

1. `scoring-engine.js`
   - `selectedView` enforcement 추가
   - gate 테스트 먼저 고정

2. `pose-engine.js`
   - `tibia`, `heelContact`, `hipBelowKnee` 추가
   - 단위 helper 또는 계산 테스트 작성

3. `squat-exercise.js`
   - dead metric 제거
   - metric plan / feedback 정리
   - rep scoring 테스트 작성

4. `session-controller.js`
   - 문맥 정리 및 회귀 점검

5. 전체 테스트
   - `node --test`

---

## 9. 수용 기준

다음 조건을 모두 만족하면 완료로 본다.

1. 사용자가 `FRONT`를 선택하고 실제 pose view가 `SIDE`이면 채점이 진행되지 않는다.
2. `SIDE` view 스쿼트는 `depth`, `hip`, `spine`, `trunk-tibia`, `heelContact` 중심으로 점수화된다.
3. `FRONT` view 스쿼트는 `kneeValgus`, `kneeAlignment`, `symmetry` 중심으로 점수화된다.
4. `heelContact`, `hipBelowKnee`, `tibia`는 런타임 signal로 실제 채워진다.
5. `lumbar_angle`는 더 이상 활성 rep scoring 경로에서 사용되지 않는다.
6. 스쿼트 관련 테스트가 `selectedView mismatch`, `missing signals`, `view-aware metric plan`을 포착한다.

---

## 10. 비목표 및 유예 항목

다음은 이번 패치에서 다루지 않는다.

- stance width 직접 측정 및 개인별 추천
- toe-out 각도 개인화
- 바벨 위치/바벨 경로 평가
- 호흡, 템포, Valsalva 같은 고급 코칭 큐
- lumbar neutral 직접 추정용 신규 landmark 또는 모델 교체

이 항목들은 다음 단계에서 별도 스펙으로 분리한다.

---

## 11. 참고 근거

- NSCA Basics of Strength and Conditioning manual  
  https://www.nsca.com/contentassets/116c55d64e1343d2b264e05aaf158a91/basics_of_strength_and_conditioning_manual.pdf

- Myer et al., The Back Squat: A Proposed Assessment of Functional Deficits and Technical Factors That Limit Performance  
  https://www.backfitpro.com/medical-scientific-articles/2014/%5B33%5DMyer%2CG.D.%282014%29The-back-squat-a-proposed-assessment-of-functional-deficits%5BJ.Strength-and-Cond.%5D.pdf

- Comfort et al., Optimizing Squat Technique—Revisited  
  https://journals.lww.com/nsca-scj/fulltext/2018/12000/optimizing_squat_technique_revisited.10.aspx

- Straub & Powers, A Biomechanical Review of the Squat Exercise: Implications for Clinical Practice  
  https://rcastoragev2.blob.core.windows.net/dc2594d143c119cd3c8cb0d8b426c881/ijspt_2024_19_4_94600.PMC10987311.pdf

- Lorenzetti et al., How to squat? Effects of various stance widths, foot placement angles and level of experience on knee, hip and trunk motion and loading  
  https://pmc.ncbi.nlm.nih.gov/articles/PMC6050697/
