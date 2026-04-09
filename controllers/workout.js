const { supabase } = require('../config/db');
const { updateQuestProgress } = require('./quest');
const {
    normalizePhaseDataset,
    mergePhaseLabelsIntoDetail,
    buildPhaseDatasetExport
} = require('../utils/phase-dataset');

const SESSION_STALE_HOURS = 12;

const SCORING_PROFILE_SELECT = `
    scoring_profile_id,
    exercise_id,
    version,
    name,
    scoring_profile_metric (
        weight,
        max_score,
        rule,
        order_no,
        metric:metric_id (
            metric_id,
            key,
            title,
            description,
            unit
        )
    )
`;

const createApiError = (statusCode, message) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const sendApiError = (res, error, fallbackMessage = '요청 처리 중 오류가 발생했습니다.') => {
    const statusCode = error?.statusCode || 500;
    return res.status(statusCode).json({
        success: false,
        error: error?.message || fallbackMessage
    });
};

const sortProfileMetrics = (profile) => {
    if (!profile || !Array.isArray(profile.scoring_profile_metric)) return profile;
    profile.scoring_profile_metric.sort((a, b) => (a.order_no || 0) - (b.order_no || 0));
    return profile;
};

const toNonNegativeInt = (value, fallback = 0) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.round(parsed));
};

const toBoundedScore = (value, fallback = 0) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(100, Math.round(parsed)));
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const getRoutineWithSteps = async (routineId, userId) => {
    const { data: routine, error } = await supabase
        .from('routine')
        .select(`
            routine_id,
            name,
            routine_setup (
                step_id,
                order_no,
                target_type,
                target_value,
                rest_sec,
                sets,
                exercise:exercise_id (
                    exercise_id,
                    code,
                    name,
                    description
                )
            )
        `)
        .eq('routine_id', routineId)
        .eq('user_id', userId)
        .eq('is_active', true)
        .single();

    if (error || !routine) {
        throw createApiError(404, '루틴을 찾을 수 없습니다.');
    }

    routine.routine_setup = (routine.routine_setup || []).sort(
        (a, b) => (a.order_no || 0) - (b.order_no || 0)
    );

    if (routine.routine_setup.length === 0) {
        throw createApiError(400, '루틴에 운동 단계가 없습니다.');
    }

    return routine;
};

const getActiveScoringProfile = async (exerciseId, scoringProfileId = null) => {
    let query = supabase
        .from('scoring_profile')
        .select(SCORING_PROFILE_SELECT)
        .eq('exercise_id', exerciseId)
        .eq('is_active', true);

    if (scoringProfileId) {
        query = query.eq('scoring_profile_id', scoringProfileId);
    }

    const { data: profile, error } = await query.single();
    if (error || !profile) {
        throw createApiError(400, '해당 운동의 활성 채점 프로필을 찾을 수 없습니다.');
    }

    return sortProfileMetrics(profile);
};

const getActiveScoringProfilesByExerciseIds = async (exerciseIds) => {
    if (!exerciseIds.length) return new Map();

    const { data: profiles, error } = await supabase
        .from('scoring_profile')
        .select(SCORING_PROFILE_SELECT)
        .in('exercise_id', exerciseIds)
        .eq('is_active', true);

    if (error) {
        throw createApiError(500, '루틴 채점 프로필을 불러오지 못했습니다.');
    }

    const byExercise = new Map();
    for (const profile of profiles || []) {
        byExercise.set(profile.exercise_id, sortProfileMetrics(profile));
    }
    return byExercise;
};

