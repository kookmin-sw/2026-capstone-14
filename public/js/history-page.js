(function initHistoryPage() {
  const statusLabelMap = { DONE: '완료', ABORTED: '중단' };
  const viewLabelMap = { FRONT: '정면', SIDE: '측면', DIAGONAL: '대각선', ROUTINE: '루틴' };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('ko-KR').format(Number(value) || 0);
  }

  function toPositiveInt(value) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }

  function formatDuration(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const mins = Math.floor(safe / 60);
    const remain = safe % 60;
    return `${mins}분 ${remain}초`;
  }

  function formatResultValue(resultBasis, resultValue, resultUnit) {
    const basis = String(resultBasis || '').toUpperCase();
    const unit = String(resultUnit || '').toUpperCase();
    const value = Math.max(0, Number(resultValue) || 0);

    if (basis === 'REPS' || unit === 'COUNT') return `${formatNumber(value)}회`;
    if (basis === 'DURATION' || unit === 'SEC') return `${formatNumber(value)}초`;
    return formatNumber(value);
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleString('ko-KR');
  }

  function formatMetricTime(seconds) {
    const safe = Math.max(0, Math.round(Number(seconds) || 0));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  function formatSignedScoreDelta(value) {
    const safe = Number(value) || 0;
    if (Math.abs(safe) < 0.05) return '0점';
    const rounded = Number(safe.toFixed(1));
    return `${rounded > 0 ? '+' : ''}${formatNumber(rounded)}점`;
  }

  function buildLinePath(points) {
    return points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
      .join(' ');
  }

  function renderMetricList(metrics) {
    if (!metrics.length) {
      return '<div class="chart-empty">메트릭 기록이 없습니다.</div>';
    }

    return `
      <div class="detail-metric-list">
        ${metrics.map((metric) => {
          const score = Number(metric.avg_score || 0);
          const scorePercent = Math.max(0, Math.min(100, Math.round(score)));
          const sampleCount = Math.max(0, Number(metric.sample_count || 0));
          return `
            <article class="detail-metric-item">
              <div class="detail-metric-head">
                <span>${escapeHtml(metric.metric_name || metric.metric_key || '항목')}</span>
                <strong>${formatNumber(score)}점</strong>
              </div>
              <div class="detail-metric-meta">샘플 ${formatNumber(sampleCount)}</div>
              <div class="detail-track">
                <span class="detail-fill" style="width:${scorePercent}%"></span>
              </div>
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  function normalizeMetricSeries(metricSeries) {
    return (Array.isArray(metricSeries) ? metricSeries : [])
      .map((series) => ({
        metric_key: String(series?.metric_key || '').trim(),
        metric_name: String(series?.metric_name || series?.metric_key || '메트릭').trim(),
        points: (Array.isArray(series?.points) ? series.points : [])
          .map((point) => {
            const parsedScore = point?.avg_score == null ? null : Number(point.avg_score);
            return {
              snapshot_no: Number(point?.snapshot_no || 0),
              snapshot_type: String(point?.snapshot_type || 'INTERIM').toUpperCase(),
              recorded_at: point?.recorded_at || null,
              t_sec: Math.max(0, Number(point?.t_sec || 0)),
              avg_score: Number.isFinite(parsedScore) ? Math.max(0, Math.min(100, parsedScore)) : null,
              sample_count: Math.max(0, Number(point?.sample_count || 0))
            };
          })
          .filter((point) => point.avg_score != null)
          .sort((a, b) => (a.t_sec - b.t_sec) || (a.snapshot_no - b.snapshot_no))
      }))
      .filter((series) => series.metric_key && series.points.length > 0);
  }

  function renderMetricSeriesChart(series) {
    const rows = Array.isArray(series?.points) ? series.points : [];
    if (!rows.length) {
      return '<div class="chart-empty">시계열 데이터가 없습니다.</div>';
    }

    const padX = 2;
    const padTop = 15;
    const padBottom = 20;
    const usableWidth = 100 - (padX * 2);
    const usableHeight = 100 - padTop - padBottom;
    const minSec = rows[0].t_sec;
    const maxSec = rows[rows.length - 1].t_sec;
    const gradientId = `metric-series-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    let rawMin = Math.min(...rows.map((row) => row.avg_score));
    let rawMax = Math.max(...rows.map((row) => row.avg_score));
    if (rawMax === rawMin) {
      rawMin = Math.max(0, rawMin - 10);
      rawMax = Math.min(100, rawMax + 10);
    } else {
      const range = rawMax - rawMin;
      rawMin = Math.max(0, rawMin - (range * 0.25));
      rawMax = Math.min(100, rawMax + (range * 0.25));
    }
    const yRange = Math.max(1, rawMax - rawMin);

    const points = rows.map((row) => {
      const x = rows.length === 1
        ? 50
        : padX + (((row.t_sec - minSec) / Math.max(maxSec - minSec, 1)) * usableWidth);
      const y = (100 - padBottom) - (((row.avg_score - rawMin) / yRange) * usableHeight);
      return { ...row, x, y };
    });

    const linePath = points.length > 1 ? buildLinePath(points) : '';
    const areaPath = points.length > 1
      ? `${linePath} L${points[points.length - 1].x.toFixed(2)},${100 - padBottom} L${points[0].x.toFixed(2)},${100 - padBottom} Z`
      : '';
    const pointStep = rows.length > 54 ? 9 : rows.length > 36 ? 6 : rows.length > 18 ? 4 : 2;
    const visiblePoints = points.filter((_, index) => rows.length === 1 || index === 0 || index === rows.length - 1 || index % pointStep === 0);
    const lastPointLabel = points[points.length - 1].snapshot_type === 'FINAL' ? '최종' : '마지막';

    return `
      <div class="premium-chart-container">
        <div style="display: flex; gap: 8px;">
          <div style="position: relative; width: 28px; flex-shrink: 0;">
            <span class="y-axis-label" style="top: ${padTop}%">${Math.ceil(rawMax)}</span>
            <span class="y-axis-label" style="top: ${padTop + usableHeight / 2}%">${Math.round((rawMax + rawMin) / 2)}</span>
            <span class="y-axis-label" style="top: ${100 - padBottom}%">${Math.floor(rawMin)}</span>
          </div>

          <div class="premium-chart-area" style="flex-grow: 1;">
            <div class="chart-grid-line" style="top: ${padTop}%; border-top-style: dashed; border-color: rgba(148, 163, 184, 0.15);"></div>
            <div class="chart-grid-line" style="top: ${padTop + usableHeight / 2}%; border-top-style: dashed; border-color: rgba(148, 163, 184, 0.15);"></div>
            <div class="chart-grid-line" style="top: ${100 - padBottom}%; border-top-style: solid; border-color: rgba(148, 163, 184, 0.3);"></div>

            <svg class="chart-svg-layer" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(series.metric_name)} 점수 시계열">
              <defs>
                <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.32"></stop>
                  <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"></stop>
                </linearGradient>
              </defs>
              ${areaPath ? `<path class="chart-area" d="${areaPath}" fill="url(#${gradientId})"></path>` : ''}
              ${linePath ? `<path class="chart-line" d="${linePath}" vector-effect="non-scaling-stroke"></path>` : ''}
            </svg>

            <div class="chart-points-layer">
              ${visiblePoints.map((point, index) => {
                const isFirst = index === 0;
                const isLast = index === visiblePoints.length - 1 && visiblePoints.length > 1;
                const alignClass = isFirst ? 'tooltip-align-left' : isLast ? 'tooltip-align-right' : 'tooltip-align-center';
                return `
                  <div class="chart-point-anchor" style="left: ${point.x.toFixed(2)}%; top: ${point.y.toFixed(2)}%;">
                    <div class="chart-point-hover-area"></div>
                    <div class="chart-point-dot"></div>
                    <div class="chart-tooltip ${alignClass}">
                      <div class="tooltip-time">${escapeHtml(formatMetricTime(point.t_sec))} · ${escapeHtml(point.snapshot_type)}</div>
                      <div class="tooltip-score"><strong>${formatNumber(point.avg_score)}</strong><small>점</small></div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>

        <div class="premium-caption" style="padding-left: 36px;">
          <span>${escapeHtml(formatMetricTime(points[0].t_sec))}</span>
          <span>${escapeHtml(formatMetricTime(points[Math.floor(points.length / 2)].t_sec))}</span>
          <span>${escapeHtml(formatMetricTime(points[points.length - 1].t_sec))} · ${lastPointLabel} ${formatNumber(points[points.length - 1].avg_score)}점</span>
        </div>
      </div>
    `;
  }

  function renderMetricSeriesSection(target, metricSeries) {
    if (!target) return;

    const seriesList = normalizeMetricSeries(metricSeries);
    if (!seriesList.length) {
      target.innerHTML = '<div class="chart-empty">메트릭 시계열 데이터가 없습니다.</div>';
      return;
    }

    let activeKey = seriesList[0].metric_key;

    function renderActiveSeries() {
      const activeSeries = seriesList.find((series) => series.metric_key === activeKey) || seriesList[0];
      activeKey = activeSeries.metric_key;

      const firstPoint = activeSeries.points[0];
      const lastPoint = activeSeries.points[activeSeries.points.length - 1];
      const delta = Number((lastPoint.avg_score - firstPoint.avg_score).toFixed(1));
      const totalSamples = activeSeries.points.reduce((sum, point) => sum + Number(point.sample_count || 0), 0);

      target.innerHTML = `
        <div class="detail-series-shell">
          <div class="detail-series-selector" role="tablist" aria-label="메트릭 선택">
            ${seriesList.map((series) => `
              <button
                type="button"
                class="detail-series-chip ${series.metric_key === activeKey ? 'active' : ''}"
                data-metric-key="${escapeHtml(series.metric_key)}"
              >
                ${escapeHtml(series.metric_name)}
              </button>
            `).join('')}
          </div>

          <div class="detail-series-summary-grid">
            <article class="detail-series-summary-card">
              <label>시작 점수</label>
              <strong>${formatNumber(firstPoint.avg_score)}점</strong>
              <small>${escapeHtml(formatMetricTime(firstPoint.t_sec))}</small>
            </article>
            <article class="detail-series-summary-card">
              <label>마지막 점수</label>
              <strong>${formatNumber(lastPoint.avg_score)}점</strong>
              <small>${escapeHtml(formatMetricTime(lastPoint.t_sec))}</small>
            </article>
            <article class="detail-series-summary-card ${delta > 0.1 ? 'up' : delta < -0.1 ? 'down' : ''}">
              <label>변화량</label>
              <strong>${escapeHtml(formatSignedScoreDelta(delta))}</strong>
              <small>${lastPoint.snapshot_type === 'FINAL' ? 'FINAL 포함' : '중간 스냅샷 기준'}</small>
            </article>
            <article class="detail-series-summary-card">
              <label>포인트 / 샘플</label>
              <strong>${formatNumber(activeSeries.points.length)} / ${formatNumber(totalSamples)}</strong>
              <small>${escapeHtml(activeSeries.metric_name)}</small>
            </article>
          </div>

          ${renderMetricSeriesChart(activeSeries)}
        </div>
      `;

      target.querySelectorAll('[data-metric-key]').forEach((button) => {
        button.addEventListener('click', () => {
          activeKey = button.dataset.metricKey;
          renderActiveSeries();
        });
      });
    }

    renderActiveSeries();
  }

  function renderSimpleList(rows, emptyMessage) {
    if (!rows.length) {
      return `<div class="chart-empty">${escapeHtml(emptyMessage)}</div>`;
    }
    return `<div class="detail-simple-list">${rows.join('')}</div>`;
  }

  function renderAccuracySection(accuracyFocus, metrics) {
    const bestMetric = accuracyFocus?.best_metric || null;
    const weakMetric = accuracyFocus?.weakest_metric || null;
    const scoreGrade = String(accuracyFocus?.score_grade || '-');
    const scoreValue = Number(accuracyFocus?.overall_score || 0);

    return `
      <div class="detail-focus-grid">
        <article class="detail-focus-item">
          <label>최종 정확도</label>
          <strong>${formatNumber(scoreValue)}점</strong>
          <small>등급 ${escapeHtml(scoreGrade)}</small>
        </article>
        <article class="detail-focus-item">
          <label>강점 메트릭</label>
          <strong>${escapeHtml(bestMetric?.metric_name || '-')}</strong>
          <small>${bestMetric ? `${formatNumber(bestMetric.avg_score || 0)}점` : '데이터 없음'}</small>
        </article>
        <article class="detail-focus-item">
          <label>개선 우선 메트릭</label>
          <strong>${escapeHtml(weakMetric?.metric_name || '-')}</strong>
          <small>${weakMetric ? `${formatNumber(weakMetric.avg_score || 0)}점` : '데이터 없음'}</small>
        </article>
      </div>
      ${renderMetricList(Array.isArray(metrics) ? metrics : [])}
    `;
  }

  function renderImprovementSection(improvementFocus) {
    const issues = Array.isArray(improvementFocus?.priority_issues)
      ? improvementFocus.priority_issues
      : [];
    const actions = Array.isArray(improvementFocus?.actions)
      ? improvementFocus.actions
      : [];

    return `
      <p class="detail-feedback">${escapeHtml(improvementFocus?.headline || '개선 우선순위를 정리하는 중입니다.')}</p>
      <div class="detail-improvement-grid">
        <article>
          <h5>우선 개선 항목</h5>
          ${issues.length
            ? `<ol class="detail-issue-list">${issues.map((issue) => `
                <li class="detail-issue-item">
                  <strong>${escapeHtml(issue.metric_name || '항목')}</strong>
                  <span>${escapeHtml(issue.reason || '')}</span>
                </li>
              `).join('')}</ol>`
            : '<p class="muted">우선 개선 항목이 없습니다.</p>'}
        </article>
        <article>
          <h5>다음 세션 행동 가이드</h5>
          ${actions.length
            ? `<ul class="detail-action-list">${actions.map((action) => `<li>${escapeHtml(action)}</li>`).join('')}</ul>`
            : '<p class="muted">추천 행동이 없습니다.</p>'}
        </article>
      </div>
      <p class="detail-camera-note">
        <strong>카메라/신뢰도</strong>
        <span>${escapeHtml(improvementFocus?.camera_note || '카메라 이슈가 감지되지 않았습니다.')}</span>
        <small>신뢰도 ${formatNumber(Number(improvementFocus?.confidence_score || 0) * 100)}%</small>
      </p>
    `;
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function updateVisibleSummary() {
    const items = Array.from(document.querySelectorAll('.history-item'));
    const doneItems = items.filter((item) => String(item.dataset.sessionStatus || '').toUpperCase() === 'DONE');
    const abortedItems = items.filter((item) => String(item.dataset.sessionStatus || '').toUpperCase() === 'ABORTED');
    const scores = items
      .map((item) => Number(item.dataset.sessionScore || 0))
      .filter((score) => Number.isFinite(score));
    const avgScore = scores.length
      ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
      : 0;

    setText('visibleSessionCount', formatNumber(items.length));
    setText('visibleDoneCount', formatNumber(doneItems.length));
    setText('visibleAbortedCount', formatNumber(abortedItems.length));
    setText('visibleAvgScore', `${formatNumber(avgScore)}점`);
  }

  function renderRoutineSequence(body, routineRun, sequence) {
    if (!body) return;

    const scoreText = Number.isFinite(Number(routineRun.total_score))
      ? `${formatNumber(routineRun.total_score)}점`
      : '-';

    body.innerHTML = `
      <section class="detail-top-grid detail-top-grid--focus">
        <article class="detail-stat-card">
          <label>루틴 이름</label>
          <strong>${escapeHtml(routineRun.routine_name || '루틴')}</strong>
          <small>실행 #${escapeHtml(String(routineRun.routine_instance_id || '-'))}</small>
        </article>
        <article class="detail-stat-card">
          <label>상태</label>
          <strong>${escapeHtml(statusLabelMap[String(routineRun.status || '').toUpperCase()] || routineRun.status || '-')}</strong>
          <small>완료 세션 ${formatNumber(routineRun.done_sessions || 0)}회</small>
        </article>
        <article class="detail-stat-card">
          <label>평균 정확도</label>
          <strong>${escapeHtml(scoreText)}</strong>
          <small>전체 운동 세션 평균</small>
        </article>
        <article class="detail-stat-card">
          <label>총 운동 시간</label>
          <strong>${escapeHtml(formatDuration(routineRun.total_duration_sec || 0))}</strong>
          <small>세션 합산</small>
        </article>
        <article class="detail-stat-card">
          <label>실행 시각</label>
          <strong>${escapeHtml(formatDateTime(routineRun.started_at))}</strong>
          <small>종료 ${escapeHtml(formatDateTime(routineRun.ended_at))}</small>
        </article>
      </section>

      <section class="detail-panel">
        <h4>운동 순서</h4>
        ${sequence.length === 0
          ? '<div class="chart-empty">운동 순서 데이터가 없습니다.</div>'
          : `<div class="routine-sequence-list">
              ${sequence.map((item) => {
                const itemSessionId = toPositiveInt(item?.session_id);
                const hasSession = itemSessionId != null;
                return `
                  <button
                    type="button"
                    class="routine-sequence-item ${hasSession ? '' : 'disabled'}"
                    data-session-id="${hasSession ? escapeHtml(String(itemSessionId)) : ''}"
                    ${hasSession ? '' : 'disabled'}
                  >
                    <span class="routine-sequence-order">${formatNumber(item.order_no || 0)}</span>
                    <div class="routine-sequence-content">
                      <strong>${escapeHtml(item.summary_text || item.exercise_name || '운동')}</strong>
                      <small>세트 ${formatNumber(item.set_count || 0)}개 · 세션 ${formatNumber(item.session_count || 0)}개</small>
                    </div>
                    <span class="routine-sequence-action">${hasSession ? '세션 상세 보기' : '세션 없음'}</span>
                  </button>
                `;
              }).join('')}
            </div>`}
      </section>
    `;

    body.querySelectorAll('.routine-sequence-item[data-session-id]').forEach((element) => {
      element.addEventListener('click', () => {
        const sessionId = toPositiveInt(element.dataset.sessionId);
        if (sessionId == null) return;
        viewDetail(sessionId);
      });
    });
  }

  async function viewRoutineDetail(routineInstanceId) {
    const modal = document.getElementById('detailModal');
    const body = document.getElementById('detailModalBody');
    const title = document.getElementById('detailModalTitle');

    if (!modal || !body || !title) return;

    modal.hidden = false;
    title.textContent = '루틴 상세';
    body.innerHTML = '<div class="loading-state">루틴 데이터를 불러오는 중...</div>';

    try {
      const response = await fetch(`/api/history/routine/${routineInstanceId}`);
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '루틴 상세 조회에 실패했습니다.');
      }

      const routineRun = payload.routine_run || {};
      const sequence = Array.isArray(payload.sequence) ? payload.sequence : [];

      title.textContent = `${routineRun.routine_name || '루틴'} · 실행 #${routineRun.routine_instance_id || '-'}`;
      renderRoutineSequence(body, routineRun, sequence);
    } catch (error) {
      console.error('Routine detail load failed:', error);
      body.innerHTML = `<div class="chart-empty">${escapeHtml(error.message || '루틴 상세 정보를 불러오지 못했습니다.')}</div>`;
    }
  }

  async function viewDetail(sessionId) {
    const safeSessionId = toPositiveInt(sessionId);
    if (safeSessionId == null) {
      alert('유효하지 않은 세션 ID입니다.');
      return;
    }

    const modal = document.getElementById('detailModal');
    const body = document.getElementById('detailModalBody');
    const title = document.getElementById('detailModalTitle');

    if (!modal || !body || !title) return;

    modal.hidden = false;
    title.textContent = '세션 상세';
    body.innerHTML = '<div class="loading-state">세션 데이터를 불러오는 중...</div>';

    try {
      const response = await fetch(`/api/history/${safeSessionId}`);
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '세션 상세 조회에 실패했습니다.');
      }

      const session = payload.session || {};
      const metrics = Array.isArray(payload.metrics) ? payload.metrics : [];
      const metricSeries = Array.isArray(payload.metric_series) ? payload.metric_series : [];
      const sessionEvents = Array.isArray(payload.session_events) ? payload.session_events : [];
      const routineContext = payload.routine_context || {};
      const accuracyFocus = payload.accuracy_focus || {};
      const improvementFocus = payload.improvement_focus || {};

      title.textContent = `${session.exercise?.name || '운동'} · 세션 #${session.session_id || '-'}`;

      const eventRows = sessionEvents.slice(0, 20).map((event) => {
        const eventTime = event.event_time
          ? new Date(event.event_time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '-';
        return `
          <div class="detail-simple-item">
            <span>${escapeHtml(eventTime)} · ${escapeHtml(event.type || 'EVENT')}</span>
            <strong>#${formatNumber(event.event_id || 0)}</strong>
          </div>
        `;
      });

      const routineEntries = [];
      if (routineContext.routine?.name) routineEntries.push(['루틴 이름', routineContext.routine.name]);
      if (routineContext.routine_instance?.status) routineEntries.push(['루틴 상태', routineContext.routine_instance.status]);
      if (Number.isFinite(Number(routineContext.workout_set?.set_no))) {
        routineEntries.push(['세트 번호', `${formatNumber(routineContext.workout_set.set_no)}세트`]);
      }
      if (routineContext.workout_set?.status) routineEntries.push(['세트 상태', routineContext.workout_set.status]);

      const debugHtml = `
        <section class="detail-panel detail-debug-panel">
          <details class="detail-debug-box">
            <summary>원본 로그 보기 (디버그)</summary>
            <div class="detail-debug-grid">
              <article>
                <h5>세션 이벤트</h5>
                ${renderSimpleList(eventRows, '이벤트 기록이 없습니다.')}
              </article>
              <article>
                <h5>루틴 컨텍스트</h5>
                ${routineEntries.length
                  ? `<div class="detail-key-grid">${routineEntries.map(([key, value]) => `
                      <div class="detail-key-item">
                        <label>${escapeHtml(key)}</label>
                        <div>${escapeHtml(String(value))}</div>
                      </div>
                    `).join('')}</div>`
                  : '<div class="chart-empty">루틴 컨텍스트가 없습니다.</div>'}
              </article>
            </div>
          </details>
        </section>
      `;

      body.innerHTML = `
        <section class="detail-top-grid detail-top-grid--focus">
          <article class="detail-stat-card">
            <label>운동</label>
            <strong>${escapeHtml(session.exercise?.name || '운동')}</strong>
            <small>${escapeHtml(statusLabelMap[String(session.status || '').toUpperCase()] || session.status || '-')}</small>
          </article>
          <article class="detail-stat-card">
            <label>대표 결과</label>
            <strong>${escapeHtml(formatResultValue(session.result_basis, session.total_result_value, session.total_result_unit))}</strong>
            <small>${escapeHtml(`${session.result_basis || '-'} / ${session.total_result_unit || '-'}`)}</small>
          </article>
          <article class="detail-stat-card">
            <label>운동 시간</label>
            <strong>${escapeHtml(formatDuration(session.duration_sec || 0))}</strong>
            <small>세션 구간 기준</small>
          </article>
          <article class="detail-stat-card">
            <label>뷰</label>
            <strong>${escapeHtml(viewLabelMap[String(session.selected_view || '').toUpperCase()] || session.selected_view || '-')}</strong>
            <small>선택 자세</small>
          </article>
          <article class="detail-stat-card">
            <label>최종 정확도</label>
            <strong>${formatNumber(session.final_score || 0)}점</strong>
            <small>세션 종료 기준</small>
          </article>
          <article class="detail-stat-card">
            <label>실행 시각</label>
            <strong>${escapeHtml(formatDateTime(session.started_at))}</strong>
            <small>종료 ${escapeHtml(formatDateTime(session.ended_at))}</small>
          </article>
        </section>

        <section class="detail-panel">
          <h4>정확도 요약</h4>
          ${renderAccuracySection(accuracyFocus, metrics)}
        </section>

        <section class="detail-panel">
          <h4>개선 방향</h4>
          ${renderImprovementSection(improvementFocus)}
        </section>

        <section class="detail-panel">
          <h4>메트릭 점수 시계열</h4>
          <div id="detailMetricSeries"></div>
        </section>

        ${debugHtml}
      `;

      renderMetricSeriesSection(document.getElementById('detailMetricSeries'), metricSeries);
    } catch (error) {
      console.error('Session detail load failed:', error);
      body.innerHTML = `<div class="chart-empty">${escapeHtml(error.message || '상세 정보를 불러오지 못했습니다.')}</div>`;
    }
  }

  function closeModal() {
    const modal = document.getElementById('detailModal');
    if (modal) modal.hidden = true;
  }

  async function deleteSession(sessionId) {
    const shouldDelete = confirm('이 기록을 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.');
    if (!shouldDelete) return;

    try {
      const response = await fetch(`/api/history/${sessionId}`, { method: 'DELETE' });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '삭제에 실패했습니다.');
      }

      const row = document.querySelector(`.history-item[data-session-id="${sessionId}"]`);
      if (row) {
        row.style.opacity = '0';
        row.style.transform = 'translateY(-8px)';
        setTimeout(() => {
          row.remove();
          const remaining = document.querySelectorAll('.history-item');
          if (remaining.length === 0) {
            window.location.reload();
            return;
          }
          updateVisibleSummary();
        }, 180);
      } else {
        window.location.reload();
      }
    } catch (error) {
      console.error('Delete session failed:', error);
      alert(error.message || '삭제 중 오류가 발생했습니다.');
    }
  }

  const detailModal = document.getElementById('detailModal');
  if (detailModal) {
    detailModal.addEventListener('click', (event) => {
      if (event.target.classList.contains('modal')) {
        closeModal();
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal();
    }
  });

  window.viewDetail = viewDetail;
  window.viewRoutineDetail = viewRoutineDetail;
  window.closeModal = closeModal;
  window.deleteSession = deleteSession;

  updateVisibleSummary();
})();
