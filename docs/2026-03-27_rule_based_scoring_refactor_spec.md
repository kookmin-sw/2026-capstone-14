# 2026-03-27 : FitPlus Rule-Based 자세 평가 개편 스펙

## 1. 문서 목적

이 문서는 FitPlus의 현재 운동 자세 평가 로직을 더 정교한 rule-based 시스템으로 개편하기 위한 설계 초안을 정의한다.

현재 시스템은 MediaPipe Pose에서 얻은 랜드마크와 각도 정보를 기반으로 실시간 점수를 계산하고 있으나, 프레임 단위 각도 판정 중심 구조로 인해 실제 사용자 환경에서 다음 문제가 발생할 수 있다.

- 카메라 시야와 거리 변화에 민감하다.
- 사람마다 체형이 달라도 동일한 절대 기준으로 평가한다.
- 한 프레임의 순간 오차가 과도한 감점으로 이어질 수 있다.
- 운동 동작 전체의 흐름보다 순간 자세에 치우친 평가를 한다.
- 스쿼트/푸시업/런지처럼 운동마다 중요한 구간이 다른데 이를 충분히 반영하지 못한다.

본 개편은 ML 도입 이전 단계에서 rule-based 엔진만으로 정확도, 안정성, 설명 가능성을 높이는 것을 목표로 한다.

---

## 2. 범위

### 포함 범위

- 브라우저 내 실시간 자세 점수 계산 로직 개편
- rep 단위 요약 점수 설계
- 운동 phase 기반 평가 구조 도입
- view(정면/측면 등)별 rule 분리
- confidence 기반 평가 보류/가중치 조정
- 사용자 피드백 메시지 생성 규칙 개선
- 향후 ML 보강을 고려한 출력 데이터 구조 정의

### 제외 범위

- Python 기반 학습 파이프라인 구현
- 모델 학습/서빙 인프라 구축
- DB 스키마 확정 마이그레이션
- 관리자 화면 전체 UX 재설계

---

## 3. 현행 구조 요약

현재 관련 핵심 파일은 다음과 같다.

- `public/js/workout/pose-engine.js`: 랜드마크 추출, 각도 계산, 시야 정보 제공
- `public/js/workout/scoring-engine.js`: metric별 점수 계산, 피드백 생성
- `public/js/workout/rep-counter.js`: 반복 운동의 상태 전이 및 rep 완료 판정
- `public/js/workout/session-buffer.js`: 세션 중 점수/rep/event 수집
- `views/workout/session.ejs`: 실시간 표시와 클라이언트 상태 관리

현재 점수 계산의 중심은 metric 단위 `ideal range` 비교다. 이 구조는 단순하고 설명 가능하지만, 동작 단계와 시간 축을 충분히 반영하지 못한다.

---

## 4. 개편 목표

### 핵심 목표

- 프레임 단위 채점에서 rep 단위 평가로 중심을 이동한다.
- 운동별로 다른 생체역학적 기준을 반영한다.
- 순간 노이즈에 강한 점수 체계를 만든다.
- 왜 감점되었는지 사용자에게 설명 가능한 구조를 유지한다.
- 향후 ML 점수와 결합 가능한 중간 산출물을 남긴다.

### 성공 조건

- 동일한 자세를 연속 수행할 때 점수 변동 폭이 줄어든다.
- 잘못된 프레임 1~2개 때문에 rep 전체가 과도하게 감점되지 않는다.
- 운동별 핵심 자세 오류가 더 일관되게 탐지된다.
- 사용자에게 제공되는 피드백이 더 구체적이고 맥락적이다.

---

## 5. 설계 원칙

### 5.1 Rule-based 중심 유지

- 실시간성, 설명 가능성, 디버깅 용이성을 위해 핵심 평가 엔진은 rule-based로 유지한다.
- ML은 이후 보강 수단으로 붙일 수 있게 하되 이번 단계에서는 의존하지 않는다.

### 5.2 운동별 맞춤 규칙

- 모든 운동을 동일한 scoring 로직으로 처리하지 않는다.
- 스쿼트, 푸시업, 런지, 플랭크는 서로 다른 phase, 핵심 지표, 감점 규칙을 가진다.

### 5.3 Phase 기반 평가

- 한 프레임의 이상치보다 동작 전체 흐름을 본다.
- 하강, 바닥, 상승 등 phase를 구분하고 phase별로 중요한 조건을 다르게 본다.

### 5.4 Quality Gate 우선

