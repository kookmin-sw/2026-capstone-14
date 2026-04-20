const { supabase } = require('../config/db');

const SESSION_STATUSES = ['DONE', 'ABORTED'];
const RESULT_BASIS_CODES = ['REPS', 'DURATION'];
const RESULT_UNIT_CODES = ['COUNT', 'SEC'];

const toFiniteNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const toRoundedNonNegativeInt = (value, fallback = 0) => {
    const parsed = toFiniteNumber(value, fallback);
    return Math.max(0, Math.round(parsed));
};

const normalizeResultBasis = (value) => {
    const basis = String(value || '').trim().toUpperCase();
    return RESULT_BASIS_CODES.includes(basis) ? basis : null;
};

const normalizeResultUnit = (value) => {
    const unit = String(value || '').trim().toUpperCase();
    return RESULT_UNIT_CODES.includes(unit) ? unit : null;
};

const computeDurationSecFromRange = (startedAtIso, endedAtIso = new Date().toISOString()) => {
    const startMs = new Date(startedAtIso).getTime();
    const endMs = new Date(endedAtIso).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;
    return Math.max(0, Math.round((endMs - startMs) / 1000));
};

const clampScore = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.min(100, parsed));
};

const getTodayRange = () => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    return { start, end };
};

const getWeekRange = () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    return { start: monday, end: sunday };
};

const getPeriodRange = (period) => {
    const now = new Date();
    const normalized = String(period || 'all').trim().toLowerCase();

    if (normalized === 'today') {
        return getTodayRange();
    }

    if (normalized === 'week') {
        return getWeekRange();
    }

    if (normalized === 'month') {
        const start = new Date(now);
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        return { start, end: null };
    }

    if (normalized === '90d') {
        const start = new Date(now);
        start.setDate(start.getDate() - 89);
        start.setHours(0, 0, 0, 0);
        return { start, end: null };
    }

    return { start: null, end: null };
};

const mergeSessionResult = (session, snapshotScore = null) => {
    const mergedBasis =
        normalizeResultBasis(session?.result_basis) ||
        normalizeResultBasis(snapshotScore?.result_basis) ||
        'REPS';

    const mergedUnit =
        normalizeResultUnit(session?.total_result_unit) ||
        normalizeResultUnit(snapshotScore?.result_unit) ||
        (mergedBasis === 'REPS' ? 'COUNT' : 'SEC');

    const rawResultValue =
        session?.total_result_value ??
        snapshotScore?.result_value ??
        0;
    const totalResultValue = toRoundedNonNegativeInt(rawResultValue, 0);

    const rawScore = session?.final_score ?? snapshotScore?.score;
    const finalScore = Number.isFinite(Number(rawScore))
        ? Math.max(0, Math.min(100, Math.round(Number(rawScore))))
        : 0;

    const startedAt = session?.started_at || null;
    const endedAt = session?.ended_at || null;
    const durationSec = startedAt
        ? computeDurationSecFromRange(startedAt, endedAt || new Date().toISOString())
        : 0;

    const isRepBased = mergedBasis === 'REPS' || mergedUnit === 'COUNT';
    const totalReps = isRepBased ? totalResultValue : 0;
    const totalDurationResult = isRepBased ? 0 : totalResultValue;

    return {
        ...session,
        result_basis: mergedBasis,
        total_result_value: totalResultValue,
        total_result_unit: mergedUnit,
        final_score: finalScore,
        summary_feedback: session?.summary_feedback || snapshotScore?.summary_feedback || null,
        duration_sec: durationSec,
        total_reps: totalReps,
        total_duration_result: totalDurationResult
    };
};

const buildTimelineFromSnapshots = ({
    startedAt,
    interimSnapshots = [],
    interimScoreBySnapshotId = new Map(),
    finalSnapshot = null,
    finalScore = null
}) => {
    const startedMs = new Date(startedAt).getTime();

    const toTimestamp = (recordedAt, fallbackMs = 0) => {
        const recordedMs = new Date(recordedAt).getTime();
        if (!Number.isFinite(recordedMs) || !Number.isFinite(startedMs)) return fallbackMs;
        return Math.max(0, recordedMs - startedMs);
    };

    const rows = [];

    for (const snapshot of interimSnapshots || []) {
        const score = clampScore(interimScoreBySnapshotId.get(snapshot.session_snapshot_id));
        if (score == null) continue;

        rows.push({
            snapshot_no: snapshot.snapshot_no,
            recorded_at: snapshot.recorded_at,
            timestamp: toTimestamp(snapshot.recorded_at, Math.max(0, Number(snapshot.snapshot_no || 0) * 1000)),
            score
        });
    }

    const safeFinalScore = clampScore(finalScore);
    if (finalSnapshot && safeFinalScore != null) {
        rows.push({
            snapshot_no: finalSnapshot.snapshot_no,
            recorded_at: finalSnapshot.recorded_at,
            timestamp: toTimestamp(
                finalSnapshot.recorded_at,
                Math.max(0, Number(finalSnapshot.snapshot_no || rows.length + 1) * 1000)
            ),
            score: safeFinalScore
        });
    }

    return rows.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
};

const buildMetricSeries = ({ startedAt, snapshots = [], metricRows = [] }) => {
    if (!Array.isArray(snapshots) || snapshots.length === 0) return [];
    if (!Array.isArray(metricRows) || metricRows.length === 0) return [];

    const startedMs = new Date(startedAt).getTime();
    const snapshotById = new Map(
        snapshots
            .filter((snapshot) => snapshot?.session_snapshot_id)
            .map((snapshot) => [snapshot.session_snapshot_id, snapshot])
    );
    const seriesByMetricKey = new Map();

    for (const row of metricRows) {
        const snapshot = snapshotById.get(row.session_snapshot_id);
        if (!snapshot) continue;

        const metricKey = String(row.metric_key || '').trim();
        if (!metricKey) continue;

        const recordedMs = new Date(snapshot.recorded_at).getTime();
        const tSec = Number.isFinite(startedMs) && Number.isFinite(recordedMs)
            ? Math.max(0, Math.round((recordedMs - startedMs) / 1000))
            : Math.max(0, Number(snapshot.snapshot_no || 0));

        if (!seriesByMetricKey.has(metricKey)) {
            seriesByMetricKey.set(metricKey, {
                metric_key: metricKey,
                metric_name: row.metric_name || metricKey,
                points: []
            });
        }

        const series = seriesByMetricKey.get(metricKey);
        series.metric_name = series.metric_name || row.metric_name || metricKey;
        series.points.push({
            snapshot_no: toRoundedNonNegativeInt(snapshot.snapshot_no, 0),
            snapshot_type: snapshot.snapshot_type || 'INTERIM',
            recorded_at: snapshot.recorded_at,
            t_sec: tSec,
            avg_score: clampScore(row.avg_score),
            avg_raw_value: Number.isFinite(Number(row.avg_raw_value)) ? Number(row.avg_raw_value) : null,
            min_raw_value: Number.isFinite(Number(row.min_raw_value)) ? Number(row.min_raw_value) : null,
            max_raw_value: Number.isFinite(Number(row.max_raw_value)) ? Number(row.max_raw_value) : null,
            sample_count: toRoundedNonNegativeInt(row.sample_count, 0)
        });
    }

    return Array.from(seriesByMetricKey.values())
        .map((series) => ({
            ...series,
            points: series.points.sort((a, b) => {
                const timeDiff = toFiniteNumber(a.t_sec, 0) - toFiniteNumber(b.t_sec, 0);
                if (timeDiff !== 0) return timeDiff;
                return toFiniteNumber(a.snapshot_no, 0) - toFiniteNumber(b.snapshot_no, 0);
            })
        }))
        .filter((series) => series.points.length > 0)
        .sort((a, b) => {
            const aLast = a.points[a.points.length - 1];
            const bLast = b.points[b.points.length - 1];
            const scoreDiff = toFiniteNumber(bLast?.avg_score, 0) - toFiniteNumber(aLast?.avg_score, 0);
            if (scoreDiff !== 0) return scoreDiff;
            return String(a.metric_name || a.metric_key || '').localeCompare(String(b.metric_name || b.metric_key || ''), 'ko');
        });
};

