# 품질 게이트 권한 통합 — 설계 스펙

**작성일:** 2026-04-22
**상태:** 승인됨 (아키텍처 전용)
**관련:** [런타임 평가 스펙 v3](./2026-04-21-runtime-evaluation-spec-v3.md)

---

## 핵심 설계 문장

> 입력 품질 게이팅에 관한 모든 최종 권한은 오직 `scoring-engine.js` 안의 공통 게이트에만 존재한다. 더 넓게 보면 `scoring-engine.js`는 게이트 결과와 운동 수행 결과를 통합하여 최종 rep 상태를 결정한다. 워크아웃 파이프라인의 다른 모든 모듈은 신호 생성기, 메타데이터 제공자, 또는 UX 오케스트레이터일 뿐 — 품질이나 보류에 대한 최종 결정권자는 아니다.

---

## 1. 문제 정의

현재 워크아웃 평가 파이프라인은 품질 관련 판단 로직을 여러 모듈에 분산시켜 놓고 있다. 운동 모듈(예: `push-up-exercise.js`)은 때때로 `low_confidence`나 `view_mismatch` 같은 reason code를 생성하는데, 이는 본질적으로 입력 품질 문제이지 운동 수행 문제가 아니다. 이로 인해 세 가지 문제가 발생한다:

1. **권한 모호성** — "채점 가능 여부"에 대한 최종 판단을 어느 모듈이 내리는지 불분명하다.
2. **Reason-code 오염** — 입력 품질 reason이 운동 모듈 출력에 섞여 들어가서 하위 분류와 UX 매핑이 취약해진다.
3. **중복 위험** — 동일한 품질 검사가 운동 모듈마다 다르게 구현되어 일관되지 않은 동작을 초래할 수 있다.

이 설계는 모든 최종 품질 게이트 권한을 한 곳으로 통합하고, 다른 모든 모듈이 할 수 있는 것과 할 수 없는 것을 명확히 정의한다.

---

## 2. 목표 아키텍처

파이프라인 흐름은 다음과 같다:

```
pose-engine.js
    ↓ (원시 품질 신호)
scoring-engine.js  ← 공통 품질 게이트 (최종 권한)
    ↓ (통과 → 운동 평가; 보류 → 건너뜀)
push-up-exercise.js (또는 다른 운동 모듈)
    ↓ (수행 결과만)
scoring-engine.js  ← 상태 통합 및 rep-state 적용
    ↓ (결정된 상태 + reason)
session-controller.js  ← UX 메시지 매핑 및 파이프라인 오케스트레이션
```

### 모듈 역할

| 모듈 | 역할 | 최종 품질/보류 결정을 내릴 수 있는가? |
|---|---|---|
| `pose-engine.js` | 원시 품질 신호 생성 (랜드마크, 가시성, 신뢰도, 뷰 추정, 안정성) | **아니오** — 신호 생성기 전용 |
| `scoring-engine.js` | 공통 품질 게이트 운영 (최종 `pass` / `withhold` 결정); 게이트 결과와 운동 결과를 통합하여 최종 rep 상태 결정 (`scored`, `withheld`, `hard_fail`, `soft_fail`) | **예** — 유일한 최종 권한자 (품질은 게이트, rep-state 통합은 엔진) |
| `push-up-exercise.js` (및 다른 운동 모듈) | 운동 요구사항 메타데이터 (필수 뷰, 중요 관절) 및 동작 의미 평가 (깊이, 잠금, 몸통 라인) 제공 | **아니오** — 메타데이터 + 수행 의미만 |
| `session-controller.js` | 파이프라인 오케스트레이션 및 결정된 상태/reason을 UX 메시지로 매핑 | **아니오** — 오케스트레이션 & UX 전용 |

---

## 3. 권한 규칙

### 3.1 공통 게이트의 유일한 권한 (`scoring-engine.js`)

`scoring-engine.js` 안의 공통 품질 게이트는 코드베이스에서 **유일하게** 다음을 수행할 수 있는 곳이다:

- 주어진 프레임 또는 rep 구간에 대해 `pass` vs `withhold` 결정.
- 최종 보류 reason code 할당.
- 운동 모듈을 호출할지 말지 여부 결정.

참고: rep-state 결정(`scored`, `withheld`, `hard_fail`, `soft_fail`)은 공통 게이트와 운동 평가가 각각의 출력을 생성한 *이후에* `scoring-engine.js`가 더 넓은 관점에서 수행한다. 게이트 자체는 운동 수행 판단을 소유하지 않으며, 입력 품질의 pass/withhold 결정만 소유한다.

