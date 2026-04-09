(function initHistoryPage() {
  const bootstrap = window.__HISTORY_BOOTSTRAP__ || {};
  const insightState = {
    days: Number.isFinite(Number(bootstrap.initialDays)) ? Number(bootstrap.initialDays) : 30
  };

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
    const scoreChart = document.getElementById('scoreChart');
    const timeChart = document.getElementById('timeChart');
    const breakdown = document.getElementById('exerciseBreakdown');

    if (scoreChart) scoreChart.innerHTML = html;
    if (timeChart) timeChart.innerHTML = html;
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

  function renderMiniBarChart(targetId, rows, key, maxValue, suffix) {
    const target = document.getElementById(targetId);
    if (!target) return;

    const hasData = rows.some((row) => Number(row[key] || 0) > 0);
    if (!hasData) {
      target.innerHTML = '<div class="chart-empty">표시할 데이터가 없습니다.</div>';
      return;
    }

    const labelStep = rows.length > 60 ? 10 : rows.length > 30 ? 7 : rows.length > 14 ? 4 : 1;
    target.innerHTML = `
      <div class="mini-bar-chart">
        ${rows.map((row, index) => {
          const value = Number(row[key] || 0);
          const height = Math.max(6, Math.round((value / Math.max(maxValue, 1)) * 100));
          const label = (index % labelStep === 0 || index === rows.length - 1) ? toDateLabel(row.date) : '';
          return `
            <div class="mini-bar-item">
              <div class="mini-bar-wrap" title="${escapeHtml(String(value))}${escapeHtml(suffix)}">
                <span class="mini-bar" style="height:${height}%"></span>
              </div>
              <span class="mini-bar-label">${escapeHtml(label)}</span>
            </div>
          `;
        }).join('')}
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

    const top = exercises.slice(0, 6);
    const maxCount = Math.max(...top.map((item) => Number(item.count || 0)), 1);

    target.innerHTML = top.map((item) => {
      const count = Number(item.count || 0);
      const width = ((count / maxCount) * 100).toFixed(1);
      const summary = `${formatNumber(count)}회 · ${formatNumber(item.totalMinutes || 0)}분 · 평균 ${formatNumber(item.avgScore || 0)}점`;

      return `
        <div class="exercise-row">
          <div class="exercise-row-header">
            <span class="exercise-name">${escapeHtml(item.name || '운동')}</span>
            <span class="exercise-summary">${escapeHtml(summary)}</span>
          </div>
          <div class="exercise-track">
            <span class="exercise-fill" style="width:${width}%"></span>
          </div>
        </div>
      `;
    }).join('');
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
      renderMiniBarChart('scoreChart', daily, 'avgScore', 100, '점');
      renderMiniBarChart(
        'timeChart',
        daily,
        'totalMinutes',
        Math.max(...daily.map((row) => row.totalMinutes), 10),
        '분'
      );
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

  function extractPrimitiveDetailEntries(detail) {
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return [];

    return Object.entries(detail)
      .filter(([key, value]) => {
        if (['score_timeline', 'rep_records', 'set_records', 'events'].includes(key)) return false;
        return ['string', 'number', 'boolean'].includes(typeof value);
      })
      .slice(0, 8);
  }

  function renderSimpleList(rows, emptyMessage) {
    if (!rows.length) {
      return `<div class="chart-empty">${escapeHtml(emptyMessage)}</div>`;
    }
    return `<div class="simple-list">${rows.join('')}</div>`;
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
      const timeline = Array.isArray(payload.timeline) ? payload.timeline : [];
      const repRecords = Array.isArray(payload.rep_records) ? payload.rep_records : [];
      const setRecords = Array.isArray(payload.set_records) ? payload.set_records : [];
      const sessionEvents = Array.isArray(payload.session_events) ? payload.session_events : [];
      const routineContext = payload.routine_context || null;
      const detail = payload.detail || {};

      title.textContent = `${session.exercise?.name || '운동'} · 세션 #${session.session_id || '-'}`;

      const resultText = formatResultValue(
        session.result_basis,
        session.total_result_value,
        session.total_result_unit
      );

      const metricRows = metrics.map((metric) => {
        const score = Number(metric.avg_score || 0);
        const scorePercent = Math.max(0, Math.min(100, Math.round(score)));
        const rawText = metric.avg_raw_value == null ? '-'
          : `${metric.avg_raw_value} (min ${metric.min_raw_value ?? '-'} / max ${metric.max_raw_value ?? '-'})`;

        return `
          <div class="metric-item">
            <div class="metric-header">
              <span>${escapeHtml(metric.metric_name || metric.metric_key || '항목')}</span>
              <strong>${formatNumber(score)}점</strong>
            </div>
            <div class="metric-meta">샘플 ${formatNumber(metric.sample_count || 0)} · raw ${escapeHtml(String(rawText))}</div>
            <div class="metric-track">
              <span class="metric-fill" style="width:${scorePercent}%"></span>
            </div>
          </div>
        `;
      });

      const timelineRows = timeline
        .slice()
        .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
        .slice(-14)
        .map((item) => `
          <div class="simple-item">
            <span>${formatRelativeMs(item.timestamp || 0)}</span>
            <strong>${formatNumber(item.score || 0)}점</strong>
          </div>
        `);

      const repRows = repRecords.slice(-12).reverse().map((rep) => `
        <div class="simple-item">
          <span>${formatNumber(rep.repNumber || rep.rep_no || 0)}회차</span>
          <strong>${formatNumber(rep.score || 0)}점</strong>
        </div>
      `);

      const setRows = setRecords.map((set) => {
        const setNoRaw = set.set_no ?? set.setNo ?? null;
        const actualRaw = set.actual_reps ?? set.actual_value ?? null;
        const setNoText = Number.isFinite(Number(setNoRaw)) ? `${formatNumber(setNoRaw)}세트` : '-';
        const actualText = Number.isFinite(Number(actualRaw)) ? formatNumber(actualRaw) : '-';
        const durationSec = set.duration_sec ?? 0;
        return `
          <div class="simple-item">
            <span>${setNoText} · 수행 ${actualText} · ${formatDuration(durationSec)}</span>
            <strong>${escapeHtml(String(set.phase || set.status || 'WORK'))}</strong>
          </div>
        `;
      });

      const eventRows = sessionEvents.slice(0, 12).map((event) => {
        const eventTime = event.event_time
          ? new Date(event.event_time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '-';
        return `
          <div class="simple-item">
            <span>${escapeHtml(eventTime)} · ${escapeHtml(event.type || 'EVENT')}</span>
            <strong>${escapeHtml(JSON.stringify(event.payload || {}).slice(0, 40))}</strong>
          </div>
        `;
      });

      const detailEntries = extractPrimitiveDetailEntries(detail);
      const detailEntryRows = detailEntries.map(([key, value]) => `
        <div class="key-value-item">
          <label>${escapeHtml(key)}</label>
          <div>${escapeHtml(String(value))}</div>
        </div>
      `);

      const routineContextHtml = routineContext && (routineContext.workout_set || routineContext.routine)
        ? `
          <div class="detail-block">
            <h4>루틴/세트 컨텍스트</h4>
            <div class="detail-section-grid">
              <div class="detail-item">
                <label>루틴 이름</label>
                <div class="value">${escapeHtml(routineContext.routine?.name || '-')}</div>
              </div>
              <div class="detail-item">
                <label>세트 번호</label>
                <div class="value">${Number.isFinite(Number(routineContext.workout_set?.set_no))
                  ? `${formatNumber(routineContext.workout_set.set_no)}세트`
                  : '-'}</div>
              </div>
              <div class="detail-item">
                <label>세트 상태</label>
                <div class="value">${escapeHtml(routineContext.workout_set?.status || '-')}</div>
              </div>
            </div>
          </div>
        `
        : '';

      body.innerHTML = `
        <section class="detail-section-grid">
          <div class="detail-item">
            <label>운동</label>
            <div class="value">${escapeHtml(session.exercise?.name || '운동')}</div>
          </div>
          <div class="detail-item">
            <label>상태</label>
            <div class="value">${escapeHtml(session.status || '-')}</div>
          </div>
          <div class="detail-item">
            <label>모드</label>
            <div class="value">${escapeHtml(session.mode || '-')}</div>
          </div>
          <div class="detail-item">
            <label>결과</label>
            <div class="value">${escapeHtml(resultText)}</div>
          </div>
          <div class="detail-item">
            <label>운동 시간</label>
            <div class="value">${escapeHtml(formatDuration(session.duration_sec || 0))}</div>
          </div>
          <div class="detail-item">
            <label>최종 점수</label>
            <div class="value">${formatNumber(session.final_score || 0)}점</div>
          </div>
          <div class="detail-item">
            <label>자세</label>
            <div class="value">${escapeHtml(session.selected_view || '-')}</div>
          </div>
          <div class="detail-item">
            <label>시작 시각</label>
            <div class="value">${escapeHtml(session.started_at ? new Date(session.started_at).toLocaleString('ko-KR') : '-')}</div>
          </div>
          <div class="detail-item">
            <label>종료 시각</label>
            <div class="value">${escapeHtml(session.ended_at ? new Date(session.ended_at).toLocaleString('ko-KR') : '-')}</div>
          </div>
        </section>

        ${session.summary_feedback ? `
          <div class="detail-block">
            <h4>요약 피드백</h4>
            <p class="detail-feedback">${escapeHtml(session.summary_feedback).replace(/\n/g, '<br>')}</p>
          </div>
        ` : ''}

        <div class="detail-block">
          <h4>FINAL 스냅샷 메트릭</h4>
          ${renderSimpleList(metricRows, '메트릭 기록이 없습니다.')}
        </div>

        <div class="detail-block">
          <h4>점수 타임라인</h4>
          ${renderSimpleList(timelineRows, '타임라인 데이터가 없습니다.')}
        </div>

        <div class="detail-block">
          <h4>반복 기록</h4>
          ${renderSimpleList(repRows, '반복 기록이 없습니다.')}
        </div>

        <div class="detail-block">
          <h4>세트 기록</h4>
          ${renderSimpleList(setRows, '세트 기록이 없습니다.')}
        </div>

        <div class="detail-block">
          <h4>세션 이벤트</h4>
          ${renderSimpleList(eventRows, '이벤트 기록이 없습니다.')}
        </div>

        ${routineContextHtml}

        ${detailEntryRows.length ? `
          <div class="detail-block">
            <h4>기타 Detail 필드</h4>
            <div class="key-value-grid">${detailEntryRows.join('')}</div>
          </div>
        ` : ''}
      `;
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

      const row = document.querySelector(`[data-session-id="${sessionId}"]`);
      if (row) {
        row.style.opacity = '0';
        row.style.transform = 'translateY(-6px)';
        setTimeout(() => {
          row.remove();
          const remaining = document.querySelectorAll('.history-row');
          if (remaining.length === 0) {
            window.location.reload();
          }
        }, 180);
      } else {
        window.location.reload();
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

  loadHistoryInsights(insightState.days);
})();
