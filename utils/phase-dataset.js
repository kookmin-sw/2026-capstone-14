const PHASE_DATASET_SCHEMA_VERSION = 1;
const DEFAULT_PHASE_SAMPLE_MS = 200;
const MAX_FEATURE_FRAMES = 6000;
const MAX_LABEL_ENTRIES = 6000;
const VALID_PHASES = ['NEUTRAL', 'DESCENT', 'BOTTOM', 'ASCENT', 'LOCKOUT'];
const VALID_REP_STATES = ['NEUTRAL', 'TRANSITION', 'ACTIVE'];
const VALID_VIEWS = ['FRONT', 'SIDE', 'UNKNOWN'];
const VALID_QUALITY_LEVELS = ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toRoundedNumber = (value, digits = 2) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    const factor = 10 ** digits;
    return Math.round(parsed * factor) / factor;
};

const toNonNegativeInt = (value, fallback = 0) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.round(parsed));
};

const normalizeEnum = (value, validValues, fallback) => {
    const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return validValues.includes(normalized) ? normalized : fallback;
};

const normalizeExerciseCode = (value) => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase().replace(/-/g, '_');
    return normalized ? normalized.slice(0, 80) : null;
};

const sanitizeFeatureFrame = (frame, index) => {
    if (!isPlainObject(frame)) return null;

    const features = isPlainObject(frame.features) ? frame.features : {};
    const timestampMs = toNonNegativeInt(
        frame.timestamp_ms ?? frame.timestamp ?? frame.relative_time_ms,
        index * DEFAULT_PHASE_SAMPLE_MS
    );
    const normalized = {
        frame_index: index,
        timestamp_ms: timestampMs,
        exercise_code: normalizeExerciseCode(frame.exercise_code),
        rule_phase: normalizeEnum(frame.rule_phase ?? frame.phase, VALID_PHASES, 'NEUTRAL'),
        rep_state: normalizeEnum(frame.rep_state ?? frame.state, VALID_REP_STATES, 'NEUTRAL'),
        view: normalizeEnum(frame.view, VALID_VIEWS, 'UNKNOWN'),
        angle_source: typeof frame.angle_source === 'string'
            ? frame.angle_source.trim().slice(0, 40)
            : null,
        current_score: toRoundedNumber(frame.current_score ?? frame.score, 2),
        quality_score: toRoundedNumber(frame.quality_score, 4),
        quality_level: normalizeEnum(frame.quality_level, VALID_QUALITY_LEVELS, 'UNKNOWN'),
        tracked_joint_ratio: toRoundedNumber(frame.tracked_joint_ratio, 4),
        in_frame_ratio: toRoundedNumber(frame.in_frame_ratio, 4),
        flags: {
            bottom_reached: Boolean(frame.flags?.bottom_reached ?? frame.bottom_reached),
            ascent_started: Boolean(frame.flags?.ascent_started ?? frame.ascent_started)
        },
        features: {
            primary_angle: toRoundedNumber(features.primary_angle ?? frame.primary_angle, 2),
            knee_angle: toRoundedNumber(features.knee_angle ?? frame.knee_angle, 2),
            hip_angle: toRoundedNumber(features.hip_angle ?? frame.hip_angle, 2),
            spine_angle: toRoundedNumber(features.spine_angle ?? frame.spine_angle, 2),
            left_knee: toRoundedNumber(features.left_knee ?? frame.left_knee, 2),
            right_knee: toRoundedNumber(features.right_knee ?? frame.right_knee, 2),
            knee_symmetry: toRoundedNumber(features.knee_symmetry ?? frame.knee_symmetry, 2),
            knee_alignment: toRoundedNumber(features.knee_alignment ?? frame.knee_alignment, 4)
        }
    };

    return normalized;
};

const normalizeFeatureFrames = (frames, sampleMs = DEFAULT_PHASE_SAMPLE_MS) => {
    if (!Array.isArray(frames) || frames.length === 0) return [];

    return frames
        .slice(0, MAX_FEATURE_FRAMES)
        .map((frame, index) => sanitizeFeatureFrame(frame, index))
        .filter(Boolean)
        .map((frame, index) => ({
            ...frame,
            frame_index: index,
            timestamp_ms: Number.isFinite(frame.timestamp_ms)
                ? frame.timestamp_ms
                : (index * sampleMs)
        }));
};

const resolveLabelFrameIndex = (entry, frames) => {
    const explicitIndex = Number(entry?.frame_index ?? entry?.frameIndex ?? entry?.index);
    if (Number.isFinite(explicitIndex) && explicitIndex >= 0 && explicitIndex < frames.length) {
        return Math.round(explicitIndex);
    }

    const timestampMs = Number(entry?.timestamp_ms ?? entry?.timestamp ?? entry?.relative_time_ms);
    if (!Number.isFinite(timestampMs) || timestampMs < 0 || frames.length === 0) {
        return null;
    }

    let bestIndex = 0;
    let bestDistance = Infinity;
    for (const frame of frames) {
        const distance = Math.abs((frame.timestamp_ms || 0) - timestampMs);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = frame.frame_index;
        }
    }
    return bestIndex;
};

