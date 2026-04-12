# LLM + Feature Summarizer 계획서 (Spec)

## 1. 문서 정보

- 문서명: LLM + Feature Summarizer 설계 명세서
- 대상 프로젝트: FitPlus 웹캠 기반 AI 운동 코칭 서비스
- 문서 목적: 기존 rule-based scoring 결과를 기반으로 운동 종료 후 설명 가능하고 개인화 가능한 코칭 리포트를 생성하는 분석 레이어를 정의한다.
- 문서 범위: 운동 종료 후 세션 분석 파이프라인, feature summarizer, LLM 분석 레이어, 데이터 계약, API, DB 확장, 평가/운영 방안을 포함한다.

---

## 2. 배경 및 문제 정의

현재 시스템은 운동별 하드코딩된 메트릭과 가중치를 사용하여 최종 점수를 계산한다. 이 방식은 실시간 판정에는 적합하지만, 다음과 같은 한계가 있다.

1. 사용자가 점수와 메트릭을 보고도 무엇을 먼저 고쳐야 하는지 이해하기 어렵다.
2. 동일한 낮은 점수라도 원인이 자세 문제인지 카메라/검출 문제인지 분리해서 설명하기 어렵다.
3. 현재 세션만 보여줄 뿐, 과거 세션 대비 개선/악화 여부를 자연어로 설명하지 못한다.
4. 하드코딩된 메트릭은 숫자 계산에는 강하지만, 사용자 친화적인 코칭 언어로 변환하는 기능이 없다.

따라서 본 계획서는 아래 역할 분리를 목표로 한다.

```text
실시간 판정: Rule-based scoring engine 유지
세션 종료 후 분석: Feature Summarizer
설명 생성: LLM Coaching Layer
```

---

## 3. 목표

### 3.1 핵심 목표

- 운동 종료 후 세션 데이터를 구조화된 feature로 요약한다.
- 요약된 feature를 기반으로 LLM이 자연어 코칭 리포트를 생성한다.
- 결과는 프론트엔드에서 안정적으로 렌더링 가능하도록 JSON schema를 따른다.
- 분석 결과는 재현 가능해야 하며, prompt/model 버전 관리가 가능해야 한다.

### 3.2 기대 효과

- 사용자는 점수 자체보다 교정 우선순위와 행동 지침을 이해할 수 있다.
- 카메라 문제와 자세 문제를 분리하여 설명할 수 있다.
- 과거 세션과 비교한 진척 분석이 가능해진다.
- 향후 RAG, personalization, ML calibration을 얹기 좋은 기반이 마련된다.

---

## 4. 비목표(Non-goals)

이번 단계에서 포함하지 않는 범위는 아래와 같다.

- 프레임 단위 실시간 LLM 판정
- raw pose landmark 자체를 LLM에 직접 입력하는 구조
- 최종 점수 계산 로직의 즉각적인 ML 대체
- 의료적 진단 또는 부상 진단
- 완전 자동 운동 프로그램 추천 시스템

---

## 5. 용어 정의

- **Metric**: 운동 품질을 수치화한 항목. 예: squat depth, knee alignment.
- **Feature**: metric, event, timeline, 세션 통계를 기반으로 요약된 분석용 입력값.
- **Feature Summarizer**: 세션 원시 로그를 읽어 LLM 입력용 feature JSON을 생성하는 모듈.
- **LLM Coaching Layer**: feature JSON과 규칙 사전을 읽어 사용자용 코칭 리포트를 생성하는 모듈.
- **Confidence**: 이번 분석 결과의 신뢰도. 카메라 안정성, 샘플 수, rep 수 등을 반영한다.
- **Session Analysis**: 세션 종료 후 생성되는 분석 결과 레코드.

---

## 6. 시스템 개요

```text
[Camera / MediaPipe Pose]
        ↓
[운동별 scoring engine]
        ↓
[session_snapshot_metric / session_event / workout_session 저장]
        ↓
[Feature Summarizer]
        ↓
[LLM Coaching Layer]
        ↓
[session_analysis 저장]
        ↓
[결과 페이지 렌더링]
```

### 6.1 설계 원칙