- 랜드마크 품질이 부족한 프레임은 점수 계산에서 제외하거나 비중을 낮춘다.
- 평가 불가 상태를 억지로 감점으로 처리하지 않는다.

### 5.5 Rep 요약값 우선

- 최종 피드백과 저장은 rep 단위 요약값을 중심으로 한다.
- 프레임 점수는 실시간 UI 보조용으로만 사용한다.

---

## 6. 목표 아키텍처

개편 후 브라우저 내 평가 흐름은 아래와 같다.

1. `PoseEngine`이 랜드마크, 각도, view, landmark quality를 계산한다.
2. `ScoringEngine`이 프레임 품질을 검사한다.
3. `RepCounter` 또는 별도 phase tracker가 현재 동작 phase를 판정한다.
4. phase에 맞는 핵심 지표를 누적한다.
5. rep 완료 시 누적된 요약 통계를 기반으로 rep score를 계산한다.
6. 감점 사유를 구조화된 형태로 생성한다.
7. UI에는 실시간 보조 점수와 최근 rep 요약 점수를 표시한다.
8. 세션 종료 시 rep 결과와 metric 요약값을 저장한다.

---

## 7. 평가 단위 재정의

### 7.1 프레임 점수

- 목적: 실시간 화면 표시용
- 성격: 참고용, 저가중치
- 입력: 현재 프레임의 각도/대칭/정렬/quality
- 출력: 즉시 점수, 피드백 후보

### 7.2 Phase 점수

- 목적: 동작 구간별 품질 파악
- 예시: 스쿼트 하강 구간 안정성, 바닥 구간 깊이 유지, 상승 구간 무릎 정렬
- 입력: 해당 phase 동안 누적된 프레임 정보
- 출력: phase별 부분 점수와 감점 사유

### 7.3 Rep 점수

- 목적: 사용자에게 보여줄 실제 동작 점수
- 입력: phase 요약값, 핵심 지표, hard fail 여부
- 출력: 0~100 점수, 대표 오류, confidence

---

## 8. 운동 Phase 모델

### 8.1 기본 개념

반복 운동은 최소한 다음 중 일부 phase를 가진다.

- `NEUTRAL`: 시작/복귀 상태
- `DESCENT`: 내려가는 구간 또는 굽히는 구간
- `BOTTOM`: 최저 지점 또는 유지 구간
- `ASCENT`: 올라오는 구간 또는 펴는 구간
- `LOCKOUT`: 마무리 안정화 구간

### 8.2 운동별 적용 예시

#### 스쿼트

- `NEUTRAL`: 무릎/고관절이 충분히 펴진 상태
- `DESCENT`: 무릎과 고관절 각도가 함께 감소
- `BOTTOM`: 최저 무릎각과 고관절각이 유지되는 구간
- `ASCENT`: 다시 펴지는 구간
- `LOCKOUT`: 서서 안정적으로 종료하는 구간

#### 푸시업

- `NEUTRAL`: 팔이 펴진 plank 상태
- `DESCENT`: 팔꿈치 굴곡 증가 구간
- `BOTTOM`: 최저 팔꿈치각 구간
- `ASCENT`: 다시 밀어올리는 구간
- `LOCKOUT`: 상단에서 몸통 정렬 유지

#### 런지

- `NEUTRAL`: 양발 정렬 준비 상태
- `DESCENT`: 앞무릎 굴곡 증가, 몸 중심 하강
- `BOTTOM`: 최저 지점 유지
- `ASCENT`: 복귀 구간
- `LOCKOUT`: 다음 rep 전 안정 상태

---

## 9. 지표 체계 개편

### 9.1 지표 분류

각 운동의 지표는 다음 계층으로 나눈다.

- 핵심 지표: 동작 성립 자체를 결정하는 요소
- 품질 지표: 좋은 자세 여부를 세밀하게 나누는 요소
- 안정성 지표: 흔들림, 속도, 좌우 편차를 보는 요소
- 보조 지표: feedback 보강용 요소

### 9.2 스쿼트 예시

#### 핵심 지표

- `knee_angle`
- `hip_angle`
- `spine_angle`

#### 품질 지표

- `knee_symmetry`
- `knee_alignment`
- `hip_hinge`

#### 안정성 지표

- 하강 시간
- 상승 시간
- 바닥 유지 시간
- rep 내 점수 분산

### 9.3 푸시업 예시

- 핵심: `elbow_angle`, `spine_angle`
- 품질: `elbow_symmetry`, 어깨 안정성
- 안정성: 하강/상승 템포, 상단 lockout 유지

