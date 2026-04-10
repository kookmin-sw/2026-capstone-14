-- =========================================================
-- DB 초기화 스크립트
-- PostgreSQL
-- =========================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- 1. 사용자 / 공통 운영
-- =========================================================

CREATE TABLE app_user (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    login_id VARCHAR(100) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    nickname VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
);

CREATE TABLE user_settings (
    user_id UUID PRIMARY KEY
        REFERENCES app_user(user_id) ON DELETE CASCADE,
    theme VARCHAR(20) NOT NULL DEFAULT 'system',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- 2. 운동 메타데이터
-- =========================================================

CREATE TABLE exercise (
    exercise_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INT NOT NULL DEFAULT 0,
    default_target_type VARCHAR(10) NOT NULL,
    thumbnail_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE exercise_allowed_view (
    exercise_id BIGINT NOT NULL
        REFERENCES exercise(exercise_id) ON DELETE CASCADE,
    view_code VARCHAR(20) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (exercise_id, view_code)
);

-- =========================================================
-- 3. 루틴 템플릿
-- =========================================================

CREATE TABLE routine (
    routine_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL
        REFERENCES app_user(user_id),
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE routine_setup (
    step_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    routine_id BIGINT NOT NULL
        REFERENCES routine(routine_id) ON DELETE CASCADE,
    order_no INT NOT NULL,
    exercise_id BIGINT NOT NULL
        REFERENCES exercise(exercise_id),
    target_type VARCHAR(10) NOT NULL,
    target_value INT NOT NULL,
    rest_sec INT NOT NULL DEFAULT 0,
    sets INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_routine_setup_routine_order
        UNIQUE (routine_id, order_no)
);

-- =========================================================
-- 4. 루틴 실제 실행 계층
-- =========================================================

CREATE TABLE routine_instance (
    routine_instance_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    routine_id BIGINT NOT NULL
        REFERENCES routine(routine_id),
    user_id UUID NOT NULL
        REFERENCES app_user(user_id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL,
    total_score NUMERIC(6,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE routine_step_instance (
    step_instance_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    routine_instance_id BIGINT NOT NULL
        REFERENCES routine_instance(routine_instance_id) ON DELETE CASCADE,
    step_id BIGINT NOT NULL
        REFERENCES routine_setup(step_id),
    exercise_id BIGINT NOT NULL
        REFERENCES exercise(exercise_id),
    order_no INT NOT NULL,
    target_type_snapshot VARCHAR(10) NOT NULL,
    target_value_snapshot INT NOT NULL,
    planned_sets INT NOT NULL,
    completed_sets INT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- 5. 세트 계층
-- =========================================================

CREATE TABLE workout_set (
    set_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    step_instance_id BIGINT NOT NULL
        REFERENCES routine_step_instance(step_instance_id) ON DELETE CASCADE,
    set_no INT NOT NULL,
    target_type VARCHAR(10) NOT NULL,
    target_value INT NOT NULL,
    actual_value INT,
    value_unit VARCHAR(10) NOT NULL,
    result_basis VARCHAR(10) NOT NULL,
    score NUMERIC(6,2),
    is_success BOOLEAN,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    duration_sec INT,
    rest_sec_after INT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_workout_set_step_set_no
        UNIQUE (step_instance_id, set_no)
);

-- =========================================================
-- 6. 실제 채점 세션
-- =========================================================

CREATE TABLE workout_session (
    session_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL
        REFERENCES app_user(user_id),
    exercise_id BIGINT NOT NULL
        REFERENCES exercise(exercise_id),
    set_id BIGINT
        REFERENCES workout_set(set_id) ON DELETE SET NULL,
    mode VARCHAR(10) NOT NULL,
    status VARCHAR(20) NOT NULL,
    selected_view VARCHAR(20) NOT NULL,
    result_basis VARCHAR(10),
    total_result_value INT,
    total_result_unit VARCHAR(10),
    final_score NUMERIC(6,2),
    summary_feedback TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- 7. 세션 전체 점수 스냅샷 저장
-- =========================================================

CREATE TABLE session_snapshot (
    session_snapshot_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id BIGINT NOT NULL
        REFERENCES workout_session(session_id) ON DELETE CASCADE,
    snapshot_no INT NOT NULL,
    snapshot_type VARCHAR(10) NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_session_snapshot_session_snapshot_no
        UNIQUE (session_id, snapshot_no)
);

CREATE TABLE session_snapshot_score (
    session_snapshot_id BIGINT PRIMARY KEY
        REFERENCES session_snapshot(session_snapshot_id) ON DELETE CASCADE,
    score NUMERIC(6,2),
    result_basis VARCHAR(10),
    result_value INT,
    result_unit VARCHAR(10),
    summary_feedback TEXT,
    detail JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE session_snapshot_metric (
    session_snapshot_metric_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_snapshot_id BIGINT NOT NULL
        REFERENCES session_snapshot(session_snapshot_id) ON DELETE CASCADE,
    metric_key VARCHAR(100) NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    avg_score NUMERIC(6,2),
    avg_raw_value DOUBLE PRECISION,
    min_raw_value DOUBLE PRECISION,
    max_raw_value DOUBLE PRECISION,
    sample_count INT NOT NULL DEFAULT 0,
    detail JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- 8. 세션 이벤트
-- =========================================================

CREATE TABLE session_event (
    event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id BIGINT NOT NULL
        REFERENCES workout_session(session_id) ON DELETE CASCADE,
    event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- 9. 퀘스트 / 포인트 / 티어
-- =========================================================

CREATE TABLE tier_rule (
    tier INT PRIMARY KEY,
    min_points INT NOT NULL,
    name VARCHAR(50) NOT NULL
);

CREATE TABLE quest_template (
    quest_template_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    scope VARCHAR(10) NOT NULL,
    type VARCHAR(20) NOT NULL,
    category VARCHAR(30) NOT NULL DEFAULT 'GENERAL',
    difficulty VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    title VARCHAR(255) NOT NULL,
    condition JSONB NOT NULL DEFAULT '{}'::JSONB,
    reward_points INT NOT NULL,
    min_tier INT
        REFERENCES tier_rule(tier),
    max_tier INT
        REFERENCES tier_rule(tier),
    selection_weight INT NOT NULL DEFAULT 100,
    cooldown_days INT NOT NULL DEFAULT 0,
    exclusive_group VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_quest_template_tier_range
        CHECK (min_tier IS NULL OR max_tier IS NULL OR min_tier <= max_tier),
    CONSTRAINT ck_quest_template_selection_weight
        CHECK (selection_weight > 0),
    CONSTRAINT ck_quest_template_cooldown_days
        CHECK (cooldown_days >= 0)
);

CREATE TABLE quest_assignment_rule (
    rule_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    scope VARCHAR(10) NOT NULL,
    slot_no INT NOT NULL,
    category VARCHAR(30) NOT NULL,
    type VARCHAR(20) NOT NULL,
    count INT NOT NULL,
    min_tier INT
        REFERENCES tier_rule(tier),
    max_tier INT
        REFERENCES tier_rule(tier),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT ck_quest_assignment_rule_count_positive
        CHECK (count > 0),
    CONSTRAINT ck_quest_assignment_rule_tier_range
        CHECK (min_tier IS NULL OR max_tier IS NULL OR min_tier <= max_tier)
);

CREATE TABLE user_quest (
    user_quest_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL
        REFERENCES app_user(user_id),
    quest_template_id BIGINT NOT NULL
        REFERENCES quest_template(quest_template_id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    status VARCHAR(20) NOT NULL,
    progress JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_quest_user_template_period
        UNIQUE (user_id, quest_template_id, period_start, period_end)
);

CREATE TABLE point_ledger (
    ledger_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL
        REFERENCES app_user(user_id),
    source_type VARCHAR(20) NOT NULL,
    source_id BIGINT,
    points INT NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- source_id가 있는 경우: 같은 source 재적립 방지
CREATE UNIQUE INDEX uq_point_ledger_user_source_nonnull
    ON point_ledger (user_id, source_type, source_id)
    WHERE source_id IS NOT NULL;

-- source_id가 없는 경우: 같은 source_type 중복 적립 방지
CREATE UNIQUE INDEX uq_point_ledger_user_source_null
    ON point_ledger (user_id, source_type)
    WHERE source_id IS NULL;

-- =========================================================
-- 인덱스
-- =========================================================

CREATE INDEX idx_routine_user_id
    ON routine (user_id);

CREATE INDEX idx_routine_setup_exercise_id
    ON routine_setup (exercise_id);

CREATE INDEX idx_routine_instance_user_id
    ON routine_instance (user_id);

CREATE INDEX idx_routine_step_instance_routine_instance_id
    ON routine_step_instance (routine_instance_id);

CREATE INDEX idx_routine_step_instance_exercise_id
    ON routine_step_instance (exercise_id);

CREATE INDEX idx_workout_set_step_instance_id
    ON workout_set (step_instance_id);

CREATE INDEX idx_workout_session_user_id
    ON workout_session (user_id);

CREATE INDEX idx_workout_session_exercise_id
    ON workout_session (exercise_id);

CREATE INDEX idx_workout_session_set_id
    ON workout_session (set_id);

CREATE INDEX idx_session_snapshot_session_id
    ON session_snapshot (session_id);

CREATE INDEX idx_session_snapshot_recorded_at
    ON session_snapshot (recorded_at);

CREATE INDEX idx_session_snapshot_metric_snapshot_id
    ON session_snapshot_metric (session_snapshot_id);

CREATE INDEX idx_session_event_session_id_event_time
    ON session_event (session_id, event_time);

CREATE INDEX idx_quest_template_scope_active
    ON quest_template (scope, is_active);

CREATE INDEX idx_quest_template_scope_category_type_active
    ON quest_template (scope, category, type, is_active);

CREATE INDEX idx_quest_template_tier_range
    ON quest_template (min_tier, max_tier);

CREATE INDEX idx_quest_assignment_rule_scope_active_slot
    ON quest_assignment_rule (scope, is_active, slot_no);

CREATE INDEX idx_quest_assignment_rule_tier_range
    ON quest_assignment_rule (min_tier, max_tier);

CREATE INDEX idx_user_quest_user_id_period
    ON user_quest (user_id, period_start, period_end);

CREATE INDEX idx_user_quest_user_template_period_start
    ON user_quest (user_id, quest_template_id, period_start);

CREATE INDEX idx_point_ledger_user_id_created_at
    ON point_ledger (user_id, created_at);

CREATE UNIQUE INDEX uq_quest_assignment_rule_scope_slot_tier
    ON quest_assignment_rule (
        scope,
        slot_no,
        COALESCE(min_tier, -1),
        COALESCE(max_tier, -1)
    );

-- 운동 메타데이터는 서버 런타임의 exercise catalog sync가
-- public/js/workout/exercises 디렉터리를 스캔해 자동 생성한다.