const cleanupStaleOpenSessions = async (userId) => {
    const thresholdIso = new Date(Date.now() - SESSION_STALE_HOURS * 60 * 60 * 1000).toISOString();

    const { data: staleSessions, error } = await supabase
        .from('workout_session')
        .select('session_id, routine_instance_id')
        .eq('user_id', userId)
        .is('ended_at', null)
        .lt('started_at', thresholdIso);

    if (error) {
        throw createApiError(500, '기존 세션 정리 중 오류가 발생했습니다.');
    }

    if (!staleSessions || staleSessions.length === 0) return;

    const sessionIds = staleSessions.map((session) => session.session_id);
    const routineInstanceIds = [...new Set(
        staleSessions
            .map((session) => session.routine_instance_id)
            .filter(Boolean)
    )];

    const nowIso = new Date().toISOString();

    const { error: deleteMetricError } = await supabase
        .from('session_metric_result')
        .delete()
        .in('session_id', sessionIds);
    if (deleteMetricError) {
        throw createApiError(500, '오래된 세션 메트릭 정리 중 오류가 발생했습니다.');
    }

    const { error: deleteSetError } = await supabase
        .from('workout_set')
        .delete()
        .in('session_id', sessionIds);
    if (deleteSetError) {
        throw createApiError(500, '오래된 세트 정리 중 오류가 발생했습니다.');
    }

    const { error: deleteEventError } = await supabase
        .from('session_event')
        .delete()
        .in('session_id', sessionIds);
    if (deleteEventError) {
        throw createApiError(500, '오래된 이벤트 정리 중 오류가 발생했습니다.');
    }

    const { error: deleteSessionError } = await supabase
        .from('workout_session')
        .delete()
        .in('session_id', sessionIds);
    if (deleteSessionError) {
        throw createApiError(500, '오래된 세션 정리 중 오류가 발생했습니다.');
    }

    if (routineInstanceIds.length > 0) {
        const { error: routineAbortError } = await supabase
            .from('routine_instance')
            .update({
                ended_at: nowIso,
                status: 'ABORTED'
            })
            .in('routine_instance_id', routineInstanceIds)
            .eq('status', 'RUNNING');

        if (routineAbortError) {
            throw createApiError(500, '오래된 루틴 인스턴스 정리 중 오류가 발생했습니다.');
        }
    }
};

const normalizeMetricResults = (metricResults, sessionId) => {
    if (!Array.isArray(metricResults) || metricResults.length === 0) return [];

    return metricResults
        .map((metric) => {
            const metricId = typeof metric?.metric_id === 'string' ? metric.metric_id : null;
            if (!metricId) return null;

            const score = toNonNegativeInt(metric.score, 0);
            const raw = metric.raw == null ? null : Math.round(Number(metric.raw));

            return {
                session_id: sessionId,
                metric_id: metricId,
                score,
                raw: Number.isFinite(raw) ? raw : null
            };
        })
        .filter(Boolean);
};

const normalizeSetRecords = (setRecords, sessionId, fallbackReps, fallbackDuration) => {
    const inputRows = Array.isArray(setRecords) ? setRecords : [];
    const normalizedRows = inputRows
        .map((setRecord, index) => {
            const phase = setRecord?.phase === 'REST' ? 'REST' : 'WORK';
            const setNo = Math.max(1, toNonNegativeInt(setRecord?.set_no, index + 1));
            const targetReps = setRecord?.target_reps == null ? null : toNonNegativeInt(setRecord.target_reps, 0);
            const actualReps = toNonNegativeInt(setRecord?.actual_reps, 0);
            const durationSec = setRecord?.duration_sec == null ? null : toNonNegativeInt(setRecord.duration_sec, 0);

            return {
                session_id: sessionId,
                set_no: setNo,
                phase,
                target_reps: targetReps,
                actual_reps: actualReps,
                duration_sec: durationSec
            };
        })
        .filter(Boolean);

    if (normalizedRows.length > 0) return normalizedRows;

    return [{
        session_id: sessionId,
        set_no: 1,
        phase: 'WORK',
        target_reps: null,
        actual_reps: toNonNegativeInt(fallbackReps, 0),
        duration_sec: toNonNegativeInt(fallbackDuration, 0)
    }];
};

const normalizeEvents = (events, sessionId, startedAtIso) => {
    if (!Array.isArray(events) || events.length === 0) return [];

    const sessionStartMs = new Date(startedAtIso).getTime();
    const nowIso = new Date().toISOString();

    return events
        .map((event) => {
            const type = typeof event?.type === 'string' ? event.type.trim() : '';
            if (!type) return null;

            const timestampMs = Number(event?.timestamp);
            const hasRelativeTimestamp = Number.isFinite(timestampMs) && timestampMs >= 0;
            const eventTime = hasRelativeTimestamp
                ? new Date(sessionStartMs + Math.round(timestampMs)).toISOString()
                : nowIso;

            return {
                session_id: sessionId,
                type: type.slice(0, 120),
                payload: event?.payload ?? null,
                event_time: eventTime
            };
        })
        .filter(Boolean);
};

