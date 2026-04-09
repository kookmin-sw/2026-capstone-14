# FitPlus 데이터베이스 구조 설명서

이 문서는 FitPlus 서비스에서 사용하는 PostgreSQL 데이터베이스 스키마를 설명합니다.

## 1. 개요 (Overview)

FitPlus 데이터베이스는 크게 **사용자**, **운동 정의(메타데이터)**, **루틴**, **운동 기록(세션)** 의 4가지 영역으로 구성됩니다.

## 2. 상세 테이블 구조

### 2.1 사용자 관리 (User Management)

#### `app_user`
서비스 사용자 정보를 저장합니다.
*   `user_id` (UUID, PK): 고유 식별자.
*   `login_id`: 로그인 아이디 (유니크).
*   `password_hash`: 비밀번호 해시.
*   `nickname`: 사용자 닉네임.
*   `status`: 계정 상태 (`active`, `blocked`, `deleted`).

---

### 2.2 운동 및 채점 기준 (Exercise & Scoring)

#### `exercise`
시스템에서 지원하는 운동 종목을 정의합니다.
*   `exercise_id` (UUID, PK)
*   `code`: 운동 코드 (예: `SQT`, `PSH`) - 내부 로직 매핑용.
*   `name`: 운동 표시 이름 (예: 스쿼트).
*   `is_active`: 활성화 여부.

#### `metric`
운동 평가에 사용되는 측정 지표의 정의입니다.
*   `metric_id` (UUID, PK)
*   `key`: 지표 키 (예: `knee_angle`, `spine_alignment`).
*   `title`: 지표 이름.
*   `unit`: 단위 (도, cm, % 등).

#### `scoring_profile`
특정 운동에 대한 채점 기준(프로필)의 버전 관리용 테이블입니다.
*   `scoring_profile_id` (UUID, PK)
*   `exercise_id` (FK): 대상 운동.
*   `version`: 프로필 버전.
*   `name`: 프로필 이름 (예: 초급자용 스쿼트 평가).

#### `scoring_profile_metric`
채점 프로필에 포함된 각 지표별 가중치와 평가 규칙을 정의합니다. (N:M 해소)
*   `scoring_profile_id` (FK, PK 복합)
*   `metric_id` (FK, PK 복합)
*   `weight`: 점수 반영 가중치 (0.0 ~ 1.0).
*   `max_score`: 해당 항목 만점 점수.
*   `rule` (JSONB): 채점 규칙 (임계값, 범위 등 상세 로직).

---

### 2.3 루틴 (Routine)

#### `routine`
사용자가 생성한 운동 루틴(=운동 묶음)입니다.
*   `routine_id` (UUID, PK)
*   `user_id` (FK): 소유자.
*   `name`: 루틴 이름.

#### `routine_setup`
루틴에 포함된 세부 운동 단계(Step)를 정의합니다.
*   `step_id` (UUID, PK)
*   `routine_id` (FK)
*   `exercise_id` (FK): 수행할 운동.
*   `order_no`: 순서.
*   `target_type`: 목표 유형 (`REPS`: 횟수, `TIME`: 시간).
*   `target_value`: 목표값 (예: 15회, 60초).
*   `rest_sec`: 세트 간 휴식 시간(초).
*   `sets`: 수행할 세트 수.

#### `routine_instance`
사용자가 루틴을 실제로 수행한 1회의 "실행" 기록입니다.
*   `routine_instance_id` (UUID, PK)
*   `routine_id` (FK)
*   `status`: 상태 (`RUNNING`, `DONE`, `ABORTED`).
*   `total_score`: 루틴 전체 평균 점수.

---

### 2.4 운동 기록 (Workout Session)

#### `workout_session`
운동 1회 수행의 마스터 기록입니다. 자율 운동과 루틴 운동을 모두 포함합니다.
*   `session_id` (UUID, PK)
*   `user_id` (FK)
*   `exercise_id` (FK)
*   `routine_instance_id` (FK, Nullable): 루틴의 일부인 경우 연결.
*   `scoring_profile_id` (FK): 당시 사용된 채점 기준.
*   `mode`: `FREE`(자율) 또는 `ROUTINE`(루틴).
*   `duration_sec`: 총 수행 시간.
*   `total_reps`: 총 반복 횟수.
*   `final_score`: 최종 점수 (0~100).
*   `summary_feedback`: AI 요약 피드백 텍스트.
*   `detail` (JSONB): 그래프용 시계열 데이터 등 상세 로그.

#### `workout_set`
세션 내 세트별 상세 기록입니다.
*   `set_id` (UUID, PK)
*   `session_id` (FK)
*   `set_no`: 세트 번호.
*   `phase`: `WORK`(운동) 또는 `REST`(휴식).
*   `actual_reps`: 실제 수행 횟수.

#### `session_event`
세션 중 발생한 불규칙한 이벤트(일시정지, 자세 경고 등) 로그입니다.
*   `event_id` (UUID, PK)
*   `session_id` (FK)
*   `type`: 이벤트 타입.
*   `payload` (JSONB): 상세 정보.

#### `session_metric_result`
세션 종료 후 계산된 각 평가 항목별 최종 점수입니다.
*   `session_id` (FK, PK 복합)
*   `metric_id` (FK, PK 복합)
*   `score`: 해당 항목 점수.
*   `raw`: 원시 측정값 통계 (옵션).
