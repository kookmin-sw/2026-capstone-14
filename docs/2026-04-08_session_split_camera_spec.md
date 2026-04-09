# 2026-04-08 : 운동 세션 분리 리팩터링 및 카메라 입력 스펙

## 1. 문서 목적

이 문서는 **2026-04-08** 전후로 진행한 다음 내용을 한곳에 정리한다.

- `session.ejs`에 몰려 있던 클라이언트 로직 분리(리팩터링)
- 웹캠 / 화면 공유 / 휴대폰(후면) 카메라 **입력 소스 선택** 도입
- 웹캠이 잡히지 않거나 LED만 잠깐 켜졌다 꺼지는 문제에 대한 **원인 분석과 코드 대응**

관련 대화에서 다룬 주제(실행 방법, 구조 평가, 리팩터 이점, 카메라 디버깅)도 이 스펙에 흡수한다.

---

## 2. 배경 및 해결하려던 문제

### 2.1 `session.ejs` 단일 파일 비대화

- 약 **1200줄** 규모로 HTML, EJS 데이터 주입, **인라인 JS(약 1000줄)**, 인라인 스타일이 한 파일에 섞여 있었다.
- EJS가 실제로 필요한 부분은 **`workoutData` 주입** 수준이었고, 나머지는 순수 브라우저 JS였다.
- 카메라·타이머·루틴·세션 API·UI가 한 스크립트 블록에 있어 **기능 추가 시 충돌·실수 위험**이 컸다.
- 인라인 스크립트는 IDE 린트/자동완성 지원이 약하고, 테스트 분리도 어렵다.

### 2.2 입력 소스

- 기존에는 `getUserMedia`가 주석 처리되고 **`getDisplayMedia`(화면 공유)**만 사용하는 개발용 형태였다.
- 요구사항: **웹캠**, **화면 공유**, **휴대폰 카메라(브라우저에서 후면)** 중 선택 가능하게 할 것.

### 2.3 웹캠 동작 이슈(사후 디버깅)

- 증상: 카메라 LED가 잠깐 켜졌다가 꺼지고, 화면에는 **미디어 연결 실패** 및 **`NotReadableError` 계열 메시지**가 표시됨.
- 원인 후보:
  - `video`에 스트림만 붙이고 **`play()` 미호출**로 재생이 안 되는 환경
  - 기본 소스가 **화면 공유**라 웹캠 사용자 경험이 어긋남
  - 데스크톱 웹캠에서 **`facingMode` + 해상도 제약** 조합이 드라이버와 맞지 않아 `getUserMedia`가 실패하는 경우

---

## 3. 아키텍처 결정

### 3.1 번들러 없이 유지

- 기존과 같이 **`<script src>` 로드 순서**로 의존성을 관리한다.
- 빌드 단계를 추가하지 않는다.

### 3.2 파일 역할 분리

| 파일 | 역할 |
|------|------|
| `views/workout/session.ejs` | 레이아웃, 입력 소스 UI 마크업, `workoutData` 주입, `initSession` 호출 |
| `public/js/workout/session-camera.js` | `getUserMedia` / `getDisplayMedia`, 스트림 적용·해제 |
| `public/js/workout/session-controller.js` | 세션 상태, Pose/Scoring/Rep/Buffer 연동, 타이머·루틴, 종료·비콘 |
| `public/workout.css` | 세션 전용 보조 스타일(소스 선택, 토스트, `#poseCanvas` 등) |

### 3.3 진입점

- `initSession(workoutData)` 하나로 세션 페이지 클라이언트를 초기화한다.
- HTML `onclick`과 호환되도록 `confirmExit`, `startWorkout`, `togglePause`, `finishWorkout`, `closeExitModal`, `forceExit`을 **`window`에 할당**한다.

---

## 4. 스크립트 로드 순서(필수)

```text
1. MediaPipe CDN (camera_utils, pose)
2. one-euro-filter.js
3. exercise-registry.js
4. exercises/squat-exercise.js
5. pose-engine.js
6. scoring-engine.js
7. rep-counter.js
8. session-buffer.js
9. session-camera.js
10. session-controller.js
11. 인라인: workoutData + DOMContentLoaded → initSession(workoutData)
```

`LandmarkSmoother` 등은 `pose-engine.js`가 사용하므로 **one-euro-filter는 pose 이전**에 둔다.

---

## 5. 구현 상세

### 5.1 `SessionCamera` (`session-camera.js`)

- **`getStream(sourceType)`**
  - `screen`: `getDisplayMedia`
  - 그 외(`webcam`, `mobile_rear` 등): `getUserMedia`
  - **3단계 fallback**(웹캠 계열):
    1. `width/height` ideal + `facingMode`
    2. `facingMode`만
    3. `{ video: true }`
  - 데스크톱에서 `facingMode`와 해상도를 동시에 걸 때 드라이버가 `NotReadableError`를 내는 경우를 완화한다.
