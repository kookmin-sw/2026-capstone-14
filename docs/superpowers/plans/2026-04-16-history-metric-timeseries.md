# History Metric Timeseries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 히스토리 상세 모달에서 운동 세션별 메트릭 점수 시계열 그래프를 볼 수 있게 만든다.

**Architecture:** 운동 종료 시 프런트 `SessionBuffer`가 1초 샘플링 breakdown을 `interim_snapshots`로 내보내고, 서버 `history` 상세 API가 `INTERIM + FINAL` 메트릭을 묶어 `metric_series`를 응답한다. 프런트 `history-page.js`는 이 구조를 받아 단일 메트릭 선택형 차트와 요약 영역을 렌더한다.

**Tech Stack:** Node.js, Express, Supabase, EJS, 브라우저 JS, Node built-in test runner

---

### Task 1: Interim Snapshot Export 보강

**Files:**
- Modify: `public/js/workout/session-buffer.js`
- Test: `test/session-buffer.test.js`

- [ ] **Step 1: Write the failing test**

```js
test('generateInterimSnapshots includes breakdown metrics for each sampled point', () => {
  const buffer = new SessionBuffer('FRONT');
  buffer.startTime = Date.now() - 5000;
  buffer.scoreTimeline = [{
    timestamp: 1000,
    score: 82,
    breakdown: [{
      key: 'depth',
      title: '깊이',
      score: 82,
      rawValue: 41,
      minRaw: 38,
      maxRaw: 45,
      sampleCount: 4
    }]
  }];

  const snapshots = buffer.generateInterimSnapshots();

  assert.deepEqual(snapshots[0].breakdown, [{
    metric_key: 'depth',
    metric_name: '깊이',
    avg_score: 82,
    avg_raw_value: 41,
    min_raw_value: 38,
    max_raw_value: 45,
    sample_count: 4
  }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/session-buffer.test.js`
Expected: FAIL because exported `breakdown` is missing

- [ ] **Step 3: Write minimal implementation**

```js
generateInterimSnapshots() {
  return this.scoreTimeline.map((item) => ({
    timestamp_ms: item.timestamp,
    score: item.score,
    breakdown: this.normalizeSnapshotBreakdown(item.breakdown)
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/session-buffer.test.js`
Expected: PASS

### Task 2: History Metric Series API 추가

**Files:**
- Modify: `controllers/history.js`
- Test: `test/history-metric-series.test.js`

- [ ] **Step 1: Write the failing test**

```js
test('buildMetricSeries groups interim and final metrics by metric key', () => {
  const series = buildMetricSeries({
    startedAt: '2026-04-16T10:00:00.000Z',
    snapshots: [
      { session_snapshot_id: 11, snapshot_no: 1, snapshot_type: 'INTERIM', recorded_at: '2026-04-16T10:00:05.000Z' },
      { session_snapshot_id: 12, snapshot_no: 2, snapshot_type: 'FINAL', recorded_at: '2026-04-16T10:00:09.000Z' }
    ],
    metricRows: [
      { session_snapshot_id: 11, metric_key: 'depth', metric_name: '깊이', avg_score: 42, sample_count: 3 },
      { session_snapshot_id: 12, metric_key: 'depth', metric_name: '깊이', avg_score: 75, sample_count: 6 }
    ]
  });

  assert.equal(series[0].points.length, 2);
  assert.equal(series[0].points[0].t_sec, 5);
  assert.equal(series[0].points[1].snapshot_type, 'FINAL');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/history-metric-series.test.js`
Expected: FAIL because `buildMetricSeries` does not exist yet

- [ ] **Step 3: Write minimal implementation**

```js
const buildMetricSeries = ({ startedAt, snapshots = [], metricRows = [] }) => {
  // snapshot header lookup -> metric key grouping -> time delta calculation
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/history-metric-series.test.js`
Expected: PASS

- [ ] **Step 5: Wire API response**

```js
return res.json({
  success: true,
  session: ...,
  metrics: sortedMetrics,
  metric_series: buildMetricSeries(...),
  timeline,
  session_events: sessionEvents || [],
  routine_context: routineContext
});
```

### Task 3: Detail Modal Metric Chart UI 추가

**Files:**
- Modify: `public/js/history-page.js`
- Modify: `public/history-v2.css`

- [ ] **Step 1: Add rendering helpers for metric timeseries**

```js
function renderMetricSeriesSection(metricSeries) {
  // selector chips + summary cards + svg chart + fallback message
}
```

- [ ] **Step 2: Update detail response handling**

```js
const metricSeries = Array.isArray(payload.metric_series) ? payload.metric_series : [];
```

- [ ] **Step 3: Insert section into modal body**

```js
<section class="detail-panel">
  <h4>메트릭 점수 시계열</h4>
  ${renderMetricSeriesSection(metricSeries)}
</section>
```

- [ ] **Step 4: Add minimal styles**

```css
.detail-series-selector { ... }
.detail-series-chart { ... }
.detail-series-summary { ... }
```

- [ ] **Step 5: Run focused and full verification**

Run: `node --test test/session-buffer.test.js test/history-metric-series.test.js`
Expected: PASS

Run: `npm test`
Expected: PASS
