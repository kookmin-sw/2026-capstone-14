# 2026-04-09 : Rule-Based First Workout Spec

## 1. 문서 목적

이 문서는 현재 시점의 실제 개발 우선순위를 다시 고정하기 위한 기준 문서다.

핵심 방향은 다음 한 줄이다.

```text
지금은 ML을 배제하고, rule-based 운동 완성과 운동 확장에 집중한다.
```

이 문서는 다음 문서들을 현재 기준에서 다시 정리한다.

- `docs/2026-03-27_rule_based_scoring_refactor_spec.md`
- `docs/2026-04-07_squat_phase_aware_refactor_spec.md`
- `docs/2026-04-09_phase_dataset_workload_spec.md`

---

## 2. 현재 핵심 결정

### 2.1 ML 우선순위 조정

현재 단계에서는 ML 관련 구현을 진행하지 않는다.

- phase classifier 학습 데이터 수집 중단
- 수동 라벨 저장 기능 중단
- 학습용 export 기능 중단
- runtime에 ML 추론 연결 작업 중단

즉 지금 기준은 아래와 같다.

```text
Rule = 현재 운영 기준이자 개발 우선순위
ML   = 문서로만 보존하고, 구현은 이후 단계로 연기
```

### 2.2 이유

이번 우선순위 조정의 이유는 다음과 같다.

- 현재 제품 단계에서 가장 중요한 것은 운동 로직 안정화다.
- ML 데이터 수집, 라벨링, export 흐름이 코드와 UX를 불필요하게 복잡하게 만든다.
- 아직 운동 종목 확장보다 ML 준비가 앞서는 상태는 개발 효율이 낮다.
- rule-based만으로도 스쿼트 품질 개선과 다른 운동 추가를 더 빠르게 진행할 수 있다.

---

## 3. 이번 단계 목표

이번 단계 목표는 ML 준비가 아니라 **운영 가능한 rule-based 운동 시스템 확장**이다.

완료 기준은 아래와 같다.

1. 세션 흐름이 ML 관련 분기 없이 단순하게 동작한다.
2. 결과 페이지는 운영 기능만 보여준다.
3. 운동별 모듈 구조를 유지하면서 새 운동을 추가할 수 있다.
4. rule-based score, feedback, rep tracking 품질을 우선 개선한다.

---

## 4. 현재 범위

### 4.1 포함 범위

- `PoseEngine`, `ScoringEngine`, `RepCounter` 기반의 rule-based 운동 처리
- 운동별 모듈 추가
- view/quality gate 개선
- rep 판정 안정화
- 결과 점수 및 피드백 개선

### 4.2 제외 범위

- phase dataset 수집
- phase label 저장 API
- 학습용 JSON export
- 세션 결과 페이지의 ML 관련 UI
- offline dataset builder
- baseline ML 모델 학습 코드

---

## 5. 구현 원칙

### 5.1 rule-based 우선

운동 품질 판단은 당분간 명시적인 규칙 기반으로 유지한다.

- 각도
- 정렬
- 좌우 대칭
- 가동 범위
- view 적합성
- 프레임 품질

위 항목을 조합해 실시간 피드백과 rep 점수를 계산한다.

### 5.2 exercise module 중심 확장

새 운동은 공용 엔진에 하드코딩하지 않고 운동 모듈로 추가한다.

현재 방향은 다음과 같다.

- 공용 엔진은 입력 처리와 공통 흐름 담당
- 운동별 phase/rep/feedback 기준은 운동 모듈 담당
- 새 운동 추가 시 영향 범위를 해당 운동 모듈 중심으로 제한

### 5.3 설명 가능성 유지

운영 로직은 사용자가 이해할 수 있어야 한다.

- 왜 점수가 깎였는지 설명 가능해야 한다.
- 어떤 자세를 고치면 되는지 피드백으로 연결돼야 한다.
- 디버깅 시 어느 규칙이 발동했는지 추적 가능해야 한다.

---