const sanitizeMetricRows = (rows = []) => {
    if (!Array.isArray(rows)) return [];

    return rows
        .map((row) => {
            const metricKey = String(row?.metric_key || '').trim();
            const metricName = String(row?.metric_name || metricKey).trim();
            if (!metricKey) return null;

            return {
                session_snapshot_id: row?.session_snapshot_id || null,
                metric_key: metricKey,
                metric_name: metricName || metricKey,
                avg_score: clampScore(row?.avg_score),
                avg_raw_value: Number.isFinite(Number(row?.avg_raw_value)) ? Number(row.avg_raw_value) : null,
                min_raw_value: Number.isFinite(Number(row?.min_raw_value)) ? Number(row.min_raw_value) : null,
                max_raw_value: Number.isFinite(Number(row?.max_raw_value)) ? Number(row.max_raw_value) : null,
                sample_count: toRoundedNonNegativeInt(row?.sample_count, 0)
            };
        })
        .filter(Boolean);
};

const sortMetricsByScore = (rows = [], ascending = false) => {
    return [...rows].sort((a, b) => {
        const scoreDiff = toFiniteNumber(a?.avg_score, 0) - toFiniteNumber(b?.avg_score, 0);
        if (scoreDiff !== 0) {
            return ascending ? scoreDiff : -scoreDiff;
        }
        return String(a?.metric_name || a?.metric_key || '').localeCompare(
            String(b?.metric_name || b?.metric_key || ''),
            'ko'
        );
    });
};

const toScoreGrade = (score) => {
    const safeScore = Math.max(0, Math.min(100, Math.round(toFiniteNumber(score, 0))));
    if (safeScore >= 90) return 'A';
    if (safeScore >= 80) return 'B';
    if (safeScore >= 70) return 'C';
    if (safeScore >= 60) return 'D';
    return 'E';
};

const buildMetricAction = (metric) => {
    const source = `${String(metric?.metric_key || '')} ${String(metric?.metric_name || '')}`.toLowerCase();

    if (
        source.includes('depth') ||
        source.includes('깊이') ||
        source.includes('hip') ||
        source.includes('힙')
    ) {
        return '하강 구간에서 엉덩이를 더 뒤로 보내고 가동범위를 조금씩 늘려보세요.';
    }
    if (
        source.includes('knee') ||
        source.includes('무릎') ||
        source.includes('alignment') ||
        source.includes('정렬')
    ) {
        return '무릎이 발끝 방향을 따라가도록 유지하고 좌우 흔들림을 줄여보세요.';
    }
    if (
        source.includes('spine') ||
        source.includes('back') ||
        source.includes('허리') ||
        source.includes('상체')
    ) {
        return '코어에 힘을 주고 상체 각도를 일정하게 유지해 보세요.';
    }
    if (
        source.includes('tempo') ||
        source.includes('speed') ||
        source.includes('리듬') ||
        source.includes('속도')
    ) {
        return '내려갈 때 2초, 올라올 때 1초처럼 일정한 리듬으로 반복해 보세요.';
    }
    if (
        source.includes('balance') ||
        source.includes('symmetry') ||
        source.includes('균형')
    ) {
        return '좌우 체중 분배를 맞추고 중심이 한쪽으로 쏠리지 않게 의식해 보세요.';
    }
    return `${metric?.metric_name || '자세'} 구간을 천천히 반복하며 정확도를 먼저 확보해 보세요.`;
};

const buildMetricIssue = (metric, priority = 1) => {
    const safeScore = Math.max(0, Math.min(100, Math.round(toFiniteNumber(metric?.avg_score, 0))));
    const metricName = metric?.metric_name || metric?.metric_key || '자세';

    return {
        priority,
        metric_key: metric?.metric_key || null,
        metric_name: metricName,
        current_score: safeScore,
        reason: `${metricName} 평균 점수가 ${safeScore}점입니다.`,
        action: buildMetricAction(metric)
    };
};

const buildCameraInsight = (sessionEvents = []) => {
    const eventCounts = {};
    for (const event of Array.isArray(sessionEvents) ? sessionEvents : []) {
        const type = String(event?.type || '').trim().toUpperCase();
        if (!type) continue;
        eventCounts[type] = (eventCounts[type] || 0) + 1;
    }

    const lowScoreHintCount = toRoundedNonNegativeInt(eventCounts.LOW_SCORE_HINT, 0);
    const cameraIssueCount = Object.entries(eventCounts).reduce((sum, [type, count]) => {
        if (type.includes('NO_PERSON') || type.includes('CAMERA') || type.includes('STALE')) {
            return sum + toRoundedNonNegativeInt(count, 0);
        }
        return sum;
    }, 0);

    let note = '카메라 이탈 이슈는 크지 않았습니다.';
    if (cameraIssueCount >= 5) {
        note = '카메라 이탈이 잦아 자세 판정 신뢰도가 낮아질 수 있습니다.';
    } else if (cameraIssueCount > 0) {
        note = '카메라 이탈이 일부 감지되었습니다. 다음 세션에서 화면 정렬을 먼저 맞춰주세요.';
    }

    return {
        event_counts: eventCounts,
        camera_issue_count: cameraIssueCount,
        low_score_hint_count: lowScoreHintCount,
        note,
        action: cameraIssueCount > 0
            ? '전신이 화면 안에 고정되도록 카메라 거리와 높이를 먼저 맞춰주세요.'
            : null
    };
};

const buildAccuracyFocus = ({ session, metrics = [], metricSeries = [] }) => {
    const normalizedMetrics = sanitizeMetricRows(metrics);
    const sortedDesc = sortMetricsByScore(normalizedMetrics, false);
    const sortedAsc = sortMetricsByScore(normalizedMetrics, true);

    const trendByMetricKey = new Map();
    for (const series of Array.isArray(metricSeries) ? metricSeries : []) {
        const metricKey = String(series?.metric_key || '').trim();
        const points = Array.isArray(series?.points) ? series.points : [];
        if (!metricKey || points.length < 2) continue;

        const first = Number(points[0]?.avg_score);
        const last = Number(points[points.length - 1]?.avg_score);
        if (!Number.isFinite(first) || !Number.isFinite(last)) continue;
        trendByMetricKey.set(metricKey, Number((last - first).toFixed(1)));
    }

    const toMetricItem = (metric) => ({
        metric_key: metric.metric_key,
        metric_name: metric.metric_name,
        avg_score: toFiniteNumber(metric.avg_score, 0),
        sample_count: toRoundedNonNegativeInt(metric.sample_count, 0),
        trend_delta: trendByMetricKey.has(metric.metric_key) ? trendByMetricKey.get(metric.metric_key) : null
    });

    const safeScore = Math.max(0, Math.min(100, Math.round(toFiniteNumber(session?.final_score, 0))));

    return {
        overall_score: safeScore,
        score_grade: toScoreGrade(safeScore),
        metric_count: sortedDesc.length,
        best_metric: sortedDesc.length > 0 ? toMetricItem(sortedDesc[0]) : null,
        weakest_metric: sortedAsc.length > 0 ? toMetricItem(sortedAsc[0]) : null,
        top_metrics: sortedDesc.slice(0, 3).map(toMetricItem),
        weak_metrics: sortedAsc.slice(0, 3).map(toMetricItem)
    };
};