const buildSafeDetail = (detail, setRows, eventRows) => {
    const source = isPlainObject(detail) ? detail : {};
    const setRecords = setRows.map((setRow) => ({
        set_no: setRow.set_no,
        phase: setRow.phase,
        target_reps: setRow.target_reps,
        actual_reps: setRow.actual_reps,
        duration_sec: setRow.duration_sec
    }));
    const events = eventRows.map((eventRow) => ({
        type: eventRow.type,
        payload: eventRow.payload,
        event_time: eventRow.event_time
    }));

    const safeDetail = {
        ...source,
        set_records: setRecords,
        events,
        save_meta: {
            saved_at: new Date().toISOString(),
            schema_version: 2
        }
    };

    const phaseDatasetSource = source.phase_dataset || source.ml_phase_dataset;
    if (phaseDatasetSource) {
        safeDetail.phase_dataset = normalizePhaseDataset(phaseDatasetSource);
    }

    return safeDetail;
};

const getOwnedSession = async (sessionId, userId) => {
    const { data: session, error } = await supabase
        .from('workout_session')
        .select(`
            session_id,
            user_id,
            exercise_id,
            routine_instance_id,
            started_at,
            ended_at,
            exercise:exercise_id (
                code,
                name
            )
        `)
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .single();

    if (error || !session) {
        throw createApiError(404, '세션을 찾을 수 없습니다.');
    }

    return session;
};

const getOwnedSessionWithDetail = async (sessionId, userId) => {
    const { data: session, error } = await supabase
        .from('workout_session')
        .select(`
            session_id,
            user_id,
            started_at,
            ended_at,
            detail,
            exercise:exercise_id (
                code,
                name
            )
        `)
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .single();

    if (error || !session) {
        throw createApiError(404, '세션을 찾을 수 없습니다.');
    }

    return session;
};

const assertSessionWritable = async (sessionId, userId) => {
    const session = await getOwnedSession(sessionId, userId);
    if (session.ended_at) {
        throw createApiError(409, '이미 종료된 세션입니다.');
    }
    return session;
};

// 자유 운동 목록 페이지
const getFreeWorkoutPage = async (req, res, next) => {
    try {
        const { data: exercises, error } = await supabase
            .from('exercise')
            .select('exercise_id, code, name, description')
            .eq('is_active', true)
            .order('name');

        if (error) throw error;

        res.render('workout/free', {
            title: '자유 운동',
            activeTab: 'workout',
            exercises: exercises || []
        });
    } catch (error) {
        next(error);
    }
};

// 자유 운동 세션 페이지
const getFreeWorkoutSession = async (req, res, next) => {
    try {
        const { exerciseCode } = req.params;

        const { data: exercise, error: exerciseError } = await supabase
            .from('exercise')
            .select('exercise_id, code, name, description')
            .eq('code', exerciseCode)
            .eq('is_active', true)
            .single();

        if (exerciseError || !exercise) {
            return res.redirect('/workout/free?error=운동을 찾을 수 없습니다');
        }

        const scoringProfile = await getActiveScoringProfile(exercise.exercise_id);

        res.render('workout/session', {
            title: `${exercise.name} - 자유 운동`,
            activeTab: 'workout',
            mode: 'FREE',
            exercise,
            scoringProfile,
            routine: null,
            routineInstance: null,
            query: req.query,
            layout: 'layouts/workout'
        });
    } catch (error) {
        next(error);
    }
};

