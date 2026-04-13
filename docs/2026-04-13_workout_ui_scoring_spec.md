# Workout UI 대개편 및 AI 평가 엔진 정규화 계획서 (Spec)

## 1. 문서 정보

- 문서명: Workout 페이지 모던 UX 개편 및 모션 인체역학 기준 안정화 명세서
- 작성일자: 2026-04-13
- 대상 프로젝트: FitPlus 웹캠 기반 AI 운동 코칭 서비스
- 문서 목적: 답답했던 카메라 UI 제약을 허물고 운동 중 완전히 몰입할 수 있는 환경을 구축하며, 실제 인체 역학에 위배되던 Squat 자세 평가 엔진의 오류를 수정하여 정확한 코칭을 제공한다.
- 문서 범위: Workout 페이지 Layout, MediaPipe Pose 시각화 처리 모듈, Squat Exercise Rule 템플릿 로직.

---

## 2. 배경 및 문제 정의

현재 FitPlus 워크아웃 시스템은 스쿼트 등의 자세 판정 시 인체 역학을 반영하지 않은 가혹한 제한(예: 깊이 앉아도 상체를 세우도록 강제)과 UI 공간 낭비로 인해 사용자들에게 혼동과 시각적 피로를 유발했다. 주요 한계는 다음과 같다.

1. **시각적 제약 (답답한 카메라 뷰)**
   - `max-height: 65vh`, `max-width: 800px` 로 카메라 캔버스를 제한하고 있어, 화면이 큰 모니터라도 꽉 찬 뷰를 주지 못했다.
   - 운동 전 사용하는 "입력 소스", "채점 자세", "목표 시간" 등의 버튼 UI 공간 낭비로 인해, 운동 중에도 카메라 프레임이 수직/수평으로 강제 제약됨.
2. **시각 폭력 (MediaPipe 거미줄 현상)**
   - 스쿼트, 플랭크 등을 수행할 땐 발바닥이나 손가락 관절까지 분석할 필요가 없음에도 말단 노드(17~22, 29~32번)까지 모두 화면에 초록색 뼈대로 랜더링되어 지저분해 보임.
3. **비정상적 스쿼트 각도 채점 (인체 역학 무시)**
   - 측면 기준 힙 힌지(Hip angle) 허용 각도가 95~135도로 강제되어 있어, 무게 중심을 유지하기 위해 올바르게 접는 풀 스쿼트 시 무조건 경고점수가 뜸. 게다가 "가슴을 세워달라"가 아닌 "엉덩이를 뒤로 빼라"는 정반대의 조언을 남발함.
   - 측면 기준 상체 기울기 최대 허용각이 25도로 묶여, 허벅지가 긴 사용자 등 자연스럽게 상체가 숙여지는 경우 만점을 결코 받을 수 없음.

---

## 3. 목표

### 3.1 핵심 목표
- Workout 카메라 뷰를 뷰포트에 맞게 100% 꽉 채우도록 Layout 유연화.
- "운동 시작" 시 필요 없어진 셋업 기능 패널을 부드럽게 감추는 애니메이션 적용.
- 불필요한 MediaPipe Landmark 노드 시각화 필터링으로 깔끔함 유지.
- Squat 모델의 관절 각도 기준을 실제 운동 체육학 기반 표준(`풀 스쿼트 기준 상체 40~50도 숙임 정상 허용 등`)에 맞추어 시스템 오류를 수정함.

### 3.2 기대 효과
- 화면에 아무런 방해물 없는 쾌적한 전신 거울 앱 체험을 제공할 수 있다.
- 올바른 자세를 수행하는 사용자가 시스템의 기계적 룰 탓에 불공정한 감점 처리를 당하는 현상을 100% 제거.
- Glassmorphism 스타일 디자인을 통해 프리미엄 피트니스 서비스로서의 브랜드 이미지를 시각적으로 브랜딩.

---

