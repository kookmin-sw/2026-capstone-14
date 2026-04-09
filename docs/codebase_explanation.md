# FitPlus 코드베이스 상세 설명서

이 문서는 FitPlus 프로젝트의 **Node.js 백엔드**와 **웹 프론트엔드**, 특히 클라이언트 사이드 AI 로직에 초점을 맞춰 상세하게 설명합니다. (Python Core 로직은 제외됨)

## 1. 시스템 아키텍처 개요

FitPlus는 웹 브라우저 자체에서 AI 모델을 구동하여 실시간성을 극대화한 아키텍처를 따릅니다.

*   **Frontend (Browser)**: MediaPipe JS를 이용해 카메라 영상에서 포즈를 추출하고, 자체 알고리즘으로 점수를 계산합니다.
*   **Backend (Node.js)**: 사용자 인증, 운동 세션 관리, 결과 데이터 저장을 담당합니다.

---

## 2. 백엔드 (Node.js / Express) 상세 분석

백엔드는 REST API와 서버 사이드 렌더링(SSR)을 모두 담당합니다.

### 2.1 인증 시스템 (`middleware/auth.js`)

FitPlus는 JWT(JSON Web Token) 기반의 Stateless 인증을 사용합니다.

*   **토큰 생성 (`generateToken`)**: 사용자 ID, 로그인 ID, 닉네임을 포함한 JWT를 발급합니다.
*   **`requireAuth` 미들웨어**:
    *   요청 헤더가 아닌 `cookie`에서 토큰을 읽습니다.
    *   토큰 검증 실패 시 즉시 쿠키를 삭제하고 로그인 페이지로 리다이렉트합니다.
    *   보안이 필요한 API 및 페이지(마이페이지, 운동 시작 등)에 필수적으로 적용됩니다.
*   **`addAuthState` 미들웨어**:
    *   모든 요청에 대해 실행되며, 토큰 유효성만 확인하여 `res.locals`에 사용자 정보를 주입합니다.
    *   이는 뷰(EJS)에서 "로그인/로그아웃" 버튼 상태를 렌더링하는 데 사용됩니다. (보안 강제 아님)

### 2.2 운동 컨트롤러 (`controllers/workout.js`)

운동 세션의 생명주기를 관리하는 핵심 로직입니다.

1.  **세션 시작 (`startWorkoutSession`)**:
    *   클라이언트가 운동을 시작하면 호출됩니다.
    *   `workout_session` 테이블에 레코드를 생성하고, `session_id`를 반환합니다.
    *   사용자가 선택한 모드(FREE/ROUTINE)와 스코어링 프로필 ID를 기록합니다.

2.  **세트 기록 (`recordWorkoutSet`)**:
    *   운동 중 한 세트가 끝날 때마다 비동기적으로 호출됩니다.
    *   실시간 데이터 유실을 방지하기 위해 세트 단위로 즉시 DB에 저장합니다 (`workout_set`).

3.  **세션 종료 (`endWorkoutSession`)**:
    *   운동이 완전히 종료되었을 때 호출됩니다.
    *   총 운동 시간(`duration_sec`), 총 횟수, 최종 점수, AI 요약 코멘트를 업데이트합니다.
    *   클라이언트에서 계산된 상세 메트릭 결과도 함께 저장될 수 있습니다.

---

## 3. 프론트엔드 (Client-side AI) 상세 분석

`public/js/workout/` 디렉토리에 있는 모듈들은 브라우저 내에서 독립적으로 작동하는 AI 엔진을 구성합니다.

### 3.1 AI 엔진 구성도

```mermaid
graph TD
    Camera[Camera Feed] --> PoseEngine
    PoseEngine -- Landmarks --> ScoringEngine
    PoseEngine -- Landmarks --> RepCounter
    ScoringEngine -- Score & Feedback --> UI
    RepCounter -- Count Reps --> SessionBuffer
    ScoringEngine -- Score Samples --> SessionBuffer
    SessionBuffer -- Batch Upload --> Backend API
```

### 3.2 주요 모듈 설명

#### **1. `pose-engine.js` (시각 처리)**
Google의 MediaPipe Pose 라이브러리를 래핑한 클래스입니다.
*   **One Euro Filter**: 원본 랜드마크 데이터의 떨림(Jitter)을 방지하기 위해 필터링을 적용합니다. 빠른 움직임에는 민감하게, 정지 상태에서는 부드럽게 반응하도록 튜닝되어 있습니다.
*   **각도 계산**: 33개의 랜드마크 좌표를 이용해 주요 관절(무릎, 엉덩이, 팔꿈치, 어깨, 척추)의 각도를 실시간으로 계산하여 반환합니다.

#### **2. `scoring-engine.js` (채점 논리)**
DB에 저장된 운동별 채점 기준(`scoring_profile`)을 받아 실제로 점수를 매기는 엔진입니다.
*   **규칙 기반 평가**: 각도 데이터와 미리 정의된 규칙(Range, Threshold, Optimal)을 비교합니다.
    *   *예: 스쿼트 시 무릎 각도가 90도 미만이면 만점, 100도 이상이면 감점.*
*   **좌우 관절 각도 보정**: 팔꿈치 등 좌우 값 차이가 큰 경우 더 큰 각도를 우선해 과도한 감점을 줄입니다.
*   **실시간 피드백 생성**: 점수가 특정 임계값(예: 70점) 이하로 떨어지면 즉시 "무릎을 더 굽히세요" 같은 교정 메시지를 생성합니다.

#### **3. `session-buffer.js` (데이터 동기화)**
불안정한 네트워크 환경이나 빈번한 API 호출 오버헤드를 줄이기 위한 버퍼링 모듈입니다.
*   **데이터 수집**: 매 프레임 계산되는 점수를 1초 단위로 다운샘플링하여 저장합니다.
*   **로컬 스토리지 백업**: 브라우저가 비정상 종료되더라도 데이터를 복구할 수 있도록 `localStorage`에 임시 저장합니다.
*   **일괄 전송 (`export`)**: 운동 종료 시, 그동안 모인 점수 타임라인, 세트 기록, 이벤트 로그를 하나의 JSON 객체로 묶어 백엔드로 전송합니다.

---

## 4. 데이터베이스 스키마 (Supabase)

*   **Exercise**: 운동 메타데이터 (코드, 이름)
*   **Scoring Profile**: 운동별 채점 기준 세트 (버전 관리 가능)
    *   **Metric**: 평가 항목 (무릎 각도, 허리 펴짐 등)
    *   **Rule**: 해당 항목의 만점 기준 및 감점 로직 JSON
*   **Workout Session**: 사용자의 운동 1회 기록
    *   **Session Metric Result**: 세션 종료 후 저장되는 항목별 평균 점수 및 통계

---

이 문서는 Web/Node.js 기술 스택에 집중하여 작성되었습니다.