### 3.2 금지된 운동 모듈 동작

운동 모듈은 **반드시** 다음을 하지 않아야 한다:

- `withhold`를 결과 상태로 생성.
- 다음 reason code 중 어느 것도 생성 (게이트 전용 소유):
  - `out_of_frame`
  - `tracked_joints_low`
  - `view_unstable`
  - `view_mismatch`
  - `low_confidence`
  - `joints_missing`
- 채점을 건너뛰거나 연기할지 결정.
- 세션 수준 데이터 구조에 최종 rep state 적용.

### 3.3 허용된 운동 모듈 동작

운동 모듈은 **다음**을 할 수 있다:

- **요구사항 메타데이터** 선언: 필수 뷰, 중요 관절 집합, 최소 가시성 기대치.
- 게이트 통과 후 **동작 의미** 평가: 깊이 도달 여부, 잠금 완료, 몸통 라인 유지, 템포 제어 등.
- **운동별** reason code로 수행 지향 결과 상태(`hard_fail`, `soft_fail`, `pass`) 반환 (예: `depth_not_reached`, `lockout_incomplete`, `body_line_broken`).
- UX 레이어를 위한 피드백 문자열 또는 구조화 힌트 제공.

### 3.4 `pose-engine.js` — 신호 생성기

`pose-engine.js`는 공통 게이트가 소비할 원시 신호를 생성한다. 게이팅 판단은 **하지 않는다**. 출력에는 다음이 포함된다:

- 랜드마크 좌표 및 존재 플래그.
- 관절별 가시성 점수.
- 감지 및 추적 신뢰도 값.
- 추정 뷰 분류 및 신뢰도.
- 최근 프레임 구간의 안정성 메트릭.

### 3.5 `session-controller.js` — 오케스트레이터 & UX 매퍼

`session-controller.js`의 책임:

- 올바른 순서로 파이프라인 호출.
- `scoring-engine.js`로부터 결정된 상태와 reason 소비.
- Reason code를 사용자 메시지로 매핑.
- 세션 생명주기 관리 (시작, 일시정지, 종료, 익스포트).

원시 품질 신호를 해석하거나 게이팅 결정을 하지 **않는다**.

---

## 4. 실질적 데이터 계약

### 4.1 입력: `pose-engine.js` → `scoring-engine.js`

```
{
  landmarks: [...],
  jointVisibility: { jointName: number, ... },
  detectionConfidence: number,
  trackingConfidence: number,
  estimatedView: string,
  estimatedViewConfidence: number,
  stabilityWindow: { unstableRatio: number, stableStreak: number, ... }
}
```

### 4.2 입력: 운동 모듈 메타데이터 (선언적)

```
{
  exerciseType: "push-up",
  requiredViews: ["SIDE"],
  importantJoints: ["left_elbow", "right_elbow", "left_shoulder", "right_shoulder", ...],
  motionSemantics: {
    // phase definitions, angle thresholds, etc.
  }
}
```

### 4.3 출력: 공통 게이트 (`scoring-engine.js`) → 하위 모듈

```
{
  gateResult: "pass" | "withhold",
  withholdReason?: string,   // gateResult === "withhold" 일 때만 존재
  // 게이트 전용 reason code만:
  //   out_of_frame, tracked_joints_low, view_unstable,
  //   view_mismatch, low_confidence, joints_missing, ...
}
```

### 4.4 출력: 운동 모듈 → `scoring-engine.js`

```
{
  result: "pass" | "hard_fail" | "soft_fail",
  reasons?: string[],   // 운동별 코드만:
                        //   depth_not_reached, lockout_incomplete, body_line_broken, ...
  feedback?: string[]
}
```

### 4.5 최종 결정 상태 (`scoring-engine.js` → `session-controller.js`)

```
{
  repState: "scored" | "withheld" | "hard_fail" | "soft_fail",
  score?: number,
  reason?: string,       // 단일 권위 reason code
  feedback?: string[]
}
```

---

## 5. 현재 코드 영향

### 5.1 `scoring-engine.js`

- 현재 분산되어 있을 수 있는 공통 품질 게이트 로직을 운영해야 한다.
- 게이팅 판단을 위해 `pose-engine.js` 신호의 유일한 소비자여야 한다.
- 게이트 통과 후에만 운동 모듈 결과를 통합해야 한다.
- rep-state 머신과 그 전이를 소유해야 한다.