---

## 10. View 기반 규칙 분리

### 필요성

정면과 측면에서는 신뢰할 수 있는 지표가 다르다.

- 정면: 좌우 대칭, 무릎 정렬, 어깨 기울기
- 측면: 깊이, 몸통 기울기, 힙 힌지, 전후 이동

### 설계

- `PoseEngine`이 추정한 `angles.view`를 기준으로 rule profile을 선택한다.
- view 판정이 불안정할 경우 직전 view를 일정 시간 유지하는 히스테리시스를 둔다.
- view별로 metric weight를 다르게 적용한다.
- 특정 view에서 신뢰도 낮은 metric은 점수 비중을 줄이거나 제외한다.

### 예시

- 측면 스쿼트: `knee_angle`, `hip_angle`, `spine_angle` 가중치 상향
- 정면 스쿼트: `knee_symmetry`, `knee_alignment` 가중치 상향

---

## 11. Confidence와 Quality Gate

### 11.1 프레임 confidence

다음 요소를 기반으로 프레임 품질을 계산한다.

- 주요 랜드마크 visibility
- 좌우 landmark 존재 여부
- 프레임 간 좌표 점프 정도
- view 판정 안정성

### 11.2 처리 방식

- high confidence: 정상 채점
- medium confidence: 점수 반영하되 가중치 축소
- low confidence: 감점에 사용하지 않고 평가 보류 프레임으로 기록

### 11.3 기대 효과

- 랜드마크 흔들림을 자세 오류로 오해하는 문제 감소
- 사용자가 카메라 밖으로 잠깐 벗어났을 때 과도한 감점 방지

---

## 12. 감점 모델

### 12.1 Soft Fail

- ideal 범위를 약간 벗어난 경우
- 점진적 감점
- 사용자에게 교정 가능 메시지 제공

예시:

- 무릎 깊이가 약간 부족함
- 좌우 편차가 조금 큼
- 템포가 다소 불안정함

### 12.2 Hard Fail

- 해당 rep를 좋은 rep로 보기 어려운 경우
- 상한 점수 제한 또는 큰 감점 적용

예시:

- 스쿼트에서 바닥 깊이 미도달
- 푸시업에서 몸통 정렬 붕괴
- phase 자체가 성립하지 않음

### 12.3 No Score

- 품질 부족으로 평가 불가한 경우
- 감점 대신 무효 frame/무효 rep 후보로 처리

---

## 13. 점수 산정 방식

### 13.1 기본 공식

rep 최종 점수는 아래 요소의 조합으로 계산한다.

- phase 점수 합산
- 핵심 지표 minimum guard
- hard fail penalty
- confidence 보정

예시 개념식:

`repScore = clamp((phaseWeightedScore - penalties) * confidenceFactor, 0, 100)`

### 13.2 핵심 원칙

- 평균 점수만으로 끝내지 않는다.
- 최저점, 대표 오류, 특정 phase 실패를 함께 본다.
- 핵심 지표가 무너지면 다른 지표가 좋아도 최고점을 제한한다.

### 13.3 Score Smoothing

- 최근 rep 점수 이동 평균을 보조적으로 사용한다.
- 단, 실제 저장 점수는 원본 rep 점수를 유지한다.
- UI 표시는 필요 시 smoothed score를 별도 사용 가능하다.

---

## 14. 피드백 생성 규칙

### 목표

- 추상적인 “자세를 확인하세요” 대신 구체적인 코칭 문장을 제공한다.
- 대표 오류 1~2개만 우선 노출한다.

### 생성 기준

- 가장 영향이 큰 hard fail 또는 soft fail 우선
- 현재 phase에 맞는 문장 우선
- 동일 메시지 반복은 cooldown 적용

### 예시

- 스쿼트 하강 중: `무릎을 조금 더 굽혀주세요`
- 스쿼트 바닥 구간: `허리가 말리지 않도록 가슴을 들어주세요`
- 정면 시야: `양쪽 무릎 방향을 맞춰주세요`

---

## 15. Rule 데이터 구조 개편 방향

현재 DB의 `scoring_profile_metric.rule`은 metric 단위 rule 중심이다.
개편 이후에는 운동/phase/view 중심 정보를 함께 표현할 수 있어야 한다.

### 목표 구조 개념

```json
{
  "exercise": "squat",
  "view": "SIDE",
  "phases": {
    "DESCENT": {
      "metrics": ["knee_angle", "hip_angle"],
      "weights": {
        "knee_angle": 0.4,
        "hip_angle": 0.3,
        "spine_angle": 0.3
      }
    },
    "BOTTOM": {
      "hard_fail": {
        "knee_angle_min": 100
      }
    }
  }
}
```

