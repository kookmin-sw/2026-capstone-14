const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizePhaseDataset,
    normalizePhaseLabels,
    mergePhaseLabelsIntoDetail,
    buildPhaseDatasetExport
} = require('../utils/phase-dataset');

test('normalizePhaseDataset sanitizes feature frames and labeling status', () => {
    const dataset = normalizePhaseDataset({
        sample_ms: 180,
        exercise_code: 'squat',
        feature_frames: [
            {
                timestamp_ms: 0,
                phase: 'descent',
                state: 'active',
                view: 'side',
                features: {
                    primary_angle: 145.456,
                    knee_alignment: 0.08333
                }
            },
            {
                timestamp_ms: 200,
                rule_phase: 'bottom',
                rep_state: 'active',
                quality_level: 'high'
            }
        ]
    });

    assert.equal(dataset.sample_ms, 180);
    assert.equal(dataset.feature_frames.length, 2);
    assert.equal(dataset.feature_frames[0].rule_phase, 'DESCENT');
    assert.equal(dataset.feature_frames[0].rep_state, 'ACTIVE');
    assert.equal(dataset.feature_frames[0].view, 'SIDE');
    assert.equal(dataset.feature_frames[0].features.primary_angle, 145.46);
    assert.equal(dataset.feature_frames[0].features.knee_alignment, 0.0833);
    assert.equal(dataset.labeling_status, 'pending');
});

test('normalizePhaseLabels resolves timestamps against nearest frame', () => {
    const frames = normalizePhaseDataset({
        feature_frames: [
            { timestamp_ms: 0, phase: 'neutral' },
            { timestamp_ms: 200, phase: 'descent' },
            { timestamp_ms: 400, phase: 'bottom' }
        ]
    }).feature_frames;

    const labels = normalizePhaseLabels({
        labels: [
            { timestamp_ms: 190, phase: 'DESCENT' },
            { timestamp_ms: 420, phase: 'ASCENT' }
        ]
    }, frames);

    assert.deepEqual(labels, [
        { frame_index: 1, timestamp_ms: 200, phase: 'DESCENT', note: null },
        { frame_index: 2, timestamp_ms: 400, phase: 'ASCENT', note: null }
    ]);
});

test('mergePhaseLabelsIntoDetail replaces labels and updates status', () => {
    const detail = {
        phase_dataset: {
            feature_frames: [
                { timestamp_ms: 0, phase: 'neutral' },
                { timestamp_ms: 200, phase: 'descent' }
            ]
        }
    };

    const { detail: mergedDetail, dataset } = mergePhaseLabelsIntoDetail(detail, [
        { frame_index: 1, phase: 'BOTTOM', note: 'manual correction' }
    ]);

    assert.equal(dataset.labeling_status, 'labeled');
    assert.equal(dataset.labels.length, 1);
    assert.equal(dataset.labels[0].phase, 'BOTTOM');
    assert.equal(mergedDetail.phase_dataset.capture_meta.labeled_frame_count, 1);
});

test('buildPhaseDatasetExport merges rule and human phases for training export', () => {
    const exportData = buildPhaseDatasetExport({
        session_id: 'session-1',
        exercise: { code: 'squat' },
        detail: {
            phase_dataset: {
                feature_frames: [
                    { timestamp_ms: 0, phase: 'neutral' },
                    { timestamp_ms: 200, phase: 'descent' }
                ],
                labels: [
                    { frame_index: 1, phase: 'ASCENT' }
                ]
            }
        }
    });

    assert.equal(exportData.session_id, 'session-1');
    assert.equal(exportData.summary.total_frames, 2);
    assert.equal(exportData.summary.labeled_frames, 1);
    assert.equal(exportData.samples[0].human_phase, null);
    assert.equal(exportData.samples[1].human_phase, 'ASCENT');
    assert.equal(exportData.samples[1].rule_phase, 'DESCENT');
});
