# 2026-04-07 : Squat Phase-Aware Refactor Spec

## 1. 문서 목적

이 문서는 2026-04-07 기준으로 진행한 스쿼트 자세 평가 개편 논의와 실제 구현 범위를 함께 정리한다.

이 문서의 초점은 다음 3가지다.

- 스쿼트 자세 평가를 `phase` 중심으로 재정리한다.
- 스쿼트 하드코딩을 공용 엔진 밖으로 분리한다.
- 향후 ML을 붙이기 전에 rule-based 정확도를 먼저 높인다.

이 문서는 다음 기존 문서의 후속 문서다.

- `docs/2026-03-27_rule_based_scoring_refactor_spec.md`
- `docs/2026-04-02_current_scoring_spec.md`

---

## 2. 이번 단계의 핵심 결정

### 2.1 ML 전략

이번 단계에서는 `pure ML`로 바로 가지 않는다.

- 운영 기준은 여전히 `rule-based`다.
- ML은 나중에 `shadow mode -> hybrid` 순서로 붙인다.
- 먼저 스쿼트 rule 정확도와 phase 구조를 안정화한다.

즉 현재 방향은 아래와 같다.

```text
Rule = 기본 판정 + 설명 가능한 피드백 + 안전장치
ML   = 추후 rep-level 품질 보정 및 분류 보조
```

### 2.2 우선순위

이번 작업의 우선순위는 다음과 같이 정했다.

1. 스쿼트 완성
2. 품질이 낮은 입력을 먼저 거르는 quality gate 추가
3. phase별 live 평가 기준 분리
4. 운동별 모듈 분리 구조 도입
5. 이후 push-up, lunge 확장

---

## 3. 해결하려는 문제

기존 구조에서는 아래 문제가 있었다.

- 스쿼트 로직이 `scoring-engine.js`, `rep-counter.js`, `session.ejs`에 분산되어 있었다.
- 프레임 품질이 낮아도 실시간 점수와 피드백이 계속 나갔다.
- 스쿼트 하강 중인데도 `더 굽히세요`, `더 내려가세요` 같은 문구가 뜰 수 있었다.
- 스쿼트는 phase를 추적하고 있었지만, live 피드백은 phase별 기준이 충분히 분리되지 않았다.
- exercise-specific 확장 포인트가 부족해 다른 운동을 추가할 때 공용 파일 수정이 많아질 구조였다.

특히 사용자 관점에서 가장 큰 문제는 아래 한 줄로 요약된다.

```text
내려가는 중에는 내려가는 중에 봐야 할 것만 보고,
바닥에 도달했을 때 깊이/정렬/대칭을 평가해야 한다.
```

---

## 4. 이번 단계 실제 구현 범위

### 4.1 새로 추가한 파일

- `public/js/workout/exercise-registry.js`
- `public/js/workout/exercises/squat-exercise.js`

### 4.2 수정한 파일

- `public/js/workout/pose-engine.js`
- `public/js/workout/scoring-engine.js`
- `public/js/workout/rep-counter.js`
- `views/workout/session.ejs`

### 4.3 구현된 핵심 변경

- 운동별 registry 추가
- 스쿼트 전용 모듈 분리
- 스쿼트 rep tracking을 모듈 위임 구조로 변경
- 스쿼트 rep scoring을 모듈 위임 구조로 변경
- 스쿼트 live feedback 필터를 모듈 위임 구조로 변경
- quality gate 강화
- `/workout/free/squat` 점수 카드에 현재 `PHASE` 디버그 표시 추가

---

## 5. 현재 구조

현재 스쿼트 흐름은 아래와 같다.

1. `PoseEngine`가 각도, view, quality를 계산한다.
2. `ScoringEngine.calculate()`가 프레임 breakdown을 만든다.
3. `RepCounter`가 스쿼트 모듈을 통해 현재 phase를 갱신한다.
4. 스쿼트 모듈이 현재 phase에 맞게 live breakdown을 다시 필터링한다.
5. 진행 중 rep 점수는 phase-aware live score를 누적한다.
6. rep 완료 시 스쿼트 모듈이 rep summary를 기반으로 최종 rep score를 계산한다.

관련 파일 역할은 다음과 같다.

- `exercise-registry.js`: 운동 코드와 운동 모듈 매핑
- `exercises/squat-exercise.js`: 스쿼트 전용 phase/요약/채점/quality gate
- `rep-counter.js`: 공용 rep 상태 관리 + 운동 모듈 위임
- `scoring-engine.js`: 공용 frame scoring + 운동 모듈 위임
- `session.ejs`: 실시간 화면 표시, live score 적용, phase 디버그 표시

---

## 6. 스쿼트 Phase 모델