## 4. 비목표 (Non-goals)
이번 단계에서 포함하지 않는 범위는 아래와 같다.
- React나 Vue 등 Front-end 컴포넌트 프레임워크로의 전환.
- 신규 운동 종목의 추가.
- DB Table의 구조 변경.

---

## 5. 요구사항

## 5.1 기능 요구사항

### FR-1. MediaPipe 포즈 렌더링 필터링
- 손목 아랫단(손가락 및 손바닥, 인덱스 17~22)과 발목 아랫단(발가락 및 발바닥, 인덱스 29~32) 랜드마크는 캔버스 렌더러에서 무시해야 한다.

### FR-2. 스쿼트(Squat) Biomechanics 룰 기준 현실화
- 측면 Hip-angle(엉덩이-허리) 기준 하한선을 95도에서 **60도**로 하향 조정하여, 유연하게 골반을 접는 행위를 만점으로 인정해야 한다.
- 측면 Spine-angle(상체 기울기) 기준 상한선을 25도에서 **50도**로 제약을 완화하여 숙여지는 몸통각에 감점을 부과하지 않아야 한다.
- 잘못된 피드백 스트링(Feedback Template)을 올바른 표현으로 역전시켜야 한다.

## 5.2 UI/UX 비기능 요구사항

### NFR-1. 동적 Setup-Panel 애니메이션 레이아웃
- "입력소스", "종목 선택" 버튼 패널들은 `.setup-panel-container` 에 종속되어 세션 준비(`Phase: PREPARING`) 중에만 표시되어야 한다.
- "운동 시작" 버튼이 클릭되는 순간, Transition Effects를 이용해 해당 패널이 숨겨지고 여유 높이가 카메라 섹션으로 즉시 반환(Reflow)되어야 한다.

### NFR-2. Glassmorphism Design
- 사이드 스코어 카드 요소들과 타이머는 `backdrop-filter: blur(16px)`를 사용하여 투명 반투명 유리 계층으로 구현하여 모던 테마를 연출한다.

---

## 6. 시스템 적용 현황 방안

### 수정 모듈 레이어 파악

#### 6.1 UI & Layout (`public/workout.css` & `views/workout/session.ejs`)
- `.setup-panel-container` 클래스 추가 구획
- `.hidden-during-workout` 토글 클래스로 `max-height: 0` 및 `opacity: 0` 등 Transition 제공.
- `.camera-frame` 의 `max-height` 삭제 후 `flex-grow: 1` 할당.

#### 6.2 Controller Script (`session-controller.js`)
- `startWorkout()` 진입 단계에서 Session API HTTP 요청이 성공하면 `setup-panel-container`의 classList에 `.hidden-during-workout` 을 부여한다.
- `finishWorkout()` 실행 시에는 페이지 자체가 결과 창으로 리다이렉트 처리되므로 UI 상태 보존은 추가 구현하지 않는다.

#### 6.3 Scoring Rules (`scoring-engine.js` & `squat-exercise.js`)
- `metric.squat_hip_angle.rule` : `{ ideal_min: 60, ideal_max: 120, acceptable_min: 45, acceptable_max: 140 }`
- `metric.squat_spine_angle.rule` : `{ ideal_min: 0, ideal_max: 50, acceptable_min: 0, acceptable_max: 65 }`
- `hip_angle` 피드백 교정 (`low`: 상체를 너무 숙임 / `high`: 엉덩이를 빼지 앉음)

---

## 7. 로깅 및 추후 계획
- 수집 확인: 스쿼트 시 주황색 경고등 빈도수 저하 및 정확도 향상.
- 계획: 현재처럼 운동별로 기계적인 Rule 사전을 갱신하는 단계가 마무리되었으므로 차기 계획인 "LLM Feature Summarizer" 와 결합 시 불필요한 "자세 경고"를 LLM이 오판하는 부작용을 사전에 차단 완료.