const getLabelSourceEntries = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (!isPlainObject(payload)) return [];

    const candidates = [
        payload.labels,
        payload.phase_labels,
        payload.annotations,
        payload.frames
    ];

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate;
        }
    }

    return [];
};

const normalizePhaseLabels = (payload, frames) => {
    if (!Array.isArray(frames) || frames.length === 0) return [];

    const entries = getLabelSourceEntries(payload).slice(0, MAX_LABEL_ENTRIES);
    const byFrameIndex = new Map();

    for (const entry of entries) {
        if (!isPlainObject(entry)) continue;

        const phase = normalizeEnum(
            entry.phase ?? entry.human_phase ?? entry.label ?? entry.value,
            VALID_PHASES,
            null
        );
        if (!phase) continue;

        const frameIndex = resolveLabelFrameIndex(entry, frames);
        if (frameIndex == null) continue;

        const note = typeof entry.note === 'string' ? entry.note.trim().slice(0, 300) : null;
        const frame = frames[frameIndex];

        byFrameIndex.set(frameIndex, {
            frame_index: frameIndex,
            timestamp_ms: frame?.timestamp_ms ?? (frameIndex * DEFAULT_PHASE_SAMPLE_MS),
            phase,
            note
        });
    }

    return Array.from(byFrameIndex.values()).sort((a, b) => a.frame_index - b.frame_index);
};

const normalizePhaseDataset = (dataset) => {
    const source = isPlainObject(dataset) ? dataset : {};
    const sampleMs = Math.max(50, toNonNegativeInt(source.sample_ms, DEFAULT_PHASE_SAMPLE_MS));
    const featureFrames = normalizeFeatureFrames(
        source.feature_frames ?? source.frames,
        sampleMs
    );
    const labels = normalizePhaseLabels(
        source.labels ?? source.phase_labels ?? [],
        featureFrames
    );
    const exerciseCodes = [...new Set(
        featureFrames
            .map((frame) => frame.exercise_code)
            .filter(Boolean)
    )];

    return {
        schema_version: PHASE_DATASET_SCHEMA_VERSION,
        sample_ms: sampleMs,
        phase_set: VALID_PHASES.slice(),
        exercise_code: normalizeExerciseCode(source.exercise_code) || exerciseCodes[0] || null,
        feature_frames: featureFrames,
        labels,
        labeling_status: featureFrames.length === 0
            ? 'not_available'
            : (labels.length > 0 ? 'labeled' : 'pending'),
        capture_meta: {
            source: 'session_capture',
            exercise_codes: exerciseCodes,
            frame_count: featureFrames.length,
            labeled_frame_count: labels.length,
            collected_at: typeof source.capture_meta?.collected_at === 'string'
                ? source.capture_meta.collected_at
                : new Date().toISOString()
        }
    };
};

const mergePhaseLabelsIntoDetail = (detail, payload) => {
    const sourceDetail = isPlainObject(detail) ? { ...detail } : {};
    const dataset = normalizePhaseDataset(sourceDetail.phase_dataset);

    if (!dataset.feature_frames.length) {
        const error = new Error('phase dataset이 없는 세션입니다.');
        error.statusCode = 409;
        throw error;
    }

    const labels = normalizePhaseLabels(payload, dataset.feature_frames);
    const mergedDataset = {
        ...dataset,
        labels,
        labeling_status: labels.length > 0 ? 'labeled' : 'pending',
        capture_meta: {
            ...dataset.capture_meta,
            labeled_frame_count: labels.length,
            label_updated_at: new Date().toISOString()
        }
    };

    return {
        detail: {
            ...sourceDetail,
            phase_dataset: mergedDataset
        },
        dataset: mergedDataset
    };
};

const buildPhaseDatasetExport = (session) => {
    const dataset = normalizePhaseDataset(session?.detail?.phase_dataset);
    const labelMap = new Map(dataset.labels.map((item) => [item.frame_index, item.phase]));
    const samples = dataset.feature_frames.map((frame) => ({
        ...frame,
        human_phase: labelMap.get(frame.frame_index) || null
    }));

    return {
        schema_version: PHASE_DATASET_SCHEMA_VERSION,
        session_id: session?.session_id || null,
        exercise_code: session?.exercise?.code || dataset.exercise_code,
        sample_ms: dataset.sample_ms,
        phase_set: dataset.phase_set,
        summary: {
            total_frames: samples.length,
            labeled_frames: dataset.labels.length,
            unlabeled_frames: Math.max(0, samples.length - dataset.labels.length),
            labeling_status: dataset.labeling_status
        },
        labels: dataset.labels,
        samples
    };
};

module.exports = {
    DEFAULT_PHASE_SAMPLE_MS,
    VALID_PHASES,
    normalizeFeatureFrames,
    normalizePhaseLabels,
    normalizePhaseDataset,
    mergePhaseLabelsIntoDetail,
    buildPhaseDatasetExport
};