const buildImprovementFocus = ({ session, metrics = [], sessionEvents = [] }) => {
    const normalizedMetrics = sanitizeMetricRows(metrics);
    const weakMetrics = sortMetricsByScore(normalizedMetrics, true).slice(0, 3);
    const issues = weakMetrics.map((metric, index) => buildMetricIssue(metric, index + 1));

    const cameraInsight = buildCameraInsight(sessionEvents);

    const actions = [];
    for (const issue of issues) {
        if (issue.action && !actions.includes(issue.action)) {
            actions.push(issue.action);
        }
    }
    if (cameraInsight.action && !actions.includes(cameraInsight.action)) {
        actions.push(cameraInsight.action);
    }
    if (actions.length === 0 && session?.summary_feedback) {
        actions.push(String(session.summary_feedback));
    }
    if (actions.length === 0) {
        actions.push('현재 점수는 안정적입니다. 다음 세션에서도 같은 자세 리듬을 유지해 보세요.');
    }

    const totalSamples = normalizedMetrics.reduce(
        (sum, metric) => sum + toRoundedNonNegativeInt(metric.sample_count, 0),
        0
    );

    let confidenceScore = 0.45;
    if (totalSamples >= 30) confidenceScore = 0.9;
    else if (totalSamples >= 15) confidenceScore = 0.75;
    else if (totalSamples >= 5) confidenceScore = 0.6;

    confidenceScore -= Math.min(0.25, cameraInsight.camera_issue_count * 0.05);
    confidenceScore = Number(Math.max(0.3, Math.min(0.95, confidenceScore)).toFixed(2));

    let headline = '현재 세션 데이터 기준으로 개선 우선순위를 정리했습니다.';
    if (issues.length > 0) {
        headline = `${issues[0].metric_name} 정확도 개선이 가장 우선입니다.`;
    } else if (cameraInsight.camera_issue_count > 0) {
        headline = '자세 자체보다 카메라 안정화가 우선입니다.';
    } else if (session?.summary_feedback) {
        headline = String(session.summary_feedback);
    }

    return {
        headline,
        priority_issues: issues,
        actions: actions.slice(0, 4),
        camera_note: cameraInsight.note,
        event_counts: cameraInsight.event_counts,
        confidence_score: confidenceScore
    };
};

const buildFocusPreview = ({ session, metrics = [] }) => {
    const status = String(session?.status || '').toUpperCase();
    if (status === 'ABORTED') {
        return {
            headline: '세션이 중단되어 정확도 분석이 제한적입니다.',
            primary_issue: '세션 중단',
            primary_action: '다음 세션에서는 짧은 목표로 완주를 먼저 시도해 보세요.'
        };
    }

    const weakMetric = sortMetricsByScore(sanitizeMetricRows(metrics), true)[0] || null;
    if (weakMetric) {
        const safeScore = Math.max(0, Math.min(100, Math.round(toFiniteNumber(weakMetric.avg_score, 0))));
        return {
            headline: `${weakMetric.metric_name} 정확도가 가장 낮았습니다.`,
            primary_issue: `${weakMetric.metric_name} ${safeScore}점`,
            primary_action: buildMetricAction(weakMetric)
        };
    }

    if (session?.summary_feedback) {
        return {
            headline: String(session.summary_feedback),
            primary_issue: '요약 피드백 참고',
            primary_action: '다음 세션에서 동일 동작을 천천히 반복해 정확도를 확인해 보세요.'
        };
    }

    return {
        headline: '메트릭 데이터가 충분하지 않습니다.',
        primary_issue: '분석 데이터 부족',
        primary_action: '다음 세션에서 동작 시간을 조금 더 길게 가져가 보세요.'
    };
};

const calculateStreak = (rows = []) => {
    if (!Array.isArray(rows) || rows.length === 0) return 0;

    const uniqueDates = [];
    const visited = new Set();

    for (const row of rows) {
        const date = new Date(row.started_at);
        if (Number.isNaN(date.getTime())) continue;
        const dateKey = date.toDateString();
        if (visited.has(dateKey)) continue;
        visited.add(dateKey);
        uniqueDates.push(new Date(dateKey));
    }

    if (uniqueDates.length === 0) return 0;

    const today = new Date();
    const todayDate = new Date(today.toDateString());
    const yesterdayDate = new Date(todayDate);
    yesterdayDate.setDate(todayDate.getDate() - 1);

    const firstDate = uniqueDates[0].toDateString();
    if (firstDate !== todayDate.toDateString() && firstDate !== yesterdayDate.toDateString()) {
        return 0;
    }

    let streak = 1;
    for (let index = 1; index < uniqueDates.length; index += 1) {
        const diffDays = Math.round((uniqueDates[index - 1] - uniqueDates[index]) / 86400000);
        if (diffDays === 1) {
            streak += 1;
        } else {
            break;
        }
    }

    return streak;
};

const buildPeriodStats = (rows = []) => {
    const normalized = rows.map((row) => mergeSessionResult(row));
    const count = normalized.length;
    const totalDurationSec = normalized.reduce((sum, row) => sum + (row.duration_sec || 0), 0);
    const totalMinutes = Math.round(totalDurationSec / 60);
    const totalReps = normalized.reduce((sum, row) => sum + (row.total_reps || 0), 0);
    const totalDurationResultSec = normalized.reduce((sum, row) => sum + (row.total_duration_result || 0), 0);

    const validScores = normalized
        .map((row) => Number(row.final_score))
        .filter((score) => Number.isFinite(score));

    const avgScore = validScores.length > 0
        ? Math.round(validScores.reduce((sum, score) => sum + score, 0) / validScores.length)
        : 0;

    return {
        count,
        totalMinutes,
        avgScore,
        totalReps,
        totalDurationSec: totalDurationResultSec
    };
};