현재 스쿼트는 다음 phase를 사용한다.

| Phase | 의미 |
| --- | --- |
| `NEUTRAL` | 시작 전 기본 서있는 상태 |
| `DESCENT` | 내려가는 중 |
| `BOTTOM` | 최저점 도달 구간 |
| `ASCENT` | 다시 올라오는 중 |
| `LOCKOUT` | rep 종료 시 완전히 선 상태 |

phase 판정은 `public/js/workout/exercises/squat-exercise.js`의 `detectPhase()`에서 수행한다.

판정에 사용하는 핵심 정보는 다음과 같다.

- 현재 무릎 각도
- 직전 프레임 대비 무릎 각도 변화량
- 힙 각도
- 바닥 근처 안정 프레임 수
- 다시 올라오기 시작했는지 여부

---

## 7. Quality Gate

이번 작업에서 quality는 단순 visibility보다 더 강한 gate 역할을 하도록 보강했다.

### 7.1 Pose quality 확장

`PoseEngine.getFrameQuality()`는 기존 항목 외에 아래 값을 추가 계산한다.

- `trackedJointRatio`
- `inFrameRatio`

현재 quality 계산 요소는 다음 5개다.

- 평균 visibility
- visibility 충족 비율
- 추적 가능한 주요 관절 비율
- 프레임 안에 들어온 주요 관절 비율
- view 안정성

### 7.2 스쿼트 gate 조건

스쿼트 모듈은 아래 조건 중 하나라도 만족하지 않으면 채점을 보류한다.

- `trackedJointRatio < 0.75`
- `inFrameRatio < 0.75`
- `view === UNKNOWN`
- `quality.score < 0.5`

보류 시 동작은 다음과 같다.

- 실시간 시각 피드백 비움
- 점수 카드에 gating 메시지 표시
- 해당 프레임은 스쿼트 평가에 사용하지 않음

---

## 8. 스쿼트 Live 평가 기준

이번 단계에서 가장 중요한 수정은 `phase별 live 평가 기준 분리`다.

이제 live 평가에서는 모든 phase에 같은 metric을 쓰지 않는다.

### 8.1 Phase별 live metric 사용 규칙

| Phase | live 평가 대상 |
| --- | --- |
| `DESCENT` | `hip`, `torso` |
| `BOTTOM` | `depth`, `alignment`, `symmetry`, `torso` |
| `BOTTOM` + `SIDE` | 위 항목에 `hip` 추가 |
| `ASCENT` + `FRONT` | `alignment`, `symmetry`, `torso` |
| `ASCENT` + `SIDE` | `alignment`, `torso` |
| `LOCKOUT` | `torso`만 표시 |

### 8.2 의도

이 규칙의 목적은 아래와 같다.

- `DESCENT`에서는 아직 깊이가 완성되지 않았으므로 depth 피드백을 하지 않는다.
- `BOTTOM`에서 깊이와 무릎 정렬을 본다.
- `ASCENT`에서는 바닥 깊이보다 정렬 유지와 무너짐을 본다.
- `LOCKOUT`에서는 다리 감점보다 마무리 안정성 위주로 본다.

즉 아래와 같은 잘못된 UX를 막는 것이 핵심이다.

```text
하강 중인데 "더 굽히세요" 또는 "더 내려가세요" 피드백이 뜨는 문제
```

### 8.3 live 점수 반영 방식

현재 프레임의 raw breakdown을 먼저 만든 뒤,
phase에 맞지 않는 metric을 제거한 다음,
남은 metric만으로 live score를 다시 계산한다.

그리고 rep 진행 중 점수 누적도 이 phase-aware live score를 기준으로 저장한다.

즉 현재 live score는 단순 raw frame score가 아니라, `현재 phase 기준으로 정리된 score`다.

---

## 9. 스쿼트 Rep 평가 기준

rep 완료 후 최종 점수는 여전히 rep summary 기반으로 계산한다.

현재 rep scoring은 아래 특징을 가진다.

- phase별로 누적한 summary를 사용한다.
- `BOTTOM`, `DESCENT`, `ASCENT`, `LOCKOUT`에서 대표값을 뽑는다.
- view에 따라 최종 metric weight를 다르게 둔다.
- hard fail이 있으면 최종 점수 상한을 제한한다.

현재 사용하는 대표값 예시는 다음과 같다.

- `bottomKnee`: `BOTTOM -> DESCENT -> ASCENT`의 최소 무릎각
- `bottomHip`: `BOTTOM -> DESCENT`의 최소 힙각
- `maxSpine`: `DESCENT -> BOTTOM -> ASCENT`의 최대 상체 기울기
- `kneeAlignment`: FRONT일 때 `BOTTOM -> ASCENT` 중심
- `lockoutKnee`: `LOCKOUT -> ASCENT`의 최대 무릎각