// 루틴 운동 세션 페이지
const getRoutineWorkoutSession = async (req, res, next) => {
    try {
        const { routineId } = req.params;
        const userId = req.user.user_id;
        const routine = await getRoutineWithSteps(routineId, userId);

        const exerciseIds = [...new Set(
            routine.routine_setup
                .map((step) => step.exercise?.exercise_id)
                .filter(Boolean)
        )];
        const profilesByExercise = await getActiveScoringProfilesByExerciseIds(exerciseIds);

        routine.routine_setup = routine.routine_setup.map((step) => ({
            ...step,
            scoring_profile: profilesByExercise.get(step.exercise?.exercise_id) || null
        }));

        const firstStep = routine.routine_setup[0];
        if (!firstStep?.exercise || !firstStep?.scoring_profile) {
            return res.redirect('/routine?error=루틴 시작에 필요한 채점 프로필이 없습니다');
        }

        res.render('workout/session', {
            title: `${routine.name} - 루틴 운동`,
            activeTab: 'workout',
            mode: 'ROUTINE',
            exercise: firstStep.exercise,
            scoringProfile: firstStep.scoring_profile,
            routine,
            routineInstance: null,
            query: req.query,
            layout: 'layouts/workout'
        });
    } catch (error) {
        next(error);
    }
};

// 운동 세션 시작 API
const startWorkoutSession = async (req, res) => {
    try {
        const userId = req.user.user_id;
        const mode = req.body?.mode === 'ROUTINE' ? 'ROUTINE' : 'FREE';
        let { exercise_id: exerciseId, scoring_profile_id: scoringProfileId } = req.body || {};
        let routineInstance = null;

        await cleanupStaleOpenSessions(userId);

        if (!exerciseId) {
            throw createApiError(400, 'exercise_id는 필수입니다.');
        }

        const { data: exercise, error: exerciseError } = await supabase
            .from('exercise')
            .select('exercise_id, is_active')
            .eq('exercise_id', exerciseId)
            .single();

        if (exerciseError || !exercise || !exercise.is_active) {
            throw createApiError(400, '유효하지 않은 운동입니다.');
        }

        if (mode === 'ROUTINE') {
            const routineId = req.body?.routine_id;
            if (!routineId) {
                throw createApiError(400, '루틴 모드에서는 routine_id가 필요합니다.');
            }

            const routine = await getRoutineWithSteps(routineId, userId);
            const firstStep = routine.routine_setup[0];
            const firstExerciseId = firstStep?.exercise?.exercise_id;

            if (!firstExerciseId) {
                throw createApiError(400, '루틴 첫 단계 운동 정보가 없습니다.');
            }

            if (exerciseId !== firstExerciseId) {
                throw createApiError(400, '루틴 첫 단계 운동과 요청된 운동이 일치하지 않습니다.');
            }

            const scoringProfile = await getActiveScoringProfile(firstExerciseId, scoringProfileId || null);
            scoringProfileId = scoringProfile.scoring_profile_id;

            const { data: createdRoutineInstance, error: routineInstanceError } = await supabase
                .from('routine_instance')
                .insert({ routine_id: routineId })
                .select()
                .single();

            if (routineInstanceError || !createdRoutineInstance) {
                throw createApiError(500, '루틴 인스턴스 생성에 실패했습니다.');
            }

            routineInstance = createdRoutineInstance;
        } else {
            if (!scoringProfileId) {
                throw createApiError(400, 'scoring_profile_id는 필수입니다.');
            }

            await getActiveScoringProfile(exerciseId, scoringProfileId);
        }

        const sessionData = {
            user_id: userId,
            exercise_id: exerciseId,
            scoring_profile_id: scoringProfileId,
            mode
        };

        if (routineInstance?.routine_instance_id) {
            sessionData.routine_instance_id = routineInstance.routine_instance_id;
        }

        const { data: session, error: sessionError } = await supabase
            .from('workout_session')
            .insert(sessionData)
            .select()
            .single();

        if (sessionError || !session) {
            throw createApiError(500, '운동 세션 생성에 실패했습니다.');
        }

        return res.json({
            success: true,
            session,
            routineInstance
        });
    } catch (error) {
        return sendApiError(res, error, '운동 세션 시작에 실패했습니다.');
    }
};