const fetchFinalSnapshotMaps = async (sessionIds = []) => {
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
        return {
            snapshotHeaderBySessionId: new Map(),
            snapshotScoreBySessionId: new Map(),
            snapshotMetricsBySessionId: new Map()
        };
    }

    const { data: snapshotRows, error: snapshotError } = await supabase
        .from('session_snapshot')
        .select('session_id, session_snapshot_id, snapshot_no, recorded_at')
        .in('session_id', sessionIds)
        .eq('snapshot_type', 'FINAL')
        .order('session_id', { ascending: true })
        .order('snapshot_no', { ascending: false });

    if (snapshotError) throw snapshotError;

    const snapshotHeaderBySessionId = new Map();
    for (const row of snapshotRows || []) {
        if (!snapshotHeaderBySessionId.has(row.session_id)) {
            snapshotHeaderBySessionId.set(row.session_id, row);
        }
    }

    const snapshotIds = Array.from(snapshotHeaderBySessionId.values())
        .map((row) => row.session_snapshot_id)
        .filter(Boolean);

    if (snapshotIds.length === 0) {
        return {
            snapshotHeaderBySessionId,
            snapshotScoreBySessionId: new Map(),
            snapshotMetricsBySessionId: new Map()
        };
    }

    const [
        { data: scoreRows, error: scoreError },
        { data: metricRows, error: metricError }
    ] = await Promise.all([
        supabase
            .from('session_snapshot_score')
            .select('session_snapshot_id, score, result_basis, result_value, result_unit, summary_feedback')
            .in('session_snapshot_id', snapshotIds),
        supabase
            .from('session_snapshot_metric')
            .select('session_snapshot_id, metric_key, metric_name, avg_score, avg_raw_value, min_raw_value, max_raw_value, sample_count')
            .in('session_snapshot_id', snapshotIds)
    ]);

    if (scoreError) throw scoreError;
    if (metricError) throw metricError;

    const scoreBySnapshotId = new Map(
        (scoreRows || []).map((row) => [row.session_snapshot_id, row])
    );

    const snapshotScoreBySessionId = new Map();
    const snapshotMetricsBySessionId = new Map();
    const metricsBySnapshotId = new Map();

    for (const row of sanitizeMetricRows(metricRows || [])) {
        const key = row.session_snapshot_id || null;
        if (!key) continue;
        if (!metricsBySnapshotId.has(key)) {
            metricsBySnapshotId.set(key, []);
        }
        metricsBySnapshotId.get(key).push(row);
    }

    for (const [sessionId, snapshotHeader] of snapshotHeaderBySessionId.entries()) {
        const snapshotScore = scoreBySnapshotId.get(snapshotHeader.session_snapshot_id) || null;
        if (snapshotScore) {
            snapshotScoreBySessionId.set(sessionId, snapshotScore);
        }

        const finalMetrics = metricsBySnapshotId.get(snapshotHeader.session_snapshot_id) || [];
        if (finalMetrics.length > 0) {
            snapshotMetricsBySessionId.set(
                sessionId,
                sortMetricsByScore(finalMetrics, false)
            );
        }
    }

    return {
        snapshotHeaderBySessionId,
        snapshotScoreBySessionId,
        snapshotMetricsBySessionId
    };
};

const loadRoutineContextBySetId = async (setId) => {
    if (!setId) return null;

    const context = {
        workout_set: null,
        step_instance: null,
        routine_instance: null,
        routine: null
    };

    const { data: workoutSet, error: setError } = await supabase
        .from('workout_set')
        .select(`
            set_id,
            step_instance_id,
            set_no,
            target_type,
            target_value,
            actual_value,
            value_unit,
            result_basis,
            score,
            is_success,
            duration_sec,
            rest_sec_after,
            status,
            started_at,
            ended_at
        `)
        .eq('set_id', setId)
        .maybeSingle();

    if (setError) throw setError;
    context.workout_set = workoutSet || null;

    if (!workoutSet?.step_instance_id) return context;

    const { data: stepInstance, error: stepError } = await supabase
        .from('routine_step_instance')
        .select(`
            step_instance_id,
            routine_instance_id,
            order_no,
            target_type_snapshot,
            target_value_snapshot,
            planned_sets,
            completed_sets,
            status,
            started_at,
            ended_at
        `)
        .eq('step_instance_id', workoutSet.step_instance_id)
        .maybeSingle();

    if (stepError) throw stepError;
    context.step_instance = stepInstance || null;

    if (!stepInstance?.routine_instance_id) return context;

    const { data: routineInstance, error: routineInstanceError } = await supabase
        .from('routine_instance')
        .select(`
            routine_instance_id,
            routine_id,
            status,
            started_at,
            ended_at,
            total_score
        `)
        .eq('routine_instance_id', stepInstance.routine_instance_id)
        .maybeSingle();

    if (routineInstanceError) throw routineInstanceError;
    context.routine_instance = routineInstance || null;

    if (!routineInstance?.routine_id) return context;

    const { data: routine, error: routineError } = await supabase
        .from('routine')
        .select('routine_id, name')
        .eq('routine_id', routineInstance.routine_id)
        .maybeSingle();

    if (routineError) throw routineError;
    context.routine = routine || null;

    return context;
};

const formatResultValueWithUnit = ({ resultBasis, resultUnit, value }) => {
    const safeValue = toRoundedNonNegativeInt(value, 0);
    if (safeValue <= 0) return null;

    const basis = normalizeResultBasis(resultBasis);
    const unit = normalizeResultUnit(resultUnit);

    if (basis === 'DURATION' || unit === 'SEC') return `${safeValue}초`;
    if (basis === 'REPS' || unit === 'COUNT') return `${safeValue}회`;
    return `${safeValue}`;
};

const pickRepresentativeSession = (rows = []) => {
    const sorted = [...rows].sort((a, b) => {
        const aDone = String(a?.status || '').toUpperCase() === 'DONE' ? 1 : 0;
        const bDone = String(b?.status || '').toUpperCase() === 'DONE' ? 1 : 0;
        if (aDone !== bDone) return bDone - aDone;
        return new Date(b?.started_at || 0).getTime() - new Date(a?.started_at || 0).getTime();
    });

    return sorted[0] || null;
};

const buildRoutineStepSequence = ({
    steps = [],
    sets = [],
    sessions = [],
    includeEmptySteps = false
}) => {
    const uniqueStepById = new Map(
        (steps || [])
            .filter((step) => step?.step_instance_id)
            .map((step) => [step.step_instance_id, step])
    );

    const setRows = (sets || [])
        .filter((setRow) => setRow?.set_id && setRow?.step_instance_id)
        .sort((a, b) => {
            if (a.step_instance_id !== b.step_instance_id) {
                return Number(a.step_instance_id) - Number(b.step_instance_id);
            }
            return Number(a.set_no || 0) - Number(b.set_no || 0);
        });

    const setsByStepId = new Map();
    for (const setRow of setRows) {
        if (!setsByStepId.has(setRow.step_instance_id)) {
            setsByStepId.set(setRow.step_instance_id, []);
        }
        setsByStepId.get(setRow.step_instance_id).push(setRow);
    }

    const sessionsBySetId = new Map();
    for (const session of sessions || []) {
        if (!session?.set_id) continue;
        if (!sessionsBySetId.has(session.set_id)) {
            sessionsBySetId.set(session.set_id, []);
        }
        sessionsBySetId.get(session.set_id).push(session);
    }

    const sortedSteps = Array.from(uniqueStepById.values()).sort((a, b) => {
        const orderDiff = Number(a?.order_no || 0) - Number(b?.order_no || 0);
        if (orderDiff !== 0) return orderDiff;
        return Number(a?.step_instance_id || 0) - Number(b?.step_instance_id || 0);
    });

    const sequence = sortedSteps.map((step) => {
        const stepSets = setsByStepId.get(step.step_instance_id) || [];
        const stepSessions = [];

        let totalValue = 0;
        let resultBasis = null;
        let resultUnit = null;

        for (const setRow of stepSets) {
            totalValue += toRoundedNonNegativeInt(setRow?.actual_value, 0);
            resultBasis = resultBasis || normalizeResultBasis(setRow?.result_basis);
            resultUnit = resultUnit || normalizeResultUnit(setRow?.value_unit);

            const linkedSessions = sessionsBySetId.get(setRow.set_id) || [];
            for (const session of linkedSessions) {
                stepSessions.push(session);
            }
        }

        const representativeSession = pickRepresentativeSession(stepSessions);
        const sessionCount = stepSessions.length;
        if (representativeSession) {
            resultBasis = resultBasis || normalizeResultBasis(representativeSession.result_basis);
            resultUnit = resultUnit || normalizeResultUnit(representativeSession.total_result_unit);
        }

        const setSummaries = stepSets.map((setRow) => {
            const setValueText = formatResultValueWithUnit({
                resultBasis: setRow?.result_basis,
                resultUnit: setRow?.value_unit,
                value: setRow?.actual_value
            });

            return {
                set_id: setRow?.set_id || null,
                set_no: toRoundedNonNegativeInt(setRow?.set_no, 0),
                status: String(setRow?.status || '').toUpperCase(),
                actual_value: toRoundedNonNegativeInt(setRow?.actual_value, 0),
                value_unit: normalizeResultUnit(setRow?.value_unit),
                result_basis: normalizeResultBasis(setRow?.result_basis),
                duration_sec: toRoundedNonNegativeInt(setRow?.duration_sec, 0),
                value_text: setValueText || null
            };
        });

        const exerciseName = step?.exercise?.name || `운동 ${step?.order_no || ''}`.trim();
        const valueText = formatResultValueWithUnit({
            resultBasis,
            resultUnit,
            value: totalValue
        });

        return {
            step_instance_id: step.step_instance_id,
            order_no: toRoundedNonNegativeInt(step.order_no, 0),
            exercise_id: step.exercise_id || null,
            exercise_name: exerciseName,
            total_value: totalValue,
            result_basis: resultBasis || null,
            result_unit: resultUnit || null,
            value_text: valueText,
            summary_text: valueText ? `${exerciseName} ${valueText}` : exerciseName,
            set_count: stepSets.length,
            session_count: sessionCount,
            session_id: representativeSession?.session_id || null,
            sets: setSummaries
        };
    });

    if (includeEmptySteps) return sequence;
    return sequence.filter((item) =>
        item.set_count > 0 ||
        item.session_count > 0 ||
        toRoundedNonNegativeInt(item.total_value, 0) > 0
    );
};