- **`applyStream(stream)`**
  - `video.srcObject` 설정 후 **`loadedmetadata` 및 `readyState >= 1`에서 `video.play()`** 호출(브라우저별 자동재생 이슈 완화).
- **`destroy()`**
  - 트랙 `stop`, `srcObject` 해제.
- **`window.SESSION_CAMERA_DEFAULT_SOURCE`**
  - 기본값 **`webcam`** (PC에서 바로 웹캠을 쓰는 흐름 우선).

### 5.2 `initSession` (`session-controller.js`)

- AI 엔진은 **한 번만** 초기화(`aiEnginesInitialized`). 이후에는 **스트림만 교체**(`connectCameraSource`).
- 준비 단계에서만 소스 버튼으로 소스 변경 가능.
- 운동 시작 시 `#sourceSelect` 숨김.
- 종료 시 `poseEngine.destroy()`와 함께 **`sessionCamera.destroy()`** 호출.
- 리팩터 시 제거·정리한 항목:
  - 사용되지 않던 `finishWorkoutLegacy`
  - `handlePoseDetected` **몽키패칭** → 본문에서 `noPersonCount` 리셋
  - 깨졌던 한글 UI 문자열 복구
- `getUserMedia` 실패 시 **`error.name`** 기준 사용자 메시지 분기 (`NotFound`, `NotAllowed`, `NotReadable`, `Abort` 등).

### 5.3 `session.ejs` UI

- 입력 소스: **웹캠**, **화면 공유**, **휴대폰 카메라**(후면 `environment` 시도).
- 안내 문구: 휴대폰은 브라우저 후면, PC는 웹캠 또는 화면 공유 권장.

### 5.4 `workout.css` 추가

- `.source-select`, `.source-btn.active`, `.source-select-hint`
- `#poseCanvas` 오버레이(포인터 이벤트 없음 등)
- `.score-detail .score-item` (세부 점수 행)
- `@keyframes fadeInOut`, `.workout-session-toast`
- `.status.finished`

---

## 6. 리팩터링으로 얻는 이점(요약)

- 카메라 변경은 **`session-camera.js`**만, 세션 로직은 **`session-controller.js`**만 열면 된다.
- `.js` 파일로 분리되어 **에디터 지원·린트**가 정상적으로 동작한다.
- 팀 작업 시 **동일 거대 파일 충돌** 가능성 감소.
- 입력 소스·녹화·원격 카메라 등 확장 시 **`getStream` 분기**만 늘리기 쉽다.

---

## 7. 운영/디버깅 체크리스트

- **Node 미설치·PATH 없음**: `node app.js`가 인식되지 않으면 Node LTS 설치 후 터미널 재시작.
- **프로젝트 루트**: `app.js`가 있는 디렉터리에서 실행.
- **`npm install`**: 모듈 누락 시 `Cannot find module`.
- **Windows PowerShell**: 구버전에서 `&&` 대신 `;` 또는 줄 나눔.
- **웹캠 `NotReadableError`**: 다른 앱(디스코드, Zoom, OBS 등)이 카메라 점유 여부 확인. 코드 측면에서는 **fallback 3단계**로 완화.
- 브라우저 콘솔의 `[SessionCamera]` 경고 로그로 **어느 단계에서 실패했는지** 추적 가능.

---

## 8. 변경 파일 목록(이 스펙이 다루는 범위)

| 구분 | 경로 |
|------|------|
| 신규 | `public/js/workout/session-camera.js` |
| 신규 | `public/js/workout/session-controller.js` |
| 대폭 수정 | `views/workout/session.ejs` |
| 수정 | `public/workout.css` |

(이전에 존재하던 `pose-engine.js`, `scoring-engine.js` 등 코어 모듈은 **이번 분리의 전제**로 두고, 본 스펙의 초점은 세션 페이지·카메라 계층이다.)

---

## 9. 향후 확장 아이디어(비필수)

- `enumerateDevices()`로 **장치 ID 선택** UI.
- 데스크톱 **웹캠 전용**으로 `facingMode` 생략 분기(모바일만 `facingMode` 사용).
- 원격 휴대폰 카메라(WebRTC·QR 등)는 **별도 페이지·시그널링**이 필요해 본 스펙 범위를 넘어선다.

---

## 10. 관련 문서

- `docs/2026-04-07_squat_phase_aware_refactor_spec.md` — 스쿼트 phase·레지스트리 구조
- `docs/2026-04-02_current_scoring_spec.md` — 채점·세션 이벤트 설명(일부 `session.ejs` 언급)