// 운동 세션 종료 API
const endWorkoutSession = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.user_id;
        const {
            duration_sec: durationSec,
            total_reps: totalReps,
            final_score: finalScore,
            summary_feedback: summaryFeedback,
            detail,
            exercise_code: exerciseCode,
            sets,
            metric_results: metricResults,
            set_records: setRecords,
            events
        } = req.body || {};

        const session = await getOwnedSession(sessionId, userId);
        if (session.ended_at) {
            if (session.routine_instance_id) {
                await supabase
                    .from('routine_instance')
                    .update({
                        status: 'DONE',
                        ended_at: session.ended_at,
                        total_score: toBoundedScore(finalScore, 0)
                    })
                    .eq('routine_instance_id', session.routine_instance_id)
                    .eq('status', 'RUNNING');
            }

            return res.json({
                success: true,
                alreadyEnded: true,
                session
            });
        }

        const now = Date.now();
        const fallbackDuration = toNonNegativeInt(
            Math.round((now - new Date(session.started_at).getTime()) / 1000),
            0
        );

        const safeDurationSec = toNonNegativeInt(durationSec, fallbackDuration);
        const safeTotalReps = toNonNegativeInt(totalReps, 0);
        const safeFinalScore = toBoundedScore(finalScore, 0);
        const safeSummaryFeedback = typeof summaryFeedback === 'string'
            ? summaryFeedback.trim().slice(0, 2000)
            : null;

        const normalizedMetricRows = normalizeMetricResults(metricResults, sessionId);
        const normalizedSetRows = normalizeSetRecords(
            setRecords,
            sessionId,
            safeTotalReps,
            safeDurationSec
        );
        const normalizedEventRows = normalizeEvents(events, sessionId, session.started_at);
        const safeDetail = buildSafeDetail(detail, normalizedSetRows, normalizedEventRows);
        const endedAtIso = new Date().toISOString();

        // 기존 하위 레코드 정리 후 재삽입 (재시도 시 중복 방지)
        const { error: deleteMetricError } = await supabase
            .from('session_metric_result')
            .delete()
            .eq('session_id', sessionId);
        if (deleteMetricError) {
            throw createApiError(500, '기존 메트릭 정리 중 오류가 발생했습니다.');
        }

        if (normalizedMetricRows.length > 0) {
            const { error: insertMetricError } = await supabase
                .from('session_metric_result')
                .upsert(normalizedMetricRows, { onConflict: 'session_id,metric_id' });
            if (insertMetricError) {
                throw createApiError(500, '메트릭 저장 중 오류가 발생했습니다.');
            }
        }

        const { error: deleteSetError } = await supabase
            .from('workout_set')
            .delete()
            .eq('session_id', sessionId);
        if (deleteSetError) {
            throw createApiError(500, '기존 세트 정리 중 오류가 발생했습니다.');
        }

        if (normalizedSetRows.length > 0) {
            const { error: insertSetError } = await supabase
                .from('workout_set')
                .insert(normalizedSetRows);
            if (insertSetError) {
                throw createApiError(500, '세트 저장 중 오류가 발생했습니다.');
            }
        }

        const { error: deleteEventError } = await supabase
            .from('session_event')
            .delete()
            .eq('session_id', sessionId);
        if (deleteEventError) {
            throw createApiError(500, '기존 이벤트 정리 중 오류가 발생했습니다.');
        }

        if (normalizedEventRows.length > 0) {
            const { error: insertEventError } = await supabase
                .from('session_event')
                .insert(normalizedEventRows);
            if (insertEventError) {
                throw createApiError(500, '이벤트 저장 중 오류가 발생했습니다.');
            }
        }

        const { data: updatedSession, error: updateSessionError } = await supabase
            .from('workout_session')
            .update({
                ended_at: endedAtIso,
                duration_sec: safeDurationSec,
                total_reps: safeTotalReps,
                final_score: safeFinalScore,
                summary_feedback: safeSummaryFeedback,
                detail: safeDetail
            })
            .eq('session_id', sessionId)
            .eq('user_id', userId)
            .select(`
                *,
                exercise:exercise_id (code, name)
            `)
            .single();

        if (updateSessionError || !updatedSession) {
            throw createApiError(500, '세션 종료 저장에 실패했습니다.');
        }

        if (updatedSession.routine_instance_id) {
            const { error: updateRoutineInstanceError } = await supabase
                .from('routine_instance')
                .update({
                    ended_at: endedAtIso,
                    status: 'DONE',
                    total_score: safeFinalScore
                })
                .eq('routine_instance_id', updatedSession.routine_instance_id);

            if (updateRoutineInstanceError) {
                throw createApiError(500, '루틴 인스턴스 완료 처리에 실패했습니다.');
            }
        }

        try {
            await updateQuestProgress(userId, {
                exercise_code: updatedSession.exercise?.code || exerciseCode,
                duration_sec: safeDurationSec,
                total_reps: safeTotalReps,
                final_score: safeFinalScore,
                sets: sets || normalizedSetRows.length
            });
        } catch (questError) {
            console.error('Quest progress update failed:', questError);
        }

        return res.json({
            success: true,
            session: updatedSession
        });
    } catch (error) {
        return sendApiError(res, error, '운동 종료 저장에 실패했습니다.');
    }
};