const buildRoutineSequencePreview = (sequence = []) => {
    if (!Array.isArray(sequence) || sequence.length === 0) {
        return '운동 순서 정보가 없습니다.';
    }

    const preview = sequence.slice(0, 4).map((item) => item.summary_text).join(' -> ');
    return sequence.length > 4 ? `${preview} ...` : preview;
};

const fetchRoutineMapsBySetIds = async (setIds = []) => {
    if (!Array.isArray(setIds) || setIds.length === 0) {
        return {
            setById: new Map(),
            stepById: new Map(),
            routineById: new Map()
        };
    }

    const { data: setRows, error: setError } = await supabase
        .from('workout_set')
        .select(`
            set_id,
            step_instance_id,
            set_no,
            actual_value,
            value_unit,
            result_basis,
            status,
            duration_sec
        `)
        .in('set_id', setIds);
    if (setError) throw setError;

    const setById = new Map((setRows || []).map((row) => [row.set_id, row]));
    const stepIds = Array.from(new Set((setRows || []).map((row) => row.step_instance_id).filter(Boolean)));

    if (stepIds.length === 0) {
        return {
            setById,
            stepById: new Map(),
            routineById: new Map()
        };
    }

    const { data: stepRows, error: stepError } = await supabase
        .from('routine_step_instance')
        .select(`
            step_instance_id,
            routine_instance_id,
            order_no,
            exercise_id,
            status,
            exercise:exercise_id (
                exercise_id,
                code,
                name
            )
        `)
        .in('step_instance_id', stepIds);
    if (stepError) throw stepError;

    const stepById = new Map((stepRows || []).map((row) => [row.step_instance_id, row]));
    const routineInstanceIds = Array.from(new Set((stepRows || []).map((row) => row.routine_instance_id).filter(Boolean)));

    if (routineInstanceIds.length === 0) {
        return {
            setById,
            stepById,
            routineById: new Map()
        };
    }

    const { data: routineRows, error: routineError } = await supabase
        .from('routine_instance')
        .select(`
            routine_instance_id,
            routine_id,
            status,
            started_at,
            ended_at,
            total_score,
            routine:routine_id (
                routine_id,
                name
            )
        `)
        .in('routine_instance_id', routineInstanceIds);
    if (routineError) throw routineError;

    return {
        setById,
        stepById,
        routineById: new Map((routineRows || []).map((row) => [row.routine_instance_id, row]))
    };
};