1. 실시간 경로와 사후 분석 경로를 분리한다.
2. LLM에는 raw landmark가 아니라 요약 feature만 전달한다.
3. LLM 출력은 자유 텍스트가 아니라 schema-bound JSON으로 제한한다.
4. 동일 입력에 대해 거의 동일한 출력이 나오도록 prompt와 사전을 고정한다.
5. 모델 실패 시 deterministic fallback 메시지를 제공한다.

---

## 7. 요구사항

## 7.1 기능 요구사항

### FR-1. 세션 종료 후 자동 분석 실행
- 운동 세션이 종료되면 서버는 세션 분석 작업을 생성해야 한다.
- 분석 작업은 비동기 background job 또는 request-response 후처리로 실행 가능하다.
- 분석 입력은 최소한 아래 데이터를 포함해야 한다.
  - workout_session
  - session_snapshot_metric
  - session_event
  - exercise metadata
  - selected_view

### FR-2. Feature Summarizer 생성
- 시스템은 세션 로그를 feature JSON으로 변환해야 한다.
- feature JSON은 LLM 없이도 생성 가능해야 한다.
- feature JSON 생성 과정은 deterministic해야 한다.

### FR-3. LLM 코칭 리포트 생성
- 시스템은 feature JSON을 입력으로 받아 JSON 형태의 코칭 결과를 생성해야 한다.
- 결과는 한줄 요약, 장점, 핵심 문제, 행동 지침, 신뢰도 설명, 카메라 이슈 여부를 포함해야 한다.

### FR-4. 분석 결과 저장
- 시스템은 feature JSON, LLM output JSON, version 정보, 생성 시각을 저장해야 한다.
- 재생성 시 버전 히스토리를 남길 수 있어야 한다.

### FR-5. 결과 조회 API 제공
- 프론트엔드는 세션 ID 기준으로 분석 결과를 조회할 수 있어야 한다.
- 분석 진행 중인 상태와 완료 상태를 구분할 수 있어야 한다.

### FR-6. 실패 대비 fallback
- LLM 호출 실패 시 규칙 기반 fallback 코칭 문구를 생성해야 한다.
- fallback 결과도 JSON schema를 동일하게 따라야 한다.

## 7.2 비기능 요구사항

### NFR-1. 응답 성능
- 세션 종료 후 3초 이내 1차 결과 제공이 바람직하다.
- 10초 이내 분석 완료를 목표로 한다.
- 비동기 처리 시 프론트는 polling 또는 SSE로 상태를 확인할 수 있어야 한다.

### NFR-2. 일관성
- 동일 feature JSON과 동일 analysis version 조합에 대해 의미적으로 유사한 결과를 반환해야 한다.
- prompt, model, metric guide 버전을 저장해야 한다.

### NFR-3. 확장성
- 스쿼트, 푸쉬업, 플랭크 외 운동 추가 시 metric guide와 summarizer mapping만 추가하면 동작해야 한다.

### NFR-4. 안전성
- 의학적 진단, 치료 조언, 확정적 부상 판단은 금지한다.
- 불확실한 경우 명시적으로 신뢰도 낮음을 표시해야 한다.

---

## 8. 입력 데이터 사양

## 8.1 세션 원천 데이터

### workout_session
필수 필드:
- session_id
- user_id
- exercise_id 또는 exercise_key
- selected_view
- started_at
- ended_at
- duration_sec
- rep_count
- final_score
- summary_feedback (기존 필드가 있다면 참조 가능)

### session_snapshot_metric
필수 필드:
- session_id
- metric_key
- avg_score
- avg_raw_value
- min_raw_value
- max_raw_value
- sample_count
- detail(JSONB, 선택)

### session_event
필수 필드:
- session_id
- event_type
- occurred_at
- detail(JSONB, 선택)

### exercise metadata
필수 필드:
- exercise_key
- exercise_name
- allowed_views
- scoring_profile_version
- metric weights

---

## 9. Feature Summarizer 상세 설계

## 9.1 목적
Feature Summarizer는 세션 로그를 LLM 입력용 구조화 컨텍스트로 변환하는 계층이다. 이 계층은 LLM 호출 여부와 무관하게 항상 실행 가능해야 하며, 향후 ML과 RAG가 붙더라도 공통 전처리 레이어로 사용한다.

## 9.2 출력 구조