### 주의점

- 기존 metric 단위 구조를 바로 폐기하지 않는다.
- 1차 구현은 프런트엔드 내 exercise evaluator 하드코딩으로 시작할 수 있다.
- DB 스키마 확장은 2단계로 미룬다.

---

## 16. 파일별 개편 방향

### `public/js/workout/pose-engine.js`

- landmark visibility 기반 quality 정보 추가
- view 판정 안정화 로직 추가
- 프레임 간 이동량 또는 jitter 지표 제공

### `public/js/workout/rep-counter.js`

- 단순 rep 완료 판정 외에 phase 추적 기능 강화
- rep별 시간 통계와 상태 전이 로그 요약 제공
- rep 완료 시 min/max/avg angle 등 요약값 반환

### `public/js/workout/scoring-engine.js`

- generic metric evaluator와 exercise-specific evaluator 분리
- frame score와 rep score 계산 경로 분리
- confidence, hard fail, phase score 계산 로직 추가

### `public/js/workout/session-buffer.js`

- rep summary, phase summary, confidence 정보를 저장 가능하게 확장
- 향후 ML 학습용 export를 고려한 구조 유지

### `views/workout/session.ejs`

- 실시간 표시값과 최근 rep 요약값 분리
- “평가 보류” 또는 “시야 불안정” 상태 표시 추가

---

## 17. 단계별 구현 계획

### 1단계: 스쿼트 기준 개편

- 스쿼트 전용 phase 모델 정의
- rep summary 구조 도입
- hard fail, confidence, view 분리 적용
- 실시간 피드백 문구 개선

### 2단계: 푸시업/런지 확장

- 운동별 evaluator 추가
- 공통 추상화 정리
- 관리자용 rule 데이터 구조 검토

### 3단계: 저장/분석 기반 강화

- rep summary 저장
- 실패 유형 통계화
- ML 보강을 위한 export 형식 정리

---

## 18. 검증 기준

### 기능 검증

- 정상 rep가 안정적으로 인식되는가
- 동일 자세에서 점수 변동이 과도하지 않은가
- 잘못된 시야/가림 상황에서 무의미한 감점이 줄었는가
- 대표 오류 메시지가 실제 자세 문제와 일치하는가

### 기술 검증

- 프레임 처리 성능이 현재 수준을 크게 해치지 않는가
- 브라우저 메모리 사용량이 과도하게 증가하지 않는가
- 세션 종료 시 요약 데이터가 정상 저장되는가

### 사용자 경험 검증

- 실시간 숫자가 지나치게 흔들리지 않는가
- 피드백이 너무 자주 바뀌지 않는가
- 사용자가 무엇을 고쳐야 할지 이해 가능한가

---

## 19. 리스크

- phase 판정이 불안정하면 전체 평가가 더 복잡해질 수 있다.
- 운동별 규칙이 많아지면 유지보수 비용이 증가한다.
- view 판정 오류가 잘못된 profile 선택으로 이어질 수 있다.
- 지나치게 많은 hard fail은 사용자 경험을 해칠 수 있다.

따라서 1차 구현은 운동 1종목(스쿼트)에서 충분히 검증한 뒤 확장해야 한다.

---

## 20. 향후 ML 연계 포인트

이번 개편은 ML 이전 단계이지만, 다음 산출물은 이후 학습 데이터로 활용 가능하다.

- rep별 핵심 angle 요약값
- phase별 지속 시간
- symmetry/tempo/stability 요약값
- hard fail/soft fail 태그
- confidence 정보

즉, 본 개편은 단순 rule 정교화에 그치지 않고 향후 `rule + ML hybrid` 구조로 이어질 수 있는 기반 작업이다.

---

## 21. 결론

FitPlus의 현재 자세 평가 로직은 방향이 맞지만, 실제 사용자 환경에 더 강한 엔진이 되기 위해서는 다음 전환이 필요하다.

- 프레임 중심에서 rep 중심으로
- 단일 각도 기준에서 phase 기반 복합 규칙으로
- 절대값 중심에서 confidence와 view를 포함한 맥락 기반 평가로

구현 우선순위는 스쿼트 1종목에 대해 phase 기반 rep scoring을 먼저 도입하고, 이후 공통 구조를 정리하며 다른 운동으로 확장하는 방식이 바람직하다.
