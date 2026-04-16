(function initHistoryPage() {
  const bootstrap = window.__HISTORY_BOOTSTRAP__ || {};
  const insightState = {
    days: Number.isFinite(Number(bootstrap.initialDays)) ? Number(bootstrap.initialDays) : 30
  };

  const modeLabelMap = { FREE: '자율 운동', ROUTINE: '루틴 운동', LEARN: '학습 모드' };
  const statusLabelMap = { DONE: '완료', ABORTED: '중단' };
  const viewLabelMap = { FRONT: '정면', SIDE: '측면', DIAGONAL: '대각선' };

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

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function toDateKey(date) {
    const year = date.getFullYear();
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());
    return `${year}-${month}-${day}`;
  }

  function toDateLabel(dateKey) {
    const [_, month, day] = String(dateKey).split('-');
    if (!month || !day) return '-';
    return `${Number(month)}/${Number(day)}`;
  }

  function average(numbers) {
    if (!numbers.length) return 0;
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  }

  function setRangeActive(days) {
    document.querySelectorAll('.range-btn').forEach((button) => {
      button.classList.toggle('active', Number(button.dataset.range) === days);
    });
  }

  function setInsightLoading(message) {
    const html = `<div class="chart-empty">${escapeHtml(message)}</div>`;
    const metrics = document.getElementById('insightMetrics');
    const scoreChart = document.getElementById('scoreChart');
    const timeChart = document.getElementById('timeChart');
    const activityStrip = document.getElementById('activityStrip');
    const breakdown = document.getElementById('exerciseBreakdown');

    if (metrics) {
      metrics.innerHTML = Array.from({ length: 5 }).map(() => `
        <div class="insight-metric">
          <span class="metric-name">로딩 중</span>
          <strong class="metric-value">-</strong>
          <span class="metric-note">${escapeHtml(message)}</span>
        </div>
      `).join('');
    }
    if (scoreChart) scoreChart.innerHTML = html;
    if (timeChart) timeChart.innerHTML = html;
    if (activityStrip) activityStrip.innerHTML = html;
    if (breakdown) breakdown.innerHTML = html;
  }

  function normalizeDaily(rawDaily, days) {
    const byDate = new Map((rawDaily || []).map((day) => {
      const parsed = new Date(`${day.date}T00:00:00`);
      const normalizedKey = Number.isNaN(parsed.getTime()) ? String(day.date) : toDateKey(parsed);
      return [normalizedKey, day];
    }));
    const rows = [];

    for (let i = days - 1; i >= 0; i -= 1) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - i);

      const key = toDateKey(date);
      const source = byDate.get(key) || {};

      rows.push({
        date: key,
        count: Number(source.count || 0),
        totalMinutes: Number(source.totalMinutes || 0),
        totalReps: Number(source.totalReps || 0),
        totalResultSec: Number(source.totalResultSec || 0),
        avgScore: Number(source.avgScore || 0),
        bestScore: Number(source.bestScore || 0)
      });
    }

    return rows;
  }

  function buildSummary(daily, days) {
    const totalSessions = daily.reduce((sum, row) => sum + row.count, 0);
    const totalMinutes = daily.reduce((sum, row) => sum + row.totalMinutes, 0);
    const totalReps = daily.reduce((sum, row) => sum + row.totalReps, 0);
    const totalResultSec = daily.reduce((sum, row) => sum + row.totalResultSec, 0);
    const activeDays = daily.filter((row) => row.count > 0).length;

    const weightedScore = daily.reduce((sum, row) => sum + (row.avgScore * row.count), 0);
    const avgScore = totalSessions > 0 ? Math.round(weightedScore / totalSessions) : 0;
    const repsPerMin = totalMinutes > 0 ? (totalReps / totalMinutes).toFixed(1) : '0.0';

    const bestDay = daily.reduce((best, row) => {
      if (row.bestScore > best.bestScore) return row;
      return best;
    }, { bestScore: 0, date: '-' });

    const half = Math.max(1, Math.floor(days / 2));
    const prevScores = daily.slice(0, half).filter((row) => row.count > 0).map((row) => row.avgScore);
    const recentScores = daily.slice(-half).filter((row) => row.count > 0).map((row) => row.avgScore);

    const prevMinutes = average(daily.slice(0, half).map((row) => row.totalMinutes));
    const recentMinutes = average(daily.slice(-half).map((row) => row.totalMinutes));

    const scoreDelta = prevScores.length && recentScores.length
      ? Number((average(recentScores) - average(prevScores)).toFixed(1))
      : null;

    const minuteDelta = prevMinutes > 0
      ? Number((((recentMinutes - prevMinutes) / prevMinutes) * 100).toFixed(1))
      : null;

    return {
      days,
      totalSessions,
      totalMinutes,
      totalReps,
      totalResultSec,
      avgScore,
      activeDays,
      repsPerMin,
      bestDay,
      scoreDelta,
      minuteDelta
    };
  }

  function renderTrendHint(targetId, value, suffix) {
    const element = document.getElementById(targetId);
    if (!element) return;

    element.className = 'trend-hint';
    if (value === null || Number.isNaN(value)) {
      element.textContent = '비교 데이터 부족';
      return;
    }

    if (value > 0.1) {
      element.classList.add('up');
      element.textContent = `이전 구간 대비 +${value}${suffix}`;
      return;
    }

    if (value < -0.1) {
      element.classList.add('down');
      element.textContent = `이전 구간 대비 ${value}${suffix}`;
      return;
    }

    element.textContent = '큰 변화 없음';
  }

  function renderInsightMetrics(summary) {
    const target = document.getElementById('insightMetrics');
    if (!target) return;

    const items = [
      {
        name: '운동 횟수',
        value: `${formatNumber(summary.totalSessions)}회`,
        note: `최근 ${summary.days}일`
      },
      {
        name: '운동 시간',
        value: `${formatNumber(summary.totalMinutes)}분`,
        note: `활동일 ${formatNumber(summary.activeDays)}일`
      },
      {
        name: '평균 점수',
        value: `${formatNumber(summary.avgScore)}점`,
        note: summary.bestDay.bestScore
          ? `최고 ${summary.bestDay.bestScore}점 (${toDateLabel(summary.bestDay.date)})`
          : '점수 데이터 없음'
      },
      {
        name: '반복량',
        value: `${formatNumber(summary.totalReps)}회`,
        note: `분당 ${summary.repsPerMin}회`
      },
      {
        name: '버티기',
        value: `${formatNumber(summary.totalResultSec)}초`,
        note: '시간형 결과 합계'
      }
    ];

    target.innerHTML = items.map((item) => `
      <div class="insight-metric">
        <span class="metric-name">${escapeHtml(item.name)}</span>
        <strong class="metric-value">${escapeHtml(item.value)}</strong>
        <span class="metric-note">${escapeHtml(item.note)}</span>
      </div>
    `).join('');
  }

  function buildLinePath(points) {
    return points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
      .join(' ');
  }

  function renderLineChart(targetId, rows, key, options) {
    const target = document.getElementById(targetId);
    if (!target) return;

    const hasData = rows.some((row) => Number(row[key] || 0) > 0);
    if (!hasData) {
      target.innerHTML = '<div class="chart-empty">표시할 데이터가 없습니다.</div>';
      return;
    }

    const maxValue = Math.max(Number(options.maxValue) || 0, 1);
    const width = Math.max(560, rows.length * 18);
    const height = 220;
    const padX = 18;
    const padTop = 18;
    const padBottom = 28;
    const usableHeight = Math.max(1, height - padTop - padBottom);
    const denominator = Math.max(rows.length - 1, 1);

    const points = rows.map((row, index) => {
      const value = Math.max(0, Number(row[key] || 0));
      const x = padX + (index / denominator) * (width - (padX * 2));
      const y = (height - padBottom) - ((value / maxValue) * usableHeight);
      return { x, y, value };
    });

    const linePath = buildLinePath(points);
    const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(2)},${height - padBottom} L${points[0].x.toFixed(2)},${height - padBottom} Z`;
    const pointStep = rows.length > 54 ? 9 : rows.length > 36 ? 6 : rows.length > 18 ? 4 : 2;
    const visiblePoints = points.filter((_, index) => index === 0 || index === rows.length - 1 || index % pointStep === 0);
    const gradientId = `${targetId}-gradient-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const firstLabel = toDateLabel(rows[0].date);
    const midLabel = toDateLabel(rows[Math.floor(rows.length / 2)].date);
    const lastLabel = toDateLabel(rows[rows.length - 1].date);

    target.innerHTML = `
      <div class="line-chart-shell" style="--line-color:${escapeHtml(options.color)}; --line-fill:${escapeHtml(options.fill)};">
        <div class="line-chart-scroll">
          <svg
            class="line-chart-svg"
            width="${width}"
            height="${height}"
            viewBox="0 0 ${width} ${height}"
            role="img"
            aria-label="${escapeHtml(options.label || '추이 차트')}"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${escapeHtml(options.color)}" stop-opacity="0.34"></stop>
                <stop offset="100%" stop-color="${escapeHtml(options.color)}" stop-opacity="0"></stop>
              </linearGradient>
            </defs>
            <line
              x1="${padX}"
              x2="${width - padX}"
              y1="${height - padBottom}"
              y2="${height - padBottom}"
              stroke="rgba(148, 163, 184, 0.45)"
              stroke-width="1"
            ></line>
            <path class="line-series-area" d="${areaPath}" fill="url(#${gradientId})"></path>
            <path class="line-series-stroke" d="${linePath}"></path>
            ${visiblePoints.map((point) => `
              <circle
                class="line-series-dot"
                cx="${point.x.toFixed(2)}"
                cy="${point.y.toFixed(2)}"
                r="3"
              ></circle>
            `).join('')}
          </svg>
        </div>
        <div class="line-chart-caption">
          <span>${escapeHtml(firstLabel)}</span>
          <span>${escapeHtml(midLabel)}</span>
          <span>${escapeHtml(`${lastLabel} · 최대 ${formatNumber(maxValue)}${options.unit}`)}</span>
        </div>
      </div>
    `;
  }

  function renderActivityStrip(rows) {
    const target = document.getElementById('activityStrip');
    if (!target) return;

    const hasData = rows.some((row) => row.count > 0);
    if (!hasData) {
      target.innerHTML = '<div class="chart-empty">활동 데이터가 없습니다.</div>';
      return;
    }

    const maxCount = Math.max(...rows.map((row) => Number(row.count || 0)), 1);
    const cells = rows.map((row) => {
      const count = Number(row.count || 0);
      const intensity = count > 0 ? count / maxCount : 0;
      const title = `${toDateLabel(row.date)} · ${formatNumber(count)}회 · ${formatNumber(row.totalMinutes || 0)}분 · 평균 ${formatNumber(row.avgScore || 0)}점`;
      return `
        <span
          class="activity-cell ${count > 0 ? 'active' : ''}"
          style="--activity:${Math.max(0, Math.min(1, intensity)).toFixed(2)}"
          title="${escapeHtml(title)}"
        ></span>
      `;
    }).join('');

    target.innerHTML = `
      <div class="activity-strip-shell">
        <div class="activity-strip-grid">${cells}</div>
        <div class="activity-strip-legend">
          <span>낮음</span>
          <span>일별 세션 수가 높을수록 진해집니다</span>
          <span>높음</span>
        </div>
      </div>
    `;
  }

  function renderExerciseBreakdown(exercises) {
    const target = document.getElementById('exerciseBreakdown');
    if (!target) return;

    if (!Array.isArray(exercises) || exercises.length === 0) {
      target.innerHTML = '<div class="chart-empty">운동 분포 데이터가 없습니다.</div>';
      return;
    }

    const top = exercises.slice(0, 8);
    const maxCount = Math.max(...top.map((item) => Number(item.count || 0)), 1);
    const totalCount = top.reduce((sum, item) => sum + Number(item.count || 0), 0);

    target.innerHTML = `
      <div class="distribution-list">
        ${top.map((item) => {
          const count = Number(item.count || 0);
          const width = ((count / maxCount) * 100).toFixed(1);
          const share = totalCount > 0 ? ((count / totalCount) * 100).toFixed(1) : '0.0';
          const meta = `${formatNumber(count)}회 · ${formatNumber(item.totalMinutes || 0)}분`;
          const score = `평균 ${formatNumber(item.avgScore || 0)}점 · 최고 ${formatNumber(item.bestScore || 0)}점`;

          return `
            <article class="distribution-row">
              <div class="distribution-head">
                <span class="distribution-name">${escapeHtml(item.name || '운동')}</span>
                <span class="distribution-share">${escapeHtml(share)}%</span>
              </div>
              <div class="distribution-track">
                <span class="distribution-fill" style="width:${width}%"></span>
              </div>
              <div class="distribution-foot">
                <span class="distribution-meta">${escapeHtml(meta)}</span>
                <span class="distribution-score">${escapeHtml(score)}</span>
              </div>
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  async function loadHistoryInsights(days = insightState.days) {
    insightState.days = days;
    setRangeActive(days);
    setInsightLoading('데이터를 불러오는 중...');

    try {
      const response = await fetch(`/api/history/stats?days=${days}`);
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '통계 데이터를 불러오지 못했습니다.');
      }

      const daily = normalizeDaily(payload.daily || [], days);
      const summary = buildSummary(daily, days);

      renderInsightMetrics(summary);
      renderLineChart('scoreChart', daily, 'avgScore', {
        maxValue: 100,
        unit: '점',
        label: '평균 점수 추이',
        color: '#2563eb',
        fill: 'rgba(37, 99, 235, 0.2)'
      });
      renderLineChart('timeChart', daily, 'totalMinutes', {
        maxValue: Math.max(...daily.map((row) => Number(row.totalMinutes || 0)), 10),
        unit: '분',
        label: '운동 시간 추이',
        color: '#059669',
        fill: 'rgba(5, 150, 105, 0.2)'
      });
      renderActivityStrip(daily);
      renderExerciseBreakdown(payload.exercises || []);
      renderTrendHint('scoreTrendHint', summary.scoreDelta, '점');
      renderTrendHint('timeTrendHint', summary.minuteDelta, '%');
    } catch (error) {
      console.error('History stats load failed:', error);
      setInsightLoading('통계 데이터를 불러오지 못했습니다.');
      renderTrendHint('scoreTrendHint', null, '점');
      renderTrendHint('timeTrendHint', null, '%');
    }
  }

  function formatRelativeMs(ms) {
    const safe = Math.max(0, Number(ms) || 0);
    const totalSec = Math.floor(safe / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function renderSimpleList(rows, emptyMessage) {
    if (!rows.length) {
      return `<div class="chart-empty">${escapeHtml(emptyMessage)}</div>`;
    }
    return `<div class="detail-simple-list">${rows.join('')}</div>`;
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
          const rawText = metric.avg_raw_value == null
            ? '-'
            : `${metric.avg_raw_value} (min ${metric.min_raw_value ?? '-'} / max ${metric.max_raw_value ?? '-'})`;
          return `
            <article class="detail-metric-item">
              <div class="detail-metric-head">
                <span>${escapeHtml(metric.metric_name || metric.metric_key || '항목')}</span>
                <strong>${formatNumber(score)}점</strong>
              </div>
              <div class="detail-metric-meta">샘플 ${formatNumber(metric.sample_count || 0)} · raw ${escapeHtml(rawText)}</div>
              <div class="detail-track">
                <span class="detail-fill" style="width:${scorePercent}%"></span>
              </div>
            </article>
          `;
        }).join('')}
      </div>
    `;
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
              avg_raw_value: point?.avg_raw_value == null ? null : Number(point.avg_raw_value),
              min_raw_value: point?.min_raw_value == null ? null : Number(point.min_raw_value),
              max_raw_value: point?.max_raw_value == null ? null : Number(point.max_raw_value),
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

    const width = Math.max(520, rows.length * 60);
    const height = 220;
    const padX = 20;
    const padTop = 18;
    const padBottom = 30;
    const usableHeight = Math.max(1, height - padTop - padBottom);
    const minSec = rows[0].t_sec;
    const maxSec = rows[rows.length - 1].t_sec;
    const gradientId = `metric-series-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const points = rows.map((row) => {
      const x = rows.length === 1
        ? width / 2
        : padX + (((row.t_sec - minSec) / Math.max(maxSec - minSec, 1)) * (width - (padX * 2)));
      const y = (height - padBottom) - ((row.avg_score / 100) * usableHeight);
      return { ...row, x, y };
    });

    const linePath = points.length > 1 ? buildLinePath(points) : '';
    const areaPath = points.length > 1
      ? `${linePath} L${points[points.length - 1].x.toFixed(2)},${height - padBottom} L${points[0].x.toFixed(2)},${height - padBottom} Z`
      : '';
    const pointStep = rows.length > 54 ? 9 : rows.length > 36 ? 6 : rows.length > 18 ? 4 : 2;
    const visiblePoints = points.filter((_, index) => rows.length === 1 || index === 0 || index === rows.length - 1 || index % pointStep === 0);
    const lastPointLabel = points[points.length - 1].snapshot_type === 'FINAL' ? '최종' : '마지막';

    return `
      <div class="detail-series-chart-shell">
        <div class="detail-series-chart-scroll">
          <svg
            class="detail-series-chart-svg"
            width="${width}"
            height="${height}"
            viewBox="0 0 ${width} ${height}"
            role="img"
            aria-label="${escapeHtml(series.metric_name)} 점수 시계열"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.28"></stop>
                <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"></stop>
              </linearGradient>
            </defs>
            <line x1="${padX}" x2="${width - padX}" y1="${height - padBottom}" y2="${height - padBottom}" stroke="rgba(148, 163, 184, 0.45)" stroke-width="1"></line>
            <line x1="${padX}" x2="${width - padX}" y1="${padTop}" y2="${padTop}" stroke="rgba(148, 163, 184, 0.22)" stroke-width="1" stroke-dasharray="4 4"></line>
            <line x1="${padX}" x2="${width - padX}" y1="${(height - padBottom + padTop) / 2}" y2="${(height - padBottom + padTop) / 2}" stroke="rgba(148, 163, 184, 0.18)" stroke-width="1" stroke-dasharray="4 4"></line>
            ${areaPath ? `<path class="detail-series-area" d="${areaPath}" fill="url(#${gradientId})"></path>` : ''}
            ${linePath ? `<path class="detail-series-line" d="${linePath}"></path>` : ''}
            ${visiblePoints.map((point) => `
              <circle class="detail-series-dot" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="4">
                <title>${escapeHtml(`${formatMetricTime(point.t_sec)} · ${formatNumber(point.avg_score)}점 · ${point.snapshot_type}`)}</title>
              </circle>
            `).join('')}
          </svg>
        </div>
        <div class="detail-series-caption">
          <span>${escapeHtml(formatMetricTime(points[0].t_sec))}</span>
          <span>${escapeHtml(formatMetricTime(points[Math.floor(points.length / 2)].t_sec))}</span>
          <span>${escapeHtml(`${formatMetricTime(points[points.length - 1].t_sec)} · ${lastPointLabel} ${formatNumber(points[points.length - 1].avg_score)}점`)}</span>
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
      const hasTimeline = activeSeries.points.length > 1;

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

          ${!hasTimeline ? '<p class="detail-series-note">중간 메트릭이 없어 최종 스냅샷 중심으로 표시합니다.</p>' : ''}
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

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function updateVisibleSummary() {
    const items = Array.from(document.querySelectorAll('.history-item'));
    const doneItems = items.filter((item) => String(item.dataset.sessionStatus || '').toUpperCase() === 'DONE');
    const abortedItems = items.filter((item) => String(item.dataset.sessionStatus || '').toUpperCase() === 'ABORTED');
    const scores = doneItems
      .map((item) => Number(item.dataset.sessionScore || 0))
      .filter((score) => Number.isFinite(score));
    const avgScore = scores.length
      ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
      : 0;

    setText('visibleSessionCount', formatNumber(items.length));
    setText('visibleDoneCount', formatNumber(doneItems.length));
    setText('visibleAbortedCount', formatNumber(abortedItems.length));
    setText('visibleAvgScore', formatNumber(avgScore));
  }

  async function viewDetail(sessionId) {
    const modal = document.getElementById('detailModal');
    const body = document.getElementById('detailModalBody');
    const title = document.getElementById('detailModalTitle');

    if (!modal || !body || !title) return;

    modal.hidden = false;
    title.textContent = '세션 상세';
    body.innerHTML = '<div class="loading-state">세션 데이터를 불러오는 중...</div>';

    try {
      const response = await fetch(`/api/history/${sessionId}`);
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '세션 상세 조회에 실패했습니다.');
      }

      const session = payload.session || {};
      const metrics = Array.isArray(payload.metrics) ? payload.metrics : [];
      const metricSeries = Array.isArray(payload.metric_series) ? payload.metric_series : [];
      const timeline = Array.isArray(payload.timeline) ? payload.timeline : [];
      const sessionEvents = Array.isArray(payload.session_events) ? payload.session_events : [];
      const routineContext = payload.routine_context || {};

      title.textContent = `${session.exercise?.name || '운동'} · 세션 #${session.session_id || '-'}`;

      const statCards = [
        {
          label: '운동',
          value: session.exercise?.name || '운동',
          note: session.final_snapshot ? `FINAL #${session.final_snapshot.snapshot_no}` : 'FINAL 스냅샷 없음'
        },
        {
          label: '상태',
          value: statusLabelMap[String(session.status || '').toUpperCase()] || session.status || '-',
          note: '세션 종료 상태'
        },
        {
          label: '모드',
          value: modeLabelMap[String(session.mode || '').toUpperCase()] || session.mode || '-',
          note: '세션 실행 모드'
        },
        {
          label: '뷰',
          value: viewLabelMap[String(session.selected_view || '').toUpperCase()] || session.selected_view || '-',
          note: '선택 자세'
        },
        {
          label: '대표 결과',
          value: formatResultValue(session.result_basis, session.total_result_value, session.total_result_unit),
          note: `${session.result_basis || '-'} / ${session.total_result_unit || '-'}`
        },
        {
          label: '운동 시간',
          value: formatDuration(session.duration_sec || 0),
          note: '세션 구간 기준'
        },
        {
          label: '최종 점수',
          value: `${formatNumber(session.final_score || 0)}점`,
          note: 'workout_session + FINAL 기준'
        },
        {
          label: '실행 시각',
          value: formatDateTime(session.started_at),
          note: `종료 ${formatDateTime(session.ended_at)}`
        }
      ];

      const timelineRows = timeline
        .slice()
        .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
        .slice(-14)
        .map((item) => `
          <div class="detail-simple-item">
            <span>${formatRelativeMs(item.timestamp || 0)}</span>
            <strong>${formatNumber(item.score || 0)}점</strong>
          </div>
        `);

      const eventRows = sessionEvents.slice(0, 14).map((event) => {
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
      if (routineContext.routine_instance?.status) routineEntries.push(['루틴 인스턴스 상태', routineContext.routine_instance.status]);
      if (Number.isFinite(Number(routineContext.workout_set?.set_no))) {
        routineEntries.push(['세트 번호', `${formatNumber(routineContext.workout_set.set_no)}세트`]);
      }
      if (routineContext.workout_set?.status) routineEntries.push(['세트 상태', routineContext.workout_set.status]);
      if (Number.isFinite(Number(routineContext.step_instance?.order_no))) {
        routineEntries.push(['스텝 순서', `${formatNumber(routineContext.step_instance.order_no)}번`]);
      }
      if (routineContext.workout_set?.target_type) routineEntries.push(['세트 목표 유형', String(routineContext.workout_set.target_type)]);
      if (Number.isFinite(Number(routineContext.workout_set?.target_value))) {
        routineEntries.push(['세트 목표 값', formatNumber(routineContext.workout_set.target_value)]);
      }
      if (Number.isFinite(Number(routineContext.workout_set?.actual_value))) {
        routineEntries.push(['세트 실제 값', formatNumber(routineContext.workout_set.actual_value)]);
      }
      if (Number.isFinite(Number(routineContext.workout_set?.duration_sec))) {
        routineEntries.push(['세트 운동 시간', formatDuration(routineContext.workout_set.duration_sec)]);
      }

      const routineContextHtml = routineEntries.length
        ? `
          <section class="detail-panel">
            <h4>루틴/세트 컨텍스트</h4>
            <div class="detail-key-grid">
              ${routineEntries.map(([key, value]) => `
                <div class="detail-key-item">
                  <label>${escapeHtml(key)}</label>
                  <div>${escapeHtml(String(value))}</div>
                </div>
              `).join('')}
            </div>
          </section>
        `
        : '';

      body.innerHTML = `
        <section class="detail-top-grid">
          ${statCards.map((card) => `
            <article class="detail-stat-card">
              <label>${escapeHtml(card.label)}</label>
              <strong>${escapeHtml(card.value)}</strong>
              <small>${escapeHtml(card.note)}</small>
            </article>
          `).join('')}
        </section>

        ${session.summary_feedback ? `
          <section class="detail-panel">
            <h4>요약 피드백</h4>
            <p class="detail-feedback">${escapeHtml(session.summary_feedback).replace(/\n/g, '<br>')}</p>
          </section>
        ` : ''}

        <section class="detail-panel">
          <h4>FINAL 스냅샷 메트릭</h4>
          ${renderMetricList(metrics)}
        </section>

        <section class="detail-panel">
          <h4>메트릭 점수 시계열</h4>
          <div id="detailMetricSeries"></div>
        </section>

        <section class="detail-dual-grid">
          <article class="detail-panel">
            <h4>점수 타임라인</h4>
            ${renderSimpleList(timelineRows, '타임라인 데이터가 없습니다.')}
          </article>
          <article class="detail-panel">
            <h4>세션 이벤트</h4>
            ${renderSimpleList(eventRows, '이벤트 기록이 없습니다.')}
          </article>
        </section>

        ${routineContextHtml}
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
        return;
      }

      loadHistoryInsights(insightState.days);
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

  document.querySelectorAll('.range-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const days = Number(button.dataset.range);
      if (!Number.isFinite(days) || days === insightState.days) return;
      loadHistoryInsights(days);
    });
  });

  window.viewDetail = viewDetail;
  window.closeModal = closeModal;
  window.deleteSession = deleteSession;

  updateVisibleSummary();
  loadHistoryInsights(insightState.days);
})();