// 운동 세션 중단 API
const abortWorkoutSession = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.user_id;
        const session = await getOwnedSession(sessionId, userId);

        if (session.ended_at) {
            return res.json({
                success: true,
                alreadyEnded: true
            });
        }

        const { error: deleteMetricError } = await supabase
            .from('session_metric_result')
            .delete()
            .eq('session_id', sessionId);
        if (deleteMetricError) {
            throw createApiError(500, '세션 중단 중 메트릭 정리에 실패했습니다.');
        }

        const { error: deleteSetError } = await supabase
            .from('workout_set')
            .delete()
            .eq('session_id', sessionId);
        if (deleteSetError) {
            throw createApiError(500, '세션 중단 중 세트 정리에 실패했습니다.');
        }

        const { error: deleteEventError } = await supabase
            .from('session_event')
            .delete()
            .eq('session_id', sessionId);
        if (deleteEventError) {
            throw createApiError(500, '세션 중단 중 이벤트 정리에 실패했습니다.');
        }

        const { error: deleteSessionError } = await supabase
            .from('workout_session')
            .delete()
            .eq('session_id', sessionId)
            .eq('user_id', userId);
        if (deleteSessionError) {
            throw createApiError(500, '세션 중단 처리에 실패했습니다.');
        }

        if (session.routine_instance_id) {
            const { error: routineAbortError } = await supabase
                .from('routine_instance')
                .update({
                    ended_at: new Date().toISOString(),
                    status: 'ABORTED'
                })
                .eq('routine_instance_id', session.routine_instance_id)
                .eq('status', 'RUNNING');

            if (routineAbortError) {
                throw createApiError(500, '루틴 중단 처리에 실패했습니다.');
            }
        }

        return res.json({
            success: true,
            aborted: true
        });
    } catch (error) {
        return sendApiError(res, error, '세션 중단에 실패했습니다.');
    }
};

// 운동 세트 기록 API
const recordWorkoutSet = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.user_id;
        await assertSessionWritable(sessionId, userId);

        const phase = req.body?.phase === 'REST' ? 'REST' : 'WORK';
        const setNo = Math.max(1, toNonNegativeInt(req.body?.set_no, 1));
        const targetReps = req.body?.target_reps == null ? null : toNonNegativeInt(req.body.target_reps, 0);
        const actualReps = toNonNegativeInt(req.body?.actual_reps, 0);
        const durationSec = req.body?.duration_sec == null ? null : toNonNegativeInt(req.body.duration_sec, 0);

        const { data: workoutSet, error } = await supabase
            .from('workout_set')
            .insert({
                session_id: sessionId,
                set_no: setNo,
                phase,
                target_reps: targetReps,
                actual_reps: actualReps,
                duration_sec: durationSec
            })
            .select()
            .single();

        if (error || !workoutSet) {
            throw createApiError(500, '세트 저장에 실패했습니다.');
        }

        return res.json({ success: true, workoutSet });
    } catch (error) {
        return sendApiError(res, error, '세트 저장에 실패했습니다.');
    }
};