// 운동 히스토리 메인 페이지
const getHistoryPage = async (req, res, next) => {
    try {
        const userId = req.user.user_id;

        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = 12;
        const offset = (page - 1) * limit;

        const requestedExercise = String(req.query.exercise || 'all');
        const parsedExerciseId = Number.parseInt(requestedExercise, 10);
        const exerciseIdFilter = Number.isFinite(parsedExerciseId) ? parsedExerciseId : null;

        const periodFilter = ['all', 'today', 'week', 'month', '90d'].includes(String(req.query.period || '').toLowerCase())
            ? String(req.query.period || 'all').toLowerCase()
            : 'all';

        const statusFilterRaw = String(req.query.status || 'DONE').trim().toUpperCase();
        const statusFilter = ['ALL', ...SESSION_STATUSES].includes(statusFilterRaw)
            ? statusFilterRaw
            : 'DONE';

        const sortFilterRaw = String(req.query.sort || 'latest').trim().toLowerCase();
        const sortFilter = ['latest', 'oldest', 'score'].includes(sortFilterRaw)
            ? sortFilterRaw
            : 'latest';

        const periodRange = getPeriodRange(periodFilter);

        let query = supabase
            .from('workout_session')
            .select(`
                session_id,
                mode,
                status,
                selected_view,
                set_id,
                result_basis,
                total_result_value,
                total_result_unit,
                final_score,
                summary_feedback,
                started_at,
                ended_at,
                exercise:exercise_id (
                    exercise_id,
                    code,
                    name
                )
            `)
            .eq('user_id', userId)
            .in('status', SESSION_STATUSES);

        if (statusFilter !== 'ALL') {
            query = query.eq('status', statusFilter);
        }

        if (periodRange.start) {
            query = query.gte('started_at', periodRange.start.toISOString());
        }

        if (periodRange.end) {
            query = query.lte('started_at', periodRange.end.toISOString());
        }

        const { data: sessions, error: sessionsError } = await query;
        if (sessionsError) throw sessionsError;

        const {
            snapshotHeaderBySessionId,
            snapshotScoreBySessionId,
            snapshotMetricsBySessionId
        } = await fetchFinalSnapshotMaps(
            (sessions || []).map((row) => row.session_id)
        );

        const normalizedSessions = (sessions || []).map((session) => {
            const snapshotHeader = snapshotHeaderBySessionId.get(session.session_id) || null;
            const snapshotScore = snapshotScoreBySessionId.get(session.session_id) || null;
            const snapshotMetrics = snapshotMetricsBySessionId.get(session.session_id) || [];
            const merged = mergeSessionResult(session, snapshotScore);

            return {
                ...merged,
                focus_preview: buildFocusPreview({
                    session: merged,
                    metrics: snapshotMetrics
                }),
                final_snapshot: snapshotHeader
                    ? {
                        session_snapshot_id: snapshotHeader.session_snapshot_id,
                        snapshot_no: snapshotHeader.snapshot_no,
                        recorded_at: snapshotHeader.recorded_at
                    }
                    : null
            };
        });

        const setIds = Array.from(new Set(
            normalizedSessions
                .map((session) => session?.set_id)
                .filter(Boolean)
        ));

        const { setById, stepById, routineById } = await fetchRoutineMapsBySetIds(setIds);

        const freeItems = [];
        const routineSessionsByInstanceId = new Map();

        for (const session of normalizedSessions) {
            const setRow = session?.set_id ? setById.get(session.set_id) : null;
            const stepRow = setRow?.step_instance_id ? stepById.get(setRow.step_instance_id) : null;
            const routineInstanceId = stepRow?.routine_instance_id || null;

            if (!routineInstanceId) {
                if (exerciseIdFilter != null && Number(session?.exercise?.exercise_id) !== exerciseIdFilter) {
                    continue;
                }

                freeItems.push({
                    ...session,
                    item_type: 'FREE_SESSION',
                    item_id: `session-${session.session_id}`
                });
                continue;
            }

            if (!routineSessionsByInstanceId.has(routineInstanceId)) {
                routineSessionsByInstanceId.set(routineInstanceId, []);
            }

            routineSessionsByInstanceId.get(routineInstanceId).push({
                ...session,
                __set_row: setRow || null,
                __step_row: stepRow || null
            });
        }

        const routineItems = [];
        for (const [routineInstanceId, routineSessions] of routineSessionsByInstanceId.entries()) {
            if (!Array.isArray(routineSessions) || routineSessions.length === 0) continue;

            if (exerciseIdFilter != null) {
                const hasExercise = routineSessions.some((session) => {
                    const exerciseIdFromSession = Number(session?.exercise?.exercise_id);
                    const exerciseIdFromStep = Number(session?.__step_row?.exercise_id);
                    return exerciseIdFromSession === exerciseIdFilter || exerciseIdFromStep === exerciseIdFilter;
                });
                if (!hasExercise) continue;
            }

            const routineRow = routineById.get(routineInstanceId) || null;
            const uniqueStepMap = new Map();
            const uniqueSetMap = new Map();

            for (const session of routineSessions) {
                const stepRow = session.__step_row;
                const setRow = session.__set_row;
                if (stepRow?.step_instance_id && !uniqueStepMap.has(stepRow.step_instance_id)) {
                    uniqueStepMap.set(stepRow.step_instance_id, stepRow);
                }
                if (setRow?.set_id && !uniqueSetMap.has(setRow.set_id)) {
                    uniqueSetMap.set(setRow.set_id, setRow);
                }
            }

            const sequence = buildRoutineStepSequence({
                steps: Array.from(uniqueStepMap.values()),
                sets: Array.from(uniqueSetMap.values()),
                sessions: routineSessions
            });
            const sequencePreview = buildRoutineSequencePreview(sequence);

            const sessionStartedAtList = routineSessions
                .map((session) => session.started_at)
                .filter(Boolean)
                .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
            const sessionEndedAtList = routineSessions
                .map((session) => session.ended_at)
                .filter(Boolean)
                .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

            const startedAt = routineRow?.started_at || sessionStartedAtList[0] || null;
            const endedAt = routineRow?.ended_at || sessionEndedAtList[0] || null;
            const durationSec = routineSessions.reduce((sum, session) => {
                return sum + toRoundedNonNegativeInt(session?.duration_sec, 0);
            }, 0);

            const validSessionScores = routineSessions
                .map((session) => Number(session?.final_score))
                .filter((score) => Number.isFinite(score));
            const averageRoutineScore = validSessionScores.length > 0
                ? validSessionScores.reduce((sum, score) => sum + score, 0) / validSessionScores.length
                : 0;
            const finalScore = Math.round(
                Math.max(0, Math.min(100, averageRoutineScore))
            );

            const rawStatus = String(routineRow?.status || '').toUpperCase();
            let status = rawStatus;
            if (!SESSION_STATUSES.includes(status)) {
                const hasDone = routineSessions.some((session) => String(session?.status || '').toUpperCase() === 'DONE');
                status = hasDone ? 'DONE' : 'ABORTED';
            }

            const routineName = routineRow?.routine?.name || `루틴 #${routineRow?.routine_id || routineInstanceId}`;
            const doneSessionCount = routineSessions.filter(
                (session) => String(session?.status || '').toUpperCase() === 'DONE'
            ).length;

            routineItems.push({
                item_type: 'ROUTINE_RUN',
                item_id: `routine-${routineInstanceId}`,
                routine_instance_id: routineInstanceId,
                mode: 'ROUTINE',
                status,
                selected_view: 'ROUTINE',
                result_basis: null,
                total_result_value: 0,
                total_result_unit: null,
                final_score: finalScore,
                summary_feedback: sequencePreview,
                started_at: startedAt,
                ended_at: endedAt,
                duration_sec: durationSec,
                done_sessions: doneSessionCount,
                exercise: {
                    exercise_id: null,
                    code: 'ROUTINE',
                    name: routineName
                },
                routine_name: routineName,
                sequence_preview: sequencePreview,
                sequence_count: sequence.length,
                focus_preview: {
                    headline: sequencePreview,
                    primary_issue: sequence.length > 0 ? sequence[0].summary_text : '운동 순서 데이터 없음',
                    primary_action: '상세에서 운동 항목을 눌러 세션별 정확도를 확인해 보세요.'
                }
            });
        }

        const sortByHistoryRule = (a, b) => {
            const aStartedMs = new Date(a?.started_at || 0).getTime();
            const bStartedMs = new Date(b?.started_at || 0).getTime();

            if (sortFilter === 'score') {
                const scoreDiff = toFiniteNumber(b?.final_score, 0) - toFiniteNumber(a?.final_score, 0);
                if (scoreDiff !== 0) return scoreDiff;
                return bStartedMs - aStartedMs;
            }

            if (sortFilter === 'oldest') {
                return aStartedMs - bStartedMs;
            }

            return bStartedMs - aStartedMs;
        };

        const mergedItems = [...freeItems, ...routineItems].sort(sortByHistoryRule);
        const totalCount = mergedItems.length;
        const pagedItems = mergedItems.slice(offset, offset + limit);
        const totalPages = Math.max(1, Math.ceil(totalCount / limit));

        const { data: exercises, error: exerciseError } = await supabase
            .from('exercise')
            .select('exercise_id, name')
            .eq('is_active', true)
            .order('name');
        if (exerciseError) throw exerciseError;

        res.render('history/index', {
            title: '운동 히스토리',
            activeTab: 'history',
            sessions: pagedItems,
            exercises: exercises || [],
            filters: {
                exercise: exerciseIdFilter != null ? String(exerciseIdFilter) : 'all',
                period: periodFilter,
                status: statusFilter,
                sort: sortFilter
            },
            pagination: {
                page,
                totalPages,
                total: totalCount
            }
        });
    } catch (error) {
        next(error);
    }
};

