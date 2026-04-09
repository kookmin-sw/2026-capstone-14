# 2026-04-09 : Phase Dataset Workload Spec

## 1. 문서 목적

이 문서는 2026-04-09 기준으로 논의한 `phase만 ML로 대체하고, 점수화는 rule-based로 유지` 전략과, 이를 위한 현재 코드베이스의 **학습 데이터 수집 workload**를 함께 정리한다.

이번 문서의 초점은 다음 4가지다.

- 스쿼트 `phase detection`만 ML 대상으로 분리한다.
- 기존 `ScoringEngine` 기반 점수화와 피드백 구조는 유지한다.
- 실제 세션에서 학습용 feature frame을 수집한다.
- 사람이 `phase`를 JSON으로 라벨링하고, 곧바로 학습용 export를 뽑을 수 있게 한다.

이 문서는 다음 문서의 후속 문서다.

- `docs/2026-04-07_squat_phase_aware_refactor_spec.md`
- `docs/2026-04-08_session_split_camera_spec.md`
- `docs/2026-04-09-운동_로직_deep_research_결과.md`

---

## 2. 핵심 결정

### 2.1 ML 적용 범위

이번 단계에서 ML이 맡는 범위는 `phase classification`뿐이다.

- 대상: `NEUTRAL`, `DESCENT`, `BOTTOM`, `ASCENT`, `LOCKOUT`
- 비대상: 0~100 최종 점수 직접 회귀
- 유지 대상: rule-based metric scoring, rep summary, 사용자 피드백 문구

즉 현재 방향은 아래와 같다.

```text
ML   = 현재 프레임/구간이 어떤 phase인지 안정적으로 추정
Rule = phase가 정해진 뒤 점수 계산과 설명 가능한 피드백 생성
```

### 2.2 이유

이 방향을 채택한 이유는 다음과 같다.

- 현재 구조에서 가장 취약한 부분은 `delta` 기반 phase 전이다.
- 점수 규칙은 이미 설명 가능하고 운영상 해석이 쉽다.
- `phase` 라벨은 사람이 비교적 명확하게 붙일 수 있다.
- 점수 라벨보다 데이터 수집 난이도가 훨씬 낮다.

### 2.3 이번 단계의 산출물

이번 단계의 목표는 모델 자체가 아니라 **모델을 학습시킬 수 있는 workload**다.

즉 아래가 이번 스펙의 완료 기준이다.

1. 세션 중 frame-level feature를 수집한다.
2. 세션 종료 후 결과 페이지에서 사람이 phase JSON을 붙인다.
3. 서버가 해당 라벨을 세션 detail에 저장한다.
4. 학습용 JSON export를 다운로드할 수 있다.

---

## 3. 범위와 비범위

### 3.1 이번 문서 범위

- 스쿼트 세션 중 `phase_dataset.feature_frames` 수집
- 사람이 작성한 phase JSON 저장
- 학습용 JSON export API 제공
- 브라우저/스크립트 레벨 보조 유틸 제공
- 데이터 정규화 및 테스트 추가

### 3.2 이번 문서 비범위

- 실제 ML 모델 학습 코드
- train/validation split 자동화
- ONNX/TensorFlow.js 추론 연결
- 기존 rule-based scoring 제거
- 운동 전반에 대한 범용 phase 모델 설계

---

## 4. 현재 아키텍처 요약

현재 phase dataset 흐름은 아래와 같다.

```text
PoseEngine / ScoringEngine / RepCounter
    -> session-controller.js 가 frame sample 생성
    -> session-buffer.js 가 feature frame 누적
    -> endWorkoutSession 시 detail.phase_dataset 저장
    -> result.ejs 에서 사람이 phase JSON 입력
    -> POST /api/workout/session/:sessionId/phase-labels
    -> GET /api/workout/session/:sessionId/phase-dataset
    -> 학습용 JSON 다운로드
```

핵심 파일 역할은 다음과 같다.

- `public/js/workout/session-controller.js`
  세션 중 frame sample 생성, 실시간 phase 관련 값 수집
- `public/js/workout/session-buffer.js`
  feature frame 버퍼링, 세션 종료 payload에 `detail.phase_dataset` 포함
- `utils/phase-dataset.js`
  서버측 dataset 정규화, 라벨 병합, export 생성
- `controllers/workout.js`
  세션 저장 시 dataset 정리, 라벨 저장 API, export API 제공
- `routes/workout.js`
  phase dataset 관련 API 라우팅
- `views/workout/result.ejs`
  라벨 JSON 입력, 저장, 다운로드 UI