### 5.2 `pose-engine.js`

- 게이팅이나 판단 로직이 포함되지 않았는지 감사해야 한다.
- 책임은 엄격히 신호 생성뿐이다.

### 5.3 `push-up-exercise.js`

- 게이트 전용 reason code(`low_confidence`, `view_mismatch` 등)를 생성하지 않도록 감사해야 한다.
- 운동 수행 결과만 반환하도록 리팩터링해야 한다.
- 요구사항 메타데이터(필수 뷰, 중요 관절)를 공통 게이트가 소비할 수 있는 선언적 데이터로 노출해야 한다.

### 5.4 `session-controller.js`

- 원시 품질 신호를 해석하거나 게이팅 판단을 하지 않는지 감사해야 한다.
- `scoring-engine.js`로부터 결정된 상태와 reason만 소비해야 한다.
- 파이프라인 오케스트레이션과 UX 메시지 매핑에 집중해야 한다.

---

## 6. 비목표

이 설계 문서는 다음을 **명시적으로 제외**한다:

- **마이그레이션 계획** — 기존 로직을 운동 모듈에서 공통 게이트로 옮기는 방법은 구현 관심사이다.
- **상세 테스트 명세** — 테스트 전략은 이 아키텍처 문서의 범위 밖이다.
- **임계값 튜닝** — 가시성, 신뢰도, 안정성 등의 구체적 수치 임계값은 런타임 평가 스펙 v3(부록 A)에서 다루며, 본 권한 통합 설계의 일부가 아니다.
- **신규 운동 추가** — 이 문서는 기존 운동 모듈 패턴을 가정하며, 새 운동 추가는 동일한 권한 규칙을 따르지만 여기서 범위로 삼지 않는다.
- **데이터베이스 또는 저장소 변경** — 이 설계는 순전히 인프로세스 모듈 권한과 데이터 계약에 관한 것이다.
- **UI/UX 설계** — 메시지 내용과 표시는 이 문서의 범위 밖이다.

---

## 7. 성공 기준

이 설계가 성공적으로 구현되었다고 간주되는 조건:

1. **단일 권한** — `scoring-engine.js`만이 `withhold` 판단이나 게이트 전용 reason code를 생성한다.
2. **깔끔한 분리** — 어떤 운동 모듈도 `out_of_frame`, `tracked_joints_low`, `view_unstable`, `view_mismatch`, `low_confidence`, `joints_missing`을 생성하지 않는다.
3. **선언적 메타데이터** — 운동 모듈은 요구사항(뷰, 관절)을 내장된 판단 로직이 아니라 공통 게이트가 소비하는 데이터로 노출한다.
4. **신호 순수성** — `pose-engine.js`는 게이팅 판단 없이 원시 신호만 생성한다.
5. **오케스트레이션 명확성** — `session-controller.js`는 결정된 상태와 reason만 소비하며, 원시 신호를 해석하지 않는다.
6. **Reason-code 무결성** — 시스템의 모든 reason code는 단일하고 모호하지 않은 소유자(게이트 또는 운동 모듈)를 가지며, reason-code 책임 매트릭스(런타임 평가 스펙 v3, 부록 B 참조)에 문서화된다.

---

## 부록: Reason-Code 소유 요약

| Reason Code | 소유자 | 범주 |
|---|---|---|
| `out_of_frame` | `scoring-engine.js` (게이트) | 입력 품질 |
| `tracked_joints_low` | `scoring-engine.js` (게이트) | 입력 품질 |
| `view_unstable` | `scoring-engine.js` (게이트) | 입력 품질 |
| `view_mismatch` | `scoring-engine.js` (게이트) | 입력 품질 |
| `low_confidence` | `scoring-engine.js` (게이트) | 입력 품질 |
| `joints_missing` | `scoring-engine.js` (게이트) | 입력 품질 |
| `depth_not_reached` | 운동 모듈 | 수행 |
| `lockout_incomplete` | 운동 모듈 | 수행 |
| `body_line_broken` | 운동 모듈 | 수행 |
| `tempo_uncontrolled` | 운동 모듈 | 수행 |

> **경험 법칙:** reason이 *입력*(카메라, 추적, 가시성, 뷰)의 문제를 설명하면 게이트에 속한다. reason이 *동작*(깊이, 폼, 템포)의 문제를 설명하면 운동 모듈에 속한다.