```json
{
  "analysis_version": "fs_v1",
  "session": {
    "session_id": "string",
    "exercise": "squat",
    "selected_view": "FRONT",
    "duration_sec": 43,
    "rep_count": 1,
    "final_score": 62
  },
  "metrics": [
    {
      "key": "depth",
      "display_name": "스쿼트 깊이",
      "weight": 0.30,
      "avg_score": 30,
      "avg_raw_value": 9,
      "min_raw_value": 9,
      "max_raw_value": 9,
      "sample_count": 1,
      "normalized_severity": 0.72,
      "confidence": 0.45
    }
  ],
  "events": {
    "counts": {
      "NO_PERSON": 7,
      "LOW_SCORE_HINT": 1,
      "REP_COMPLETE": 1
    },
    "durations": {
      "NO_PERSON_SEC": 11.2
    }
  },
  "timeline": {
    "score_points": [
      {"t_sec": 15, "score": 0},
      {"t_sec": 16, "score": 7},
      {"t_sec": 18, "score": 18},
      {"t_sec": 43, "score": 62}
    ],
    "start_score": 0,
    "end_score": 62,
    "improvement_delta": 62,
    "stability_index": 0.38
  },
  "quality": {
    "detected_frame_ratio": 0.73,
    "camera_stability": 0.58,
    "sample_sufficiency": 0.42,
    "rep_sufficiency": 0.20,
    "overall_confidence": 0.49
  },
  "derived": {
    "top_issues": ["knee_alignment", "spine_angle"],
    "likely_camera_issue": true,
    "likely_low_sample_issue": true
  }
}
```

## 9.3 Summarizer 산출 규칙

### 9.3.1 세션 기본 통계
- `duration_sec = ended_at - started_at`
- `rep_count = 완료된 rep 수`
- `final_score = workout_session.final_score`

### 9.3.2 Metric severity 계산
각 metric에 대해 `normalized_severity`를 계산한다.

권장 식:

```text
metric_score_ratio = avg_score / metric_max_score
severity = 1 - metric_score_ratio
weighted_severity = severity * weight
```

설명:
- 점수가 낮을수록 severity가 높다.
- weight를 반영하면 사용자 코칭 우선순위를 정하기 쉽다.

### 9.3.3 Metric confidence 계산
각 metric의 confidence는 아래를 조합한다.

```text
metric_confidence =
  0.5 * min(sample_count / expected_sample_count, 1.0)
+ 0.3 * detected_frame_ratio
+ 0.2 * view_metric_compatibility
```

- `expected_sample_count`: 운동/세션 길이 기준 기대 샘플 수
- `view_metric_compatibility`: 해당 view에서 이 metric 해석 적합도 (0~1)

### 9.3.4 이벤트 집계
- event_type별 count를 계산한다.
- 연속 NO_PERSON 구간이 있으면 총 지속 시간을 계산한다.
- LOW_SCORE_HINT 빈도는 사용자 난이도 체감의 보조 지표로 활용한다.

### 9.3.5 Timeline feature
아래 지표를 계산한다.
- 시작 점수
- 종료 점수
- 최고 점수
- 최저 점수
- 개선량(delta)
- 점수 변동성
- rep 간 상승 패턴
- plateau 여부

### 9.3.6 Quality / Confidence
세션 품질의 핵심 feature는 아래와 같다.

```text
overall_confidence =
  0.35 * detected_frame_ratio
+ 0.20 * camera_stability
+ 0.20 * sample_sufficiency
+ 0.15 * rep_sufficiency
+ 0.10 * view_compatibility
```

#### 구성 요소 정의
- `detected_frame_ratio`: 사람 검출된 프레임 비율
- `camera_stability`: 인식 상태가 급격히 끊기지 않은 정도
- `sample_sufficiency`: metric 계산에 사용된 샘플 수의 충분성
- `rep_sufficiency`: 최소 평가 가능 rep 수 충족 정도
- `view_compatibility`: 선택한 view가 해당 운동의 대표 메트릭 해석에 적합한 정도

### 9.3.7 Top issue 선정
우선순위는 단순히 낮은 점수순이 아니라 다음 기준으로 결정한다.

```text
priority_score =
  0.45 * weighted_severity
+ 0.20 * safety_priority
+ 0.15 * persistence_score
+ 0.10 * actionability
- 0.10 * low_confidence_penalty
```