## 6. 현재 코드 기준 구조

현재 활성 구조는 아래와 같다.

```text
PoseEngine
    -> view / quality / angle 계산
ScoringEngine
    -> frame-level rule score 계산
RepCounter
    -> 운동별 rep 상태 추적
exercise module
    -> 운동 특화 phase / rep / feedback 규칙 담당
SessionBuffer
    -> 점수, rep, 세트, 이벤트 저장
result page
    -> 운영 결과만 노출
```

핵심 파일은 다음과 같다.

- `public/js/workout/pose-engine.js`
- `public/js/workout/scoring-engine.js`
- `public/js/workout/rep-counter.js`
- `public/js/workout/session-controller.js`
- `public/js/workout/session-buffer.js`
- `public/js/workout/exercise-registry.js`
- `public/js/workout/exercises/squat-exercise.js`
- `views/workout/session.ejs`
- `views/workout/result.ejs`

---

## 7. 현재 정리된 사항

현재 단계에서 ML 관련 활성 구현은 제외한다.

- 세션 중 frame-level phase dataset 수집 없음
- 결과 페이지 라벨링 UI 없음
- phase label 저장 API 없음
- phase dataset export API 없음

기존 ML 관련 문서는 삭제하지 않고 참고용으로만 남긴다.

---

## 8. 다음 개발 우선순위

권장 순서는 다음과 같다.

1. 스쿼트 rule-based 정확도와 안정성 보강
2. exercise module 패턴 정리
3. 푸쉬업 `SIDE only`, `phase-aware` 1차 구현
4. 새 운동 1개씩 추가
5. 운동별 feedback 문구와 임계값 조정
6. 수동 테스트 루틴 정리

푸쉬업 1차 상세 기준은 `docs/2026-04-09_pushup_side_only_phase_aware_spec.md`를 따른다.

새 운동 추가 시 체크리스트는 아래와 같다.

1. 운동 코드 등록
2. allowed view 정의
3. rep 시작/진행/완료 조건 정의
4. 핵심 metric과 임계값 정의
5. 실시간 피드백 정의
6. 결과 점수 검증

---

## 9. 운동 추가 기준

새 운동은 아래 조건을 만족할 때 우선 추가한다.

- 카메라 한 대로 관찰 가능
- 핵심 각도나 정렬 기준을 명확히 정의 가능
- rep 시작/종료를 규칙으로 잡기 쉬움
- 사용자가 피드백을 바로 이해할 수 있음

후보 예시는 다음과 같다.

- 런지
- 푸시업
- 숄더 프레스
- 플랭크 기반 시간 운동

---

## 10. 테스트 방향

자동 테스트가 부족한 상태이므로 당분간 아래 수동 검증을 기본으로 한다.

1. 운동 시작/일시정지/종료 정상 동작
2. rep 카운팅 정상 동작
3. 세트 진행 정상 동작
4. 실시간 피드백 문구 확인
5. 결과 페이지 점수/횟수/시간 확인
6. 루틴 step 전환 확인

가능하면 이후 운동 모듈 단위 테스트를 보강한다.

---

## 11. 향후 ML 재검토 조건

ML은 완전히 폐기하는 것이 아니라, 아래 조건이 충족될 때 다시 검토한다.

1. 스쿼트 rule-based 로직이 충분히 안정화됨
2. 최소 2개 이상 운동이 같은 모듈 구조로 운영됨
3. 어떤 오차가 rule-based의 구조적 한계인지 명확히 확인됨
4. 데이터 스키마와 라벨링 기준이 다시 합의됨

즉 ML은 지금 당장 구현 대상이 아니라, rule-based 한계가 명확해진 뒤의 후속 과제다.

---

## 12. 최종 정리

현재 방향은 아래처럼 정리한다.

```text
지금은 rule-based 운동 엔진을 먼저 완성한다.
ML은 문서로만 유지하고 구현 우선순위에서는 뺀다.
새 운동은 exercise module 구조로 차근차근 확장한다.
```