// 세션 상세 조회 API
const getSessionDetail = async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const sessionId = Number.parseInt(req.params.sessionId, 10);

        if (!Number.isFinite(sessionId)) {
            return res.status(400).json({ success: false, error: '유효하지 않은 세션 ID입니다.' });
        }

        const { data: session, error: sessionError } = await supabase
            .from('workout_session')
            .select(`
                session_id,
                mode,
                status,
                selected_view,
                set_id,
                result_basis,
                total_result_value,
                total_result_unit,
                final_score,
                summary_feedback,
                started_at,
                ended_at,
                exercise:exercise_id (
                    exercise_id,
                    code,
                    name
                )
            `)
            .eq('session_id', sessionId)
            .eq('user_id', userId)
            .maybeSingle();

        if (sessionError) throw sessionError;
        if (!session) {
            return res.status(404).json({ success: false, error: '세션을 찾을 수 없습니다.' });
        }

        const { data: finalSnapshot, error: snapshotError } = await supabase
            .from('session_snapshot')
            .select('session_snapshot_id, snapshot_no, snapshot_type, recorded_at')
            .eq('session_id', sessionId)
            .eq('snapshot_type', 'FINAL')
            .order('snapshot_no', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (snapshotError) throw snapshotError;

        let snapshotScore = null;
        let snapshotMetrics = [];

        if (finalSnapshot?.session_snapshot_id) {
            const { data: scoreRow, error: scoreError } = await supabase
                .from('session_snapshot_score')
                .select('score, result_basis, result_value, result_unit, summary_feedback')
                .eq('session_snapshot_id', finalSnapshot.session_snapshot_id)
                .maybeSingle();
            if (scoreError) throw scoreError;

            snapshotScore = scoreRow || null;
        }

        const { data: interimSnapshots, error: interimSnapshotError } = await supabase
            .from('session_snapshot')
            .select('session_snapshot_id, snapshot_no, snapshot_type, recorded_at')
            .eq('session_id', sessionId)
            .eq('snapshot_type', 'INTERIM')
            .order('snapshot_no', { ascending: true });
        if (interimSnapshotError) throw interimSnapshotError;

        const allSnapshots = [
            ...(interimSnapshots || []),
            ...(finalSnapshot?.session_snapshot_id ? [finalSnapshot] : [])
        ];

        const allSnapshotIds = allSnapshots
            .map((snapshot) => snapshot.session_snapshot_id)
            .filter(Boolean);

        let metricRows = [];
        if (allSnapshotIds.length > 0) {
            const { data, error: metricError } = await supabase
                .from('session_snapshot_metric')
                .select('session_snapshot_id, metric_key, metric_name, avg_score, avg_raw_value, min_raw_value, max_raw_value, sample_count')
                .in('session_snapshot_id', allSnapshotIds);
            if (metricError) throw metricError;
            metricRows = data || [];
        }

        if (finalSnapshot?.session_snapshot_id) {
            snapshotMetrics = metricRows.filter((row) => row.session_snapshot_id === finalSnapshot.session_snapshot_id);
        }

        const interimSnapshotIds = (interimSnapshots || [])
            .map((snapshot) => snapshot.session_snapshot_id)
            .filter(Boolean);

        let interimScoreBySnapshotId = new Map();
        if (interimSnapshotIds.length > 0) {
            const { data: interimScoreRows, error: interimScoreError } = await supabase
                .from('session_snapshot_score')
                .select('session_snapshot_id, score')
                .in('session_snapshot_id', interimSnapshotIds);
            if (interimScoreError) throw interimScoreError;

            interimScoreBySnapshotId = new Map(
                (interimScoreRows || []).map((row) => [row.session_snapshot_id, row.score])
            );
        }

        const { data: sessionEvents, error: eventError } = await supabase
            .from('session_event')
            .select('event_id, event_time, type')
            .eq('session_id', sessionId)
            .order('event_time', { ascending: false })
            .limit(100);
        if (eventError) throw eventError;

        const mergedSession = mergeSessionResult(session, snapshotScore);
        const timeline = buildTimelineFromSnapshots({
            startedAt: mergedSession.started_at,
            interimSnapshots,
            interimScoreBySnapshotId,
            finalSnapshot,
            finalScore: snapshotScore?.score ?? mergedSession.final_score
        });
        const metricSeries = buildMetricSeries({
            startedAt: mergedSession.started_at,
            snapshots: allSnapshots,
            metricRows
        });

        const sortedMetrics = [...snapshotMetrics].sort((a, b) => {
            const scoreDiff = toFiniteNumber(b.avg_score, 0) - toFiniteNumber(a.avg_score, 0);
            if (scoreDiff !== 0) return scoreDiff;
            return String(a.metric_name || '').localeCompare(String(b.metric_name || ''), 'ko');
        });
        const accuracyFocus = buildAccuracyFocus({
            session: mergedSession,
            metrics: sortedMetrics,
            metricSeries
        });
        const improvementFocus = buildImprovementFocus({
            session: mergedSession,
            metrics: sortedMetrics,
            sessionEvents: sessionEvents || []
        });
        const focusPreview = buildFocusPreview({
            session: mergedSession,
            metrics: sortedMetrics
        });

        const routineContext = await loadRoutineContextBySetId(mergedSession.set_id);

        return res.json({
            success: true,
            session: {
                ...mergedSession,
                final_snapshot: finalSnapshot
                    ? {
                        session_snapshot_id: finalSnapshot.session_snapshot_id,
                        snapshot_no: finalSnapshot.snapshot_no,
                        recorded_at: finalSnapshot.recorded_at
                    }
                    : null
            },
            metrics: sortedMetrics,
            metric_series: metricSeries,
            accuracy_focus: accuracyFocus,
            improvement_focus: improvementFocus,
            focus_preview: focusPreview,
            timeline,
            session_events: sessionEvents || [],
            routine_context: routineContext
        });
    } catch (error) {
        next(error);
    }
};