- `safety_priority`: 무릎 정렬 등 부상 위험 연관도가 높은 메트릭에 가중
- `persistence_score`: 최근 세션에서도 반복된 문제일 경우 증가
- `actionability`: 한두 개의 cue로 바로 교정 가능한 문제에 가산
- `low_confidence_penalty`: 측정 신뢰도가 낮으면 감점

---

## 10. Metric Guide 사전

LLM이 추측하지 않도록 운동별 메트릭 해석 사전을 별도 관리한다.

예시:

```json
{
  "exercise": "squat",
  "metrics": {
    "depth": {
      "display_name": "스쿼트 깊이",
      "meaning": "얼마나 충분히 내려갔는지",
      "low_score_interpretation": "하강 깊이가 부족할 수 있음",
      "coaching_cues": [
        "엉덩이를 뒤로 빼며 내려가세요",
        "허벅지가 바닥과 가까워질 때까지 천천히 내려가세요"
      ],
      "safety_priority": 0.6,
      "actionability": 0.8
    },
    "knee_alignment": {
      "display_name": "무릎 정렬",
      "meaning": "무릎과 발끝 방향의 일치 정도",
      "low_score_interpretation": "무릎이 안쪽 또는 바깥쪽으로 흔들릴 수 있음",
      "coaching_cues": [
        "무릎과 발끝 방향을 맞추세요",
        "내려갈 때 무릎이 안으로 모이지 않게 하세요"
      ],
      "safety_priority": 0.9,
      "actionability": 0.9
    }
  }
}
```

### 10.1 관리 방식
- 파일 기반 JSON 또는 DB 테이블 기반 관리 가능
- 권장: 초기에는 JSON 파일로 시작, 이후 Admin UI 필요 시 DB 이전

### 10.2 버전 관리
- `metric_guide_version` 필드를 분석 결과에 저장한다.
- 버전 변경 시 이전 결과 재현성을 보장해야 한다.

---

## 11. LLM Coaching Layer 상세 설계

## 11.1 목적
Feature Summarizer가 만든 구조화 feature를 바탕으로, 사용자가 이해하기 쉬운 자연어 코칭 리포트를 생성한다.

## 11.2 입력
LLM 입력은 아래 세 부분으로 구성한다.

1. session feature JSON
2. metric guide excerpt
3. generation constraints

## 11.3 출력 JSON schema

```json
{
  "summary": "string",
  "strengths": ["string"],
  "main_issues": [
    {
      "metric_key": "string",
      "title": "string",
      "reason": "string",
      "priority": "high | medium | low"
    }
  ],
  "next_actions": ["string"],
  "camera_issue": {
    "detected": true,
    "reason": "string"
  },
  "confidence": {
    "score": 0.49,
    "label": "low | medium | high",
    "reason": "string"
  },
  "coach_comment": "string"
}
```

## 11.4 프롬프트 정책

### System Prompt 초안

```text
너는 운동 분석 코치다.
입력은 rule-based scoring engine이 생성한 구조화 세션 feature와 metric guide이다.
없는 사실을 추측하지 말고, 입력에 없는 해석은 하지 마라.
의학적 진단을 하지 마라.
카메라/인식 문제와 자세 문제를 구분해서 설명하라.
반드시 JSON schema만 출력하라.
```

### User Prompt 초안

```text
다음 세션 분석 입력을 바탕으로 사용자가 이해하기 쉬운 코칭 리포트를 생성하라.

요구사항:
1. 한 줄 요약 작성
2. 잘한 점 최대 2개
3. 가장 중요한 문제 최대 2개
4. 다음 세션 행동 지침 3개
5. 카메라 문제 여부 설명
6. 분석 신뢰도 설명
7. 모든 판단은 입력 데이터 기반으로만 하라

입력:
{feature_json}

metric guide:
{metric_guide_json}

출력 schema:
{output_schema}
```

## 11.5 출력 제약
- `strengths` 최대 2개
- `main_issues` 최대 2개
- `next_actions` 정확히 3개
- 한 문장은 최대 2문장 길이를 권장
- 추측 표현 금지
- 질병, 부상, 치료 단정 금지

---

## 12. 과거 세션 비교 기능 (선택적 v1.1)