- `public/js/workout/phase-dataset-utils.js`
  브라우저/스크립트에서 label payload를 합치는 보조 유틸
- `scripts/build-phase-training-data.js`
  raw dataset과 labels JSON을 합쳐 offline export 생성

---

## 5. 세션 수집 스펙

### 5.1 수집 시점

frame sample은 운동 세션 중 `handlePoseDetected()` 흐름에서 수집한다.

- frame gate 미통과 프레임도 sample로 남긴다.
- 단, 점수 계산과 피드백은 gate 결과를 따른다.
- sample은 일정 주기(`sample_ms`)로 downsampling 되어 저장된다.

### 5.2 수집 필드

각 frame sample은 아래 정보를 담는다.

- `exercise_code`
- `rep_state`
- `rule_phase`
- `view`
- `angle_source`
- `current_score`
- `quality_score`
- `quality_level`
- `tracked_joint_ratio`
- `in_frame_ratio`
- `bottom_reached`
- `ascent_started`

`features` 하위에는 아래 수치가 들어간다.

- `primary_angle`
- `knee_angle`
- `hip_angle`
- `spine_angle`
- `left_knee`
- `right_knee`
- `knee_symmetry`
- `knee_alignment`

### 5.3 샘플링 기본값

- 기본 샘플 간격: `200ms`
- 최대 feature frame 수: `6000`
- 최대 라벨 수: `6000`

즉 현재 설계는 실시간 모든 프레임 원본이 아니라, **학습에 필요한 요약 feature 시계열**을 저장하는 방식이다.

---

## 6. 저장 포맷

세션 종료 시 `workout_session.detail.phase_dataset`에 아래 구조로 저장한다.

```json
{
  "schema_version": 1,
  "sample_ms": 200,
  "exercise_code": "squat",
  "phase_set": ["NEUTRAL", "DESCENT", "BOTTOM", "ASCENT", "LOCKOUT"],
  "feature_frames": [],
  "labels": [],
  "labeling_status": "pending",
  "capture_meta": {
    "source": "session_capture",
    "frame_count": 0,
    "labeled_frame_count": 0,
    "collected_at": "2026-04-09T00:00:00.000Z"
  }
}
```

정규화 규칙은 다음과 같다.

- phase enum은 대문자 표준값으로 강제한다.
- exercise code는 lower snake case로 정규화한다.
- 숫자값은 반올림한다.
- 잘못된 객체나 범위 밖 데이터는 버린다.
- 과거 키 `ml_phase_dataset`가 존재하면 `phase_dataset`으로 흡수한다.

---

## 7. 사람 라벨링 스펙

### 7.1 입력 위치

사람 라벨링은 세션 화면이 아니라 **운동 결과 페이지**에서 처리한다.

이 결정을 유지한 이유는 다음과 같다.

- 세션 중 UI 복잡도를 높이지 않는다.
- 실제 운동 흐름을 끊지 않는다.
- 한 세션이 끝난 뒤 결과를 보고 라벨링하는 것이 운영상 단순하다.

### 7.2 지원 입력 형식

아래 형태를 지원한다.

```json
[
  { "frame_index": 12, "phase": "BOTTOM" }
]
```

```json
{
  "labels": [
    { "frame_index": 12, "phase": "BOTTOM" }
  ]
}
```

보조 유틸에서는 segment 기반 형식도 지원한다.

```json
{
  "segments": [
    { "start_ms": 0, "end_ms": 1200, "phase": "DESCENT" },
    { "start_ms": 1201, "end_ms": 1800, "phase": "BOTTOM" }
  ],
  "labels": [
    { "frame_index": 10, "phase": "ASCENT" }
  ]
}
```

### 7.3 병합 규칙

- `frame_index`가 있으면 해당 frame에 직접 라벨을 붙인다.
- `timestamp_ms`만 있으면 가장 가까운 frame에 매핑한다.
- segment 라벨은 범위에 포함된 frame에 일괄 적용한다.
- 같은 frame에 중복 라벨이 들어오면 마지막 병합 결과 기준으로 1개만 유지한다.
- 사람이 붙인 라벨은 export 시 `human_phase`로 들어간다.

---

## 8. API 스펙

### 8.1 `GET /api/workout/session/:sessionId/phase-dataset`

목적:

- 세션 detail에 저장된 phase dataset을 학습용 export 형식으로 반환한다.

응답 개요:

- `schema_version`
- `session_id`
- `exercise_code`
- `sample_ms`
- `phase_set`
- `summary`
- `labels`
- `samples`

여기서 `samples[*]`는 `rule_phase`와 `human_phase`를 함께 가진다.

### 8.2 `POST /api/workout/session/:sessionId/phase-labels`

