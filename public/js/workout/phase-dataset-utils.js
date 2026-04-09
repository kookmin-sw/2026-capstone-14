(function initPhaseDatasetUtils(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }

  root.PhaseDatasetUtils = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildPhaseDatasetUtils() {
  const KNOWN_PHASES = ['NEUTRAL', 'DESCENT', 'BOTTOM', 'ASCENT', 'LOCKOUT'];

  function normalizePhaseLabel(label, fallback = null) {
    if (typeof label !== 'string') return fallback;

    const normalized = label
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');

    return KNOWN_PHASES.includes(normalized) ? normalized : fallback;
  }

  function toNumber(value, fallback = null) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function normalizeLabelPayload(labelPayload) {
    const source = Array.isArray(labelPayload)
      ? { labels: labelPayload }
      : (labelPayload && typeof labelPayload === 'object' ? labelPayload : {});
    const segments = Array.isArray(source.segments) ? source.segments : [];
    const labels = Array.isArray(source.labels)
      ? source.labels
      : (Array.isArray(source.frames) ? source.frames : []);

    const normalizedSegments = segments
      .map((segment, index) => {
        const phase = normalizePhaseLabel(segment?.phase);
        const startMs = toNumber(segment?.start_ms ?? segment?.startMs);
        const endMs = toNumber(segment?.end_ms ?? segment?.endMs);
        if (!phase || startMs == null || endMs == null || endMs < startMs) {
          return null;
        }

        return {
          id: segment?.id || `segment-${index + 1}`,
          phase,
          start_ms: Math.round(startMs),
          end_ms: Math.round(endMs),
          note: typeof segment?.note === 'string' ? segment.note.trim() : null
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.start_ms - b.start_ms);

    const normalizedLabels = labels
      .map((item, index) => {
        const phase = normalizePhaseLabel(item?.phase);
        const frameIndex = toNumber(item?.frame_index ?? item?.frameIndex ?? item?.index);
        const timestampMs = toNumber(item?.timestamp_ms ?? item?.timestampMs ?? item?.timestamp);
        if (!phase || (frameIndex == null && timestampMs == null)) {
          return null;
        }

        return {
          id: item?.id || `label-${index + 1}`,
          frame_index: frameIndex == null ? null : Math.round(frameIndex),
          timestamp_ms: timestampMs == null ? null : Math.round(timestampMs),
          phase,
          note: typeof item?.note === 'string' ? item.note.trim() : null
        };
      })
      .filter(Boolean);

    return {
      schema_version: source.schema_version || 1,
      label_source: typeof source.label_source === 'string' ? source.label_source.trim() : 'manual-json',
      notes: typeof source.notes === 'string' ? source.notes.trim() : '',
      segments: normalizedSegments,
      labels: normalizedLabels
    };
  }

  function getFeatureFrames(rawDataset) {
    if (Array.isArray(rawDataset?.feature_frames)) {
      return rawDataset.feature_frames;
    }
    if (Array.isArray(rawDataset?.frames)) {
      return rawDataset.frames;
    }
    return [];
  }

  function findSegmentPhase(segments, timestampMs) {
    for (const segment of segments) {
      if (timestampMs >= segment.start_ms && timestampMs <= segment.end_ms) {
        return segment.phase;
      }
    }
    return null;
  }

  function buildSummary(featureFrames, labels) {
    return {
      total_frames: featureFrames.length,
      labeled_frames: labels.length,
      unlabeled_frames: Math.max(0, featureFrames.length - labels.length),
      labeling_status: featureFrames.length === 0 ? 'not_available' : (labels.length > 0 ? 'labeled' : 'pending')
    };
  }

  function buildSamples(featureFrames, labelMap) {
    return featureFrames.map((frame) => {
      const frameIndex = Number.isFinite(frame?.frame_index) ? frame.frame_index : 0;
      return {
        ...frame,
        human_phase: labelMap.get(frameIndex) || null
      };
    });
  }

  function labelPhaseDataset(rawDataset, labelPayload) {
    const dataset = cloneJson(rawDataset);
    const featureFrames = getFeatureFrames(dataset);
    const normalizedPayload = normalizeLabelPayload(labelPayload);
    const normalizedLabels = [];
    const usedFrameIndexes = new Set();

    for (const item of normalizedPayload.labels) {
      let frameIndex = item.frame_index;
      if (frameIndex == null && item.timestamp_ms != null) {
        frameIndex = resolveNearestFrameIndex(featureFrames, item.timestamp_ms);
      }
      if (frameIndex == null || frameIndex < 0 || frameIndex >= featureFrames.length) {
        continue;
      }

      if (usedFrameIndexes.has(frameIndex)) {
        continue;
      }

      const frame = featureFrames[frameIndex];
      usedFrameIndexes.add(frameIndex);
      normalizedLabels.push({
        frame_index: frameIndex,
        timestamp_ms: frame?.timestamp_ms ?? item.timestamp_ms ?? null,
        phase: item.phase,
        note: item.note || null
      });
    }

    for (const frame of featureFrames) {
      const frameIndex = Number.isFinite(frame?.frame_index) ? frame.frame_index : null;
      if (frameIndex == null || usedFrameIndexes.has(frameIndex)) {
        continue;
      }

      const segmentPhase = findSegmentPhase(normalizedPayload.segments, frame.timestamp_ms);
      if (!segmentPhase) continue;

      usedFrameIndexes.add(frameIndex);
      normalizedLabels.push({
        frame_index: frameIndex,
        timestamp_ms: frame.timestamp_ms ?? null,
        phase: segmentPhase,
        note: null
      });
    }

    normalizedLabels.sort((a, b) => a.frame_index - b.frame_index);
    const labelMap = new Map(normalizedLabels.map((item) => [item.frame_index, item.phase]));

    return {
      ...dataset,
      labels: normalizedLabels,
      label_meta: {
        label_source: normalizedPayload.label_source,
        notes: normalizedPayload.notes || null,
        segment_count: normalizedPayload.segments.length,
        saved_at: new Date().toISOString()
      },
      summary: buildSummary(featureFrames, normalizedLabels),
      samples: buildSamples(featureFrames, labelMap)
    };
  }

  function resolveNearestFrameIndex(featureFrames, timestampMs) {
    if (!featureFrames.length || !Number.isFinite(timestampMs)) return null;

    let bestFrameIndex = null;
    let bestDistance = Infinity;
    for (const frame of featureFrames) {
      const candidateTime = toNumber(frame?.timestamp_ms);
      const candidateIndex = toNumber(frame?.frame_index);
      if (candidateTime == null || candidateIndex == null) continue;

      const distance = Math.abs(candidateTime - timestampMs);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestFrameIndex = candidateIndex;
      }
    }

    return bestFrameIndex;
  }

  function buildTrainingExport(rawDataset, labelPayload) {
    const merged = labelPhaseDataset(rawDataset, labelPayload);
    return {
      schema_version: merged.schema_version || 1,
      session_id: merged?.capture_meta?.sessionId || merged?.meta?.sessionId || null,
      exercise_code: merged.exercise_code || merged?.meta?.exerciseCode || null,
      sample_ms: merged.sample_ms || null,
      phase_set: KNOWN_PHASES.slice(),
      summary: merged.summary,
      labels: merged.labels,
      samples: merged.samples
    };
  }

  return {
    KNOWN_PHASES,
    normalizePhaseLabel,
    normalizeLabelPayload,
    labelPhaseDataset,
    buildTrainingExport
  };
});