초기 버전에서는 현재 세션만 분석해도 되지만, 확장 시 아래 정보를 retrieval하여 feature에 포함한다.

### 추가 입력
- 동일 운동 최근 5회 평균 점수
- 최근 5회 metric trend
- 반복 발생 issue
- 최근 5회 camera issue 비율

### 추가 출력 예시
- "지난 3회 평균보다 깊이는 개선되었습니다."
- "무릎 정렬 문제는 최근 세션에서도 반복되고 있습니다."

### 주의
- 히스토리 기능은 현재 세션 분석과 분리된 optional block으로 설계한다.
- 히스토리가 없으면 해당 필드는 omit한다.

---

## 13. API 설계

## 13.1 분석 생성 API

### Endpoint
`POST /api/sessions/:sessionId/analyze`

### 목적
- 특정 세션에 대한 feature summarization 및 LLM 분석을 실행한다.

### Response
```json
{
  "sessionId": "uuid",
  "analysisStatus": "queued | processing | completed | failed",
  "analysisId": "uuid"
}
```

## 13.2 분석 조회 API

### Endpoint
`GET /api/sessions/:sessionId/analysis`

### Response
```json
{
  "sessionId": "uuid",
  "analysisStatus": "completed",
  "analysisVersion": "analysis_v1",
  "featureVersion": "fs_v1",
  "llmModel": "gpt-5.4-thinking",
  "result": {
    "summary": "...",
    "strengths": ["..."],
    "main_issues": [],
    "next_actions": [],
    "camera_issue": {
      "detected": true,
      "reason": "..."
    },
    "confidence": {
      "score": 0.49,
      "label": "low",
      "reason": "..."
    },
    "coach_comment": "..."
  }
}
```

## 13.3 재분석 API

### Endpoint
`POST /api/sessions/:sessionId/reanalyze`

### 목적
- prompt 또는 guide version 변경 후 결과를 재생성한다.

---

## 14. DB 설계

## 14.1 신규 테이블: session_analysis