목적:

- 사람이 작성한 phase JSON을 세션 detail에 저장한다.

동작:

- 요청 payload를 정규화한다.
- 기존 `detail.phase_dataset.feature_frames`에 맞춰 라벨을 병합한다.
- `labeling_status`, `labeled_frame_count`, `label_updated_at`를 갱신한다.

오류 조건:

- 세션이 없거나 사용자 소유가 아님
- 세션에 `phase_dataset.feature_frames`가 없음
- payload가 유효한 phase 라벨로 해석되지 않음

---

## 9. 결과 페이지 UX

결과 페이지는 아래 기능을 제공한다.

- 현재 세션의 frame 수 / 라벨 수 표시
- 라벨 JSON textarea
- 로컬 JSON 파일 불러오기
- 라벨 저장 버튼
- 학습 JSON 다운로드 버튼

다운로드되는 파일은 다음 목적에 바로 사용할 수 있다.

- 수동 품질 검수
- 오프라인 통합 데이터셋 생성
- phase classifier 학습 입력

---

## 10. 오프라인 보조 도구

### 10.1 브라우저/공용 유틸

`public/js/workout/phase-dataset-utils.js`는 다음 함수를 제공한다.

- `normalizeLabelPayload`
- `labelPhaseDataset`
- `buildTrainingExport`

이 유틸은 브라우저에서도 쓸 수 있고, Node 스크립트에서도 그대로 재사용할 수 있다.

### 10.2 CLI 스크립트

`scripts/build-phase-training-data.js`는 아래 용도로 사용한다.

- raw session JSON
- 사람이 만든 labels JSON

를 합쳐 최종 학습용 export를 만든다.

예시는 다음과 같다.

```bash
node scripts/build-phase-training-data.js \
  --session raw-session.json \
  --labels labels.json \
  --output merged.json
```

---

## 11. 테스트 및 검증 범위

현재 자동 테스트는 아래를 포함한다.

- `tests/phase-dataset.test.js`
  서버측 정규화, 라벨 병합, export 검증
- `tests/phase-dataset-utils.test.js`
  브라우저/스크립트 유틸의 segment/label merge 검증

현재 `package.json`의 테스트 스크립트는 다음과 같다.

```bash
npm test
```

수동 검증이 여전히 필요한 항목은 다음과 같다.

1. 실제 브라우저에서 스쿼트 세션 수행
2. 세션 종료 후 결과 페이지 진입
3. JSON 붙여넣기 또는 업로드
4. 라벨 저장 API 정상 동작 확인
5. 다운로드된 export JSON으로 학습 파이프라인 입력 확인

---

## 12. 이번 단계에서 확보한 것

이번 단계로 확보한 것은 다음과 같다.

- phase 추정 오류를 ML로 대체할 수 있는 최소 데이터 수집 경로
- rule phase와 human phase를 같은 샘플에 나란히 두는 학습 포맷
- 기존 scoring engine을 깨지 않고 hybrid 구조로 진화할 수 있는 기반
- 라벨링과 export를 세션 결과 화면에 붙인 운영 가능한 workflow

즉 현재 상태는 아래와 같이 정리할 수 있다.

```text
운영 채점은 그대로 사용
    +
phase 학습용 dataset을 세션 단위로 누적
    +
사람 라벨을 붙여 supervised learning 데이터셋으로 export
```

---

## 13. 남은 공백과 다음 단계

현재 남은 공백은 다음과 같다.

- 여러 세션 export를 합쳐 train/validation/test split 하는 파이프라인
- baseline ML 모델 학습 코드
- phase 예측 결과를 런타임에 다시 주입하는 shadow mode
- phase classifier와 rule-based scoring의 hybrid inference 연결
- 스쿼트 외 운동으로의 확장

추천 다음 단계는 아래 순서다.

1. `phase_dataset` export 여러 개를 묶는 dataset builder 추가
2. baseline `GRU` 또는 `TCN` 학습 코드 추가
3. offline 평가 지표 정의
4. 브라우저 런타임에는 우선 `shadow mode`로 rule phase와 ML phase를 함께 기록
5. 충분한 검증 후 `detectPhase()`를 ML 결과로 대체

---

## 14. 관련 파일

- `controllers/workout.js`
- `routes/workout.js`
- `utils/phase-dataset.js`
- `public/js/workout/session-controller.js`
- `public/js/workout/session-buffer.js`
- `public/js/workout/phase-dataset-utils.js`
- `views/workout/result.ejs`
- `tests/phase-dataset.test.js`
- `tests/phase-dataset-utils.test.js`
- `scripts/build-phase-training-data.js`