// 세션 이벤트 기록 API
const recordSessionEvent = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.user_id;
        const session = await assertSessionWritable(sessionId, userId);

        const type = typeof req.body?.type === 'string' ? req.body.type.trim() : '';
        if (!type) {
            throw createApiError(400, 'type은 필수입니다.');
        }

        const timestampMs = Number(req.body?.timestamp);
        const hasRelativeTimestamp = Number.isFinite(timestampMs) && timestampMs >= 0;
        const eventTime = hasRelativeTimestamp
            ? new Date(new Date(session.started_at).getTime() + Math.round(timestampMs)).toISOString()
            : new Date().toISOString();

        const { data: event, error } = await supabase
            .from('session_event')
            .insert({
                session_id: sessionId,
                type: type.slice(0, 120),
                payload: req.body?.payload ?? null,
                event_time: eventTime
            })
            .select()
            .single();

        if (error || !event) {
            throw createApiError(500, '이벤트 저장에 실패했습니다.');
        }

        return res.json({ success: true, event });
    } catch (error) {
        return sendApiError(res, error, '이벤트 저장에 실패했습니다.');
    }
};

// phase dataset 조회 API
const getPhaseDataset = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.user_id;
        const session = await getOwnedSessionWithDetail(sessionId, userId);
        const dataset = buildPhaseDatasetExport(session);

        if (!dataset.samples.length) {
            throw createApiError(404, '해당 세션에는 phase dataset이 없습니다.');
        }

        return res.json({
            success: true,
            dataset
        });
    } catch (error) {
        return sendApiError(res, error, 'phase dataset 조회에 실패했습니다.');
    }
};

// 사람이 라벨링한 phase JSON 저장 API
const savePhaseLabels = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.user_id;
        const session = await getOwnedSessionWithDetail(sessionId, userId);
        const { detail, dataset } = mergePhaseLabelsIntoDetail(session.detail, req.body);

        const { error: updateError } = await supabase
            .from('workout_session')
            .update({ detail })
            .eq('session_id', sessionId)
            .eq('user_id', userId);

        if (updateError) {
            throw createApiError(500, 'phase 라벨 저장에 실패했습니다.');
        }

        return res.json({
            success: true,
            labeling: {
                status: dataset.labeling_status,
                labeled_frames: dataset.capture_meta.labeled_frame_count,
                total_frames: dataset.capture_meta.frame_count
            }
        });
    } catch (error) {
        return sendApiError(res, error, 'phase 라벨 저장에 실패했습니다.');
    }
};

// 운동 결과 페이지
const getWorkoutResult = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.user_id;

        const { data: session, error } = await supabase
            .from('workout_session')
            .select(`
                session_id,
                mode,
                started_at,
                ended_at,
                duration_sec,
                total_reps,
                final_score,
                summary_feedback,
                detail,
                exercise:exercise_id (
                    exercise_id,
                    code,
                    name
                ),
                session_metric_result (
                    score,
                    raw,
                    metric:metric_id (
                        metric_id,
                        key,
                        title,
                        unit
                    )
                )
            `)
            .eq('session_id', sessionId)
            .eq('user_id', userId)
            .single();

        if (error || !session) {
            return res.redirect('/?error=세션을 찾을 수 없습니다');
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const { data: todaySessions } = await supabase
            .from('workout_session')
            .select('duration_sec')
            .eq('user_id', userId)
            .gte('started_at', today.toISOString())
            .not('duration_sec', 'is', null);

        const totalTodayMinutes = todaySessions
            ? Math.round(todaySessions.reduce((sum, row) => sum + (row.duration_sec || 0), 0) / 60)
            : 0;

        res.render('workout/result', {
            title: '운동 결과',
            activeTab: 'workout',
            session,
            totalTodayMinutes
        });
    } catch (error) {
        next(error);
    }
};

// 운동 목록 API (채점 프로필 포함)
const getExercises = async (req, res, next) => {
    try {
        const { data: exercises, error } = await supabase
            .from('exercise')
            .select(`
                exercise_id,
                code,
                name,
                description,
                scoring_profile (
                    scoring_profile_id,
                    version,
                    name,
                    is_active
                )
            `)
            .eq('is_active', true)
            .order('name');

        if (error) throw error;

        res.json(exercises || []);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getFreeWorkoutPage,
    getFreeWorkoutSession,
    getRoutineWorkoutSession,
    startWorkoutSession,
    endWorkoutSession,
    abortWorkoutSession,
    recordWorkoutSet,
    recordSessionEvent,
    getPhaseDataset,
    savePhaseLabels,
    getWorkoutResult,
    getExercises
};