```sql
CREATE TABLE session_analysis (
  analysis_id UUID PRIMARY KEY,
  session_id UUID NOT NULL,
  user_id UUID NOT NULL,
  feature_version VARCHAR(50) NOT NULL,
  analysis_version VARCHAR(50) NOT NULL,
  metric_guide_version VARCHAR(50) NOT NULL,
  llm_model VARCHAR(100),
  status VARCHAR(20) NOT NULL,
  feature_json JSONB NOT NULL,
  llm_output_json JSONB,
  fallback_output_json JSONB,
  confidence_score NUMERIC(4,3),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 컬럼 설명
- `feature_json`: summarizer 출력 원본 저장
- `llm_output_json`: LLM이 생성한 결과 저장
- `fallback_output_json`: LLM 실패 시 fallback 결과 저장
- `status`: queued, processing, completed, failed

## 14.2 선택 테이블: analysis_job_log
운영 추적용 로그 테이블

```sql
CREATE TABLE analysis_job_log (
  job_log_id UUID PRIMARY KEY,
  analysis_id UUID NOT NULL,
  stage VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

---

## 15. 서버 모듈 구조 제안

```text
backend/
  analysis/
    feature-summarizer/
      index.ts
      session-feature-builder.ts
      metric-feature-builder.ts
      event-feature-builder.ts
      quality-score.ts
    metric-guides/
      squat.v1.json
      pushup.v1.json
      plank.v1.json
    llm-coach/
      prompt-builder.ts
      output-schema.ts
      llm-client.ts
      fallback-generator.ts
    repository/
      session-analysis.repository.ts
    controller/
      session-analysis.controller.ts
    service/
      session-analysis.service.ts
```

---

## 16. 주요 인터페이스 정의

## 16.1 TypeScript 타입 예시

```ts
export interface SessionFeature {
  analysisVersion: string;
  session: {
    sessionId: string;
    exercise: string;
    selectedView: string;
    durationSec: number;
    repCount: number;
    finalScore: number;
  };
  metrics: MetricFeature[];
  events: EventFeature;
  timeline: TimelineFeature;
  quality: QualityFeature;
  derived: DerivedFeature;
}

export interface MetricFeature {
  key: string;
  displayName: string;
  weight: number;
  avgScore: number;
  avgRawValue?: number;
  minRawValue?: number;
  maxRawValue?: number;
  sampleCount: number;
  normalizedSeverity: number;
  confidence: number;
}
```

## 16.2 Service 인터페이스

```ts
interface SessionAnalysisService {
  analyzeSession(sessionId: string): Promise<SessionAnalysisResult>;
  getAnalysis(sessionId: string): Promise<SessionAnalysisResult | null>;
  reanalyzeSession(sessionId: string): Promise<SessionAnalysisResult>;
}
```

---

## 17. Fallback Generator 설계

LLM 호출 실패 시 deterministic fallback을 제공한다.

### 17.1 입력
- feature JSON
- metric guide

### 17.2 규칙
- top issue 1~2개를 템플릿 기반으로 설명
- confidence 낮으면 카메라/인식 문제를 우선 언급
- next_actions는 metric guide의 coaching cue에서 상위 3개 선택

### 17.3 예시 출력

```json
{
  "summary": "자세 점수는 보통 수준이지만 측정 신뢰도가 낮았습니다.",
  "strengths": ["동작 완료는 1회 수행되었습니다."],
  "main_issues": [
    {
      "metric_key": "knee_alignment",
      "title": "무릎 정렬 보완 필요",
      "reason": "무릎 정렬 점수가 낮아 흔들림 가능성이 있습니다.",
      "priority": "high"
    }
  ],
  "next_actions": [
    "카메라를 정면에 고정하세요.",
    "무릎과 발끝 방향을 맞추세요.",
    "다음 세트에서는 3회 이상 반복해 보세요."
  ],
  "camera_issue": {
    "detected": true,
    "reason": "사람 인식 끊김이 여러 번 발생했습니다."
  },
  "confidence": {
    "score": 0.42,
    "label": "low",
    "reason": "샘플 수와 검출 안정성이 부족했습니다."
  },
  "coach_comment": "이번 결과는 참고용으로 보시고 카메라 위치를 먼저 조정해 주세요."
}
```

---

## 18. UI 반영 방안

결과 페이지에 아래 블록을 추가한다.

1. AI 한줄 요약
2. 잘한 점
3. 가장 중요한 교정 포인트
4. 다음 세션 체크리스트
5. 분석 신뢰도 배지
6. 카메라/인식 이슈 경고

### 18.1 UI 우선순위
- 최종 점수보다 `가장 먼저 고칠 것 1개`를 상단 배치
- confidence가 낮으면 경고 박스를 점수 위에 배치
- `점수는 낮지만 카메라 문제 가능성 있음`을 분리 표시

---

## 19. 로깅 및 관측성

수집해야 할 운영 지표:
- 분석 요청 수
- 분석 성공률
- 평균 분석 시간
- LLM 호출 실패율
- fallback 발생률
- exercise별 평균 confidence
- camera_issue 탐지율

추가 로그:
- session_id
- analysis_version
- feature_version
- llm_model
- latency_ms
- output_schema_valid

---

## 20. 평가 계획

## 20.1 오프라인 평가
샘플 세션 데이터를 수집해 아래를 검증한다.

### 평가 항목
- 설명 정확성: 실제 metric과 모순되지 않는가
- 우선순위 타당성: top issue 선정이 합리적인가
- actionability: 다음 행동 지침이 구체적인가
- 신뢰도 해석 적절성: camera issue가 있을 때 confidence가 낮아지는가
- 일관성: 동일 입력에서 의미적으로 유사한 결과를 내는가

### 평가 방법
- 팀 내부 2~3인 수동 라벨링
- 세션별 gold explanation 작성 후 비교
- JSON schema validation 자동화

## 20.2 온라인 평가
A/B 테스트 가능 시 아래 지표를 본다.
- 결과 화면 체류 시간
- 재시도율
- 다음 세션 시작률
- 사용자 만족도(간단한 thumbs up/down)

---

## 21. 보안 및 프라이버시

- LLM 입력에는 landmark raw stream 전체를 보내지 않는다.
- 사용자 식별 정보는 최소화한다.
- 외부 LLM 사용 시 session_id는 내부 토큰으로 대체 가능하다.
- 필요 시 민감 필드를 redact한 후 전송한다.

---

## 22. 단계별 구현 계획

## Phase 1. 최소 기능 버전
범위:
- feature summarizer 구현
- metric guide JSON 작성
- LLM prompt builder 구현
- session_analysis 테이블 추가
- 단일 세션 분석 API 구현
- 결과 페이지 표시

완료 기준:
- 스쿼트/푸쉬업/플랭크 3개 운동에 대해 분석 결과 생성 가능
- JSON schema validation 통과
- LLM 실패 시 fallback 정상 동작

## Phase 2. 품질 고도화
범위:
- confidence 계산 보정
- top issue 우선순위 개선
- 카메라 이슈 탐지 정교화
- 최근 5회 비교 feature 추가

완료 기준:
- 동일 운동의 과거 세션 비교 문장 생성 가능
- low confidence 세션 분류 정확도 개선

## Phase 3. 개인화/RAG 확장
범위:
- 사용자 baseline retrieval
- 운동별 FAQ / cue 문서 retrieval
- prompt context 확장

완료 기준:
- 본인 기준 개선/악화 설명 가능
- 운동별 설명 품질 향상

---

## 23. 구현 우선순위

### P0
- session_analysis 테이블
- feature summarizer v1
- metric guide v1
- llm coach v1
- fallback generator v1
- GET analysis API

### P1
- confidence/quality 정교화
- UI confidence badge
- 과거 5회 비교

### P2
- RAG 기반 guide retrieval
- 개인화 baseline
- 분석 결과 피드백 수집 루프

---

## 24. 위험 요소 및 대응

### Risk-1. LLM이 과도하게 추론할 위험
대응:
- metric guide와 schema 제한 사용
- 없는 사실 추측 금지 prompt 추가
- fallback 준비

### Risk-2. camera issue와 posture issue 혼동
대응:
- confidence feature 분리
- NO_PERSON 지속시간 반영
- 낮은 confidence에서는 단정 표현 금지

### Risk-3. 데이터 샘플 수 부족
대응:
- rep_sufficiency 반영
- low sample 세션은 참고용 결과로 표시

### Risk-4. 운동별 metric 확장 시 유지보수 비용 증가
대응:
- metric guide 사전화
- summarizer mapping 분리
- 버전 관리 체계 도입

---

## 25. 예시 시나리오

### 입력 상황
- 운동: squat
- view: FRONT
- duration: 43초
- rep_count: 1
- final_score: 62
- NO_PERSON: 7회
- LOW_SCORE_HINT: 1회
- depth, knee_alignment, spine_angle 저조

### 기대 출력 해석
- 한줄 요약: 깊이와 정렬 보완이 필요하지만 측정 안정성도 낮음
- main issue 1: 무릎 정렬
- main issue 2: 상체 안정성 또는 깊이
- camera_issue: true
- confidence: low 또는 medium-low
- next_actions:
  1. 카메라 재배치
  2. 무릎-발끝 정렬 의식
  3. 다음 세트 3회 이상 반복

---

## 26. 의사코드

```ts
async function analyzeSession(sessionId: string) {
  const session = await repo.getWorkoutSession(sessionId);
  const metrics = await repo.getSessionMetrics(sessionId);
  const events = await repo.getSessionEvents(sessionId);
  const exerciseMeta = await repo.getExerciseMeta(session.exerciseKey);

  const featureJson = buildSessionFeature({
    session,
    metrics,
    events,
    exerciseMeta,
  });

  const guide = loadMetricGuide(session.exerciseKey, "v1");

  let output;
  try {
    output = await llmCoach.generate({ featureJson, guide });
    validateOutputSchema(output);
  } catch (err) {
    output = generateFallback({ featureJson, guide });
  }

  return await repo.saveSessionAnalysis({
    sessionId,
    featureJson,
    output,
    confidenceScore: featureJson.quality.overall_confidence,
  });
}
```

---

## 27. 최종 요약

본 설계는 현재의 rule-based scoring 구조를 유지하면서, 운동 종료 후 분석 레이어를 추가하는 방식이다. 핵심은 **LLM을 점수 계산기가 아니라 해석기**로 사용하고, 그 앞단에 deterministic한 **Feature Summarizer**를 두는 것이다. 이 구조는 설명 가능성, 유지보수성, 확장성 측면에서 적절하며, 향후 RAG, personalization, ML calibration으로 자연스럽게 확장 가능하다.