// 루틴 실행 상세 조회 API
const getRoutineHistoryDetail = async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const routineInstanceId = Number.parseInt(req.params.routineInstanceId, 10);

        if (!Number.isFinite(routineInstanceId)) {
            return res.status(400).json({ success: false, error: '유효하지 않은 루틴 실행 ID입니다.' });
        }

        const { data: routineRun, error: routineError } = await supabase
            .from('routine_instance')
            .select(`
                routine_instance_id,
                routine_id,
                status,
                started_at,
                ended_at,
                total_score,
                routine:routine_id (
                    routine_id,
                    name
                )
            `)
            .eq('routine_instance_id', routineInstanceId)
            .eq('user_id', userId)
            .maybeSingle();

        if (routineError) throw routineError;
        if (!routineRun) {
            return res.status(404).json({ success: false, error: '루틴 실행 기록을 찾을 수 없습니다.' });
        }

        const { data: stepRows, error: stepError } = await supabase
            .from('routine_step_instance')
            .select(`
                step_instance_id,
                routine_instance_id,
                order_no,
                exercise_id,
                status,
                exercise:exercise_id (
                    exercise_id,
                    code,
                    name
                )
            `)
            .eq('routine_instance_id', routineInstanceId)
            .order('order_no', { ascending: true });
        if (stepError) throw stepError;

        const stepIds = (stepRows || [])
            .map((row) => row.step_instance_id)
            .filter(Boolean);

        let setRows = [];
        if (stepIds.length > 0) {
            const { data, error } = await supabase
                .from('workout_set')
                .select(`
                    set_id,
                    step_instance_id,
                    set_no,
                    actual_value,
                    value_unit,
                    result_basis,
                    status,
                    duration_sec
                `)
                .in('step_instance_id', stepIds)
                .order('set_no', { ascending: true });
            if (error) throw error;
            setRows = data || [];
        }

        const setIds = setRows
            .map((row) => row.set_id)
            .filter(Boolean);

        let sessionRows = [];
        if (setIds.length > 0) {
            const { data, error } = await supabase
                .from('workout_session')
                .select(`
                    session_id,
                    mode,
                    status,
                    selected_view,
                    set_id,
                    result_basis,
                    total_result_value,
                    total_result_unit,
                    final_score,
                    summary_feedback,
                    started_at,
                    ended_at,
                    exercise:exercise_id (
                        exercise_id,
                        code,
                        name
                    )
                `)
                .eq('user_id', userId)
                .in('set_id', setIds);
            if (error) throw error;
            sessionRows = data || [];
        }

        const { snapshotScoreBySessionId } = await fetchFinalSnapshotMaps(
            sessionRows.map((row) => row.session_id)
        );

        const normalizedSessions = sessionRows.map((session) => {
            const snapshotScore = snapshotScoreBySessionId.get(session.session_id) || null;
            return mergeSessionResult(session, snapshotScore);
        });

        const sequence = buildRoutineStepSequence({
            steps: stepRows || [],
            sets: setRows || [],
            sessions: normalizedSessions
        });

        const totalDurationSec = normalizedSessions.reduce(
            (sum, session) => sum + toRoundedNonNegativeInt(session?.duration_sec, 0),
            0
        );
        const doneSessions = normalizedSessions.filter(
            (session) => String(session?.status || '').toUpperCase() === 'DONE'
        );

        const sequencePreview = buildRoutineSequencePreview(sequence);
        const validSessionScores = normalizedSessions
            .map((session) => Number(session?.final_score))
            .filter((score) => Number.isFinite(score));
        const averageSessionScore = validSessionScores.length > 0
            ? validSessionScores.reduce((sum, score) => sum + score, 0) / validSessionScores.length
            : 0;

        return res.json({
            success: true,
            routine_run: {
                routine_instance_id: routineRun.routine_instance_id,
                routine_id: routineRun.routine_id,
                routine_name: routineRun?.routine?.name || `루틴 #${routineRun.routine_id || routineInstanceId}`,
                status: String(routineRun?.status || '').toUpperCase() || 'DONE',
                started_at: routineRun.started_at,
                ended_at: routineRun.ended_at,
                total_score: Math.round(Math.max(0, Math.min(100, averageSessionScore))),
                total_duration_sec: totalDurationSec,
                total_sessions: normalizedSessions.length,
                done_sessions: doneSessions.length,
                sequence_preview: sequencePreview
            },
            sequence
        });
    } catch (error) {
        next(error);
    }
};

// 통계 데이터 API (차트용)
const getHistoryStats = async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const parsedDays = Number.parseInt(req.query.days, 10);
        const safeDays = Number.isFinite(parsedDays)
            ? Math.min(Math.max(parsedDays, 7), 180)
            : 30;

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - (safeDays - 1));
        startDate.setHours(0, 0, 0, 0);

        const { data: sessions, error } = await supabase
            .from('workout_session')
            .select(`
                session_id,
                started_at,
                ended_at,
                final_score,
                result_basis,
                total_result_value,
                total_result_unit,
                mode,
                selected_view,
                exercise:exercise_id (
                    exercise_id,
                    code,
                    name
                )
            `)
            .eq('user_id', userId)
            .eq('status', 'DONE')
            .gte('started_at', startDate.toISOString())
            .order('started_at', { ascending: true });

        if (error) throw error;

        const dailyStats = {};
        const exerciseStats = {};

        for (const rawSession of sessions || []) {
            const session = mergeSessionResult(rawSession);
            const startedAt = new Date(session.started_at);
            if (Number.isNaN(startedAt.getTime())) continue;

            const dateKey = startedAt.toISOString().split('T')[0];

            if (!dailyStats[dateKey]) {
                dailyStats[dateKey] = {
                    date: dateKey,
                    count: 0,
                    totalMinutes: 0,
                    totalReps: 0,
                    totalResultSec: 0,
                    bestScore: 0,
                    scoreSamples: []
                };
            }

            dailyStats[dateKey].count += 1;
            dailyStats[dateKey].totalMinutes += Math.round((session.duration_sec || 0) / 60);
            dailyStats[dateKey].totalReps += session.total_reps || 0;
            dailyStats[dateKey].totalResultSec += session.total_duration_result || 0;
            dailyStats[dateKey].scoreSamples.push(session.final_score || 0);
            dailyStats[dateKey].bestScore = Math.max(dailyStats[dateKey].bestScore, session.final_score || 0);

            const exerciseName = session.exercise?.name || '기타';
            const exerciseCode = session.exercise?.code || 'etc';
            if (!exerciseStats[exerciseCode]) {
                exerciseStats[exerciseCode] = {
                    code: exerciseCode,
                    name: exerciseName,
                    count: 0,
                    totalMinutes: 0,
                    totalReps: 0,
                    totalResultSec: 0,
                    bestScore: 0,
                    scoreSamples: []
                };
            }

            exerciseStats[exerciseCode].count += 1;
            exerciseStats[exerciseCode].totalMinutes += Math.round((session.duration_sec || 0) / 60);
            exerciseStats[exerciseCode].totalReps += session.total_reps || 0;
            exerciseStats[exerciseCode].totalResultSec += session.total_duration_result || 0;
            exerciseStats[exerciseCode].bestScore = Math.max(exerciseStats[exerciseCode].bestScore, session.final_score || 0);
            exerciseStats[exerciseCode].scoreSamples.push(session.final_score || 0);
        }

        const daily = Object.values(dailyStats)
            .map((row) => ({
                date: row.date,
                count: row.count,
                totalMinutes: row.totalMinutes,
                totalReps: row.totalReps,
                totalResultSec: row.totalResultSec,
                bestScore: row.bestScore,
                avgScore: row.scoreSamples.length > 0
                    ? Math.round(row.scoreSamples.reduce((sum, score) => sum + score, 0) / row.scoreSamples.length)
                    : 0
            }))
            .sort((a, b) => a.date.localeCompare(b.date));

        const exercises = Object.values(exerciseStats)
            .map((row) => ({
                code: row.code,
                name: row.name,
                count: row.count,
                totalMinutes: row.totalMinutes,
                totalReps: row.totalReps,
                totalResultSec: row.totalResultSec,
                bestScore: row.bestScore,
                avgScore: row.scoreSamples.length > 0
                    ? Math.round(row.scoreSamples.reduce((sum, score) => sum + score, 0) / row.scoreSamples.length)
                    : 0
            }))
            .sort((a, b) => {
                if (b.count !== a.count) return b.count - a.count;
                return b.avgScore - a.avgScore;
            });

        return res.json({
            success: true,
            requestedDays: safeDays,
            daily,
            exercises
        });
    } catch (error) {
        next(error);
    }
};

// 세션 삭제
const deleteSession = async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const sessionId = Number.parseInt(req.params.sessionId, 10);

        if (!Number.isFinite(sessionId)) {
            return res.status(400).json({ success: false, error: '유효하지 않은 세션 ID입니다.' });
        }

        const { data: session, error: checkError } = await supabase
            .from('workout_session')
            .select('session_id')
            .eq('session_id', sessionId)
            .eq('user_id', userId)
            .maybeSingle();

        if (checkError) throw checkError;
        if (!session) {
            return res.status(404).json({ success: false, error: '세션을 찾을 수 없습니다.' });
        }

        const { error: deleteError } = await supabase
            .from('workout_session')
            .delete()
            .eq('session_id', sessionId)
            .eq('user_id', userId);

        if (deleteError) throw deleteError;

        return res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getHistoryPage,
    getSessionDetail,
    getRoutineHistoryDetail,
    getHistoryStats,
    deleteSession,
    __test: {
        buildMetricSeries
    }
};
