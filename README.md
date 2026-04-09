# FitPlus

FitPlus는 웹캠을 활용한 실시간 AI 운동 코칭 플랫폼입니다. 사용자의 운동 자세를 실시간으로 분석하여 피드백을 제공하고, 운동 기록을 체계적으로 관리합니다.

## 프로젝트 특징 (Key Features)

*   **실시간 AI 코칭**: MediaPipe Pose를 이용해 브라우저 내에서 실시간으로 관절 포인트를 추적하고 자세를 평가합니다.
*   **다양한 운동 지원**: 스쿼트, 푸쉬업 등 맨몸 운동에 대한 상세한 가이드와 채점 시스템을 제공합니다.
*   **루틴 관리**: 나만의 운동 루틴을 생성하고 수행 결과를 기록할 수 있습니다.
*   **웹 기반 접근성**: 별도의 장비 없이 노트북이나 스마트폰의 카메라만으로 이용 가능합니다.

## 기술 스택 (Tech Stack)

*   **Backend**: Node.js, Express
*   **Database**: Supabase (PostgreSQL)
*   **Frontend**: EJS (Server-side Rendering), Vanilla JS, CSS
*   **AI/ML**: MediaPipe Pose (JavaScript)
*   **Authentication**: JWT (JSON Web Token)

## 시작하기 (Getting Started)

### 사전 요구사항 (Prerequisites)

*   Node.js (v14 이상 권장)
*   npm (Node Package Manager)

### 설치 (Installation)

1.  저장소를 클론합니다.
    ```bash
    git clone [repository_url]
    cd FitPlus
    ```

2.  의존성 패키지를 설치합니다.
    ```bash
    npm install
    ```

### 설정 (Configuration)

프로젝트 루트에 `.env` 파일을 생성하고 다음 환경 변수를 설정해야 합니다.

```env
# Supabase 설정
SUPABASE_URL="your_supabase_url"
SUPABASE_SERVICE_ROLE_KEY="your_supabase_service_role_key"

# 인증 설정 (JWT)
JWT_SECRET="your_jwt_secret_key"
JWT_EXPIRES_IN="1H"

# 서버 포트
PORT=3000
```

### 실행 (Running)

애플리케이션을 실행합니다.

```bash
node app.js
```

서버가 실행되면 브라우저에서 `http://localhost:3000`으로 접속하세요.

### 테스트 (Testing)

현재는 Node 내장 테스트 러너를 사용합니다.

```bash
npm test
```

주요 검증 대상은 phase 학습 데이터셋 정규화와 라벨 병합 로직입니다.

## 문서 (Documentation)

더 자세한 프로젝트 구조와 데이터베이스 설계는 `docs/` 폴더 내의 문서를 참고하세요.

*   [코드베이스 설명 (Codebase Explanation)](docs/codebase_explanation.md): 프로젝트 구조, 주요 모듈, 아키텍처 설명
*   [데이터베이스 구조 (Database Structure)](docs/database_structure.md): 테이블 스키마 및 관계 설명

## Phase 라벨링 워크플로

스쿼트 세션을 끝내면 결과 페이지에서 frame-level phase 데이터셋을 확인할 수 있습니다.

1. 운동 세션을 수행하면 브라우저가 `detail.phase_dataset.feature_frames`에 학습용 feature frame을 수집합니다.
2. 결과 페이지에서 사람이 라벨링한 JSON을 붙여넣거나 업로드합니다.
3. `라벨 저장` 버튼이 `/api/workout/session/:sessionId/phase-labels`로 라벨을 저장합니다.
4. `학습 JSON 다운로드` 버튼이 rule phase와 human phase가 합쳐진 데이터셋을 내려받습니다.