hard fail 예시는 다음과 같다.

- `depth_not_reached`
- `lockout_incomplete`
- `low_confidence`

주의할 점은 다음과 같다.

- 현재 구조는 `phase-aware rep scoring`이다.
- 하지만 아직 `phase별 완전히 독립된 점수표`를 합산하는 수준까지는 가지 않았다.
- 즉 phase별 요약값은 사용하지만, `DESCENT score`, `BOTTOM score`, `ASCENT score`, `LOCKOUT score`를 따로 계산해 최종 조합하는 구조는 아직 아니다.

---

## 10. View 기준

스쿼트는 `SIDE`, `FRONT`, `UNKNOWN` view를 사용한다.

현재 설계 원칙은 아래와 같다.

- `SIDE`: depth, hip hinge, torso 안정성 중심
- `FRONT`: knee alignment, symmetry 중심
- `UNKNOWN`: quality gate에서 보류 우선

이번 단계에서는 view별 metric weight와 live metric 노출 기준을 분리했다.

다만 추후에는 더 명확한 `view-specific coaching`으로 확장할 수 있다.

- SIDE에서는 볼 수 없는 front-only 오류를 과감히 제외
- FRONT에서는 side-only 깊이/힙힌지 판단을 더 보수적으로 처리

---

## 11. UI 디버그 표시

`/workout/free/squat`의 점수 카드 헤더에 현재 phase를 표시하도록 했다.

현재 표시 형식은 다음과 같다.

- `PHASE: DESCENT`
- `PHASE: BOTTOM`
- `PHASE: ASCENT`
- `PHASE: LOCKOUT`
- `PHASE: NEUTRAL`

기존 view/source/quality 디버그 텍스트는 별도 줄로 유지한다.

이 표시는 실제 live phase 전환이 어떻게 되는지 바로 확인하기 위한 디버깅 목적이다.

---

## 12. 이번 단계에서 도입한 모듈화 원칙

운동별 로직은 가능한 공용 엔진에서 분리한다.

현재 스쿼트 모듈이 담당하는 책임은 다음과 같다.

- rep pattern 정의
- frame quality gate
- phase 추적
- rep summary 생성
- rep final scoring
- live breakdown 필터링
- rep metric 누적 기준

공용 엔진 책임은 다음과 같이 유지한다.

- `PoseEngine`: 각도와 quality 산출
- `ScoringEngine`: generic frame scoring
- `RepCounter`: generic rep 상태 관리
- `SessionBuffer`: 세션 데이터 저장

이 구조를 기준으로 이후 `push_up`, `lunge`를 같은 방식으로 확장한다.

---

## 13. 아직 남아 있는 과제

이번 단계에서 해결하지 않은 항목은 다음과 같다.

### 13.1 스쿼트 phase별 최종 점수표 분리

현재는 phase summary를 사용하지만, 완전한 `phase score 합산 구조`는 아니다.

추후 목표 예시는 다음과 같다.

- `DESCENT score`: 하강 안정성, 힙힌지, torso control
- `BOTTOM score`: depth, alignment, symmetry
- `ASCENT score`: 무릎 정렬 유지, 상체 무너짐, 중심 안정성
- `LOCKOUT score`: 완전 신전, 마무리 안정성

### 13.2 대표 오류 taxonomy 고정

스쿼트 대표 오류를 명시적으로 고정할 필요가 있다.

- depth 부족
- 무릎 정렬 문제
- 상체 과전경사
- 좌우 비대칭
- 판정 불가

### 13.3 ML 준비 데이터 구조

ML은 이번 단계에서 구현하지 않았다.

향후에는 아래 순서로 진행한다.

1. 스쿼트 rep 단위 feature와 라벨 저장
2. shadow mode 분류기 도입
3. hybrid 점수 보정 실험

### 13.4 다른 운동 확장

다음 후보 운동은 다음 순서다.

1. `push_up`
2. `lunge`
3. `deadlift`

---

## 14. 결론

이번 단계의 결론은 다음과 같다.

- 스쿼트는 공용 엔진 안의 예외 로직이 아니라 별도 운동 모듈로 분리했다.
- quality gate를 강화해 품질이 낮은 입력은 평가 보류할 수 있게 했다.
- 스쿼트 live 평가는 이제 phase별로 다른 기준을 사용한다.
- 특히 하강 중에 depth 피드백이 뜨는 문제를 방지했다.
- 최종 방향은 `rule-based 중심`, `스쿼트 우선 완성`, `ML은 이후 hybrid 보강`이다.

이 문서는 이후 스쿼트 final phase score 분리와 ML shadow mode 설계의 기준 문서로 사용한다.
