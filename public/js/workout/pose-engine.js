/**
 * FitPlus Pose Engine - MediaPipe 기반 포즈 감지
 * Google MediaPipe Pose를 활용한 클라이언트 사이드 AI 처리
 */

// MediaPipe Pose 랜드마크 인덱스
const LANDMARKS = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32
};

const FEEDBACK_COLORS = {
  good: '#22c55e',
  warn: '#f59e0b',
  bad: '#ef4444'
};

const FEEDBACK_THRESHOLDS = {
  good: 0.8,
  warn: 0.6
};

class PoseEngine {
  constructor(options = {}) {
    this.pose = null;
    this.isInitialized = false;
    this.isRunning = false;
    this.lastResults = null;

    // 콜백
    this.onPoseDetected = null;
    this.onError = null;

    // One Euro Filter 스무딩 (기본 활성화)
    this.useOneEuroFilter = options.useOneEuroFilter ?? true;
    this.landmarkSmoother = null;
    this.worldLandmarkSmoother = null;

    this.visualFeedback = null;

    // 카메라 뷰(정면/측면) 추정 히스토리 (각도 계산 소스 선택용)
    this.viewHistory = [];
    this.maxViewHistoryLength = 10;

    // 필터 설정 (SMOOTHER_PRESETS 참조)
    this.smootherConfig = options.smootherConfig || {
      minCutoff: 1.0,  // 낮을수록 부드러움
      beta: 0.5,       // 높을수록 빠른 움직임에 반응
      dCutoff: 1.0
    };
  }

  /**
   * MediaPipe Pose 초기화
   */
  async initialize() {
    try {
      // MediaPipe Pose 로드
      this.pose = new Pose({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
        }
      });

      // 설정
      this.pose.setOptions({
        modelComplexity: 1,           // 0: Lite, 1: Full, 2: Heavy
        smoothLandmarks: !this.useOneEuroFilter,  // One Euro Filter 사용 시 내장 스무딩 비활성화
        enableSegmentation: false,     // 배경 세그멘테이션 (사용안함)
        smoothSegmentation: false,
        minDetectionConfidence: 0.5,   // 최소 감지 신뢰도
        minTrackingConfidence: 0.5     // 최소 추적 신뢰도
      });

      // One Euro Filter 초기화
      if (this.useOneEuroFilter && typeof LandmarkSmoother !== 'undefined') {
        this.landmarkSmoother = new LandmarkSmoother(this.smootherConfig);
        this.worldLandmarkSmoother = new LandmarkSmoother(this.smootherConfig);
        console.log('[PoseEngine] One Euro Filter 활성화:', this.smootherConfig);
      }

      // 결과 콜백 설정
      this.pose.onResults((results) => this.handleResults(results));

      this.isInitialized = true;
      console.log('[PoseEngine] MediaPipe Pose 초기화 완료');
      return true;
    } catch (error) {
      console.error('[PoseEngine] 초기화 실패:', error);
      if (this.onError) this.onError(error);
      return false;
    }
  }

  /**
   * 비디오 프레임 전송
   */
  async send(videoElement) {
    if (!this.isInitialized || !this.isRunning) return;

    try {
      await this.pose.send({ image: videoElement });
    } catch (error) {
      console.error('[PoseEngine] 프레임 전송 실패:', error);
    }
  }

  /**
   * 포즈 감지 결과 처리
   */
  handleResults(results) {
    this.lastResults = results;

    if (!results.poseLandmarks) {
      // 사람 미감지 콜백
      if (this.onNoPerson) {
        this.onNoPerson();
      }
      return;
    }

    const timestamp = performance.now();

    // 정규화된 랜드마크 (0~1 범위) - One Euro Filter 적용
    let landmarks = results.poseLandmarks;
    if (this.landmarkSmoother) {
      landmarks = this.landmarkSmoother.filter(timestamp, landmarks);
    }

    // 월드 좌표 랜드마크 (미터 단위) - One Euro Filter 적용
    let worldLandmarks = results.poseWorldLandmarks;
    if (this.worldLandmarkSmoother && worldLandmarks) {
      worldLandmarks = this.worldLandmarkSmoother.filter(timestamp, worldLandmarks);
    }

    // 관절 각도 계산
    // - 측면/정면 모두에서 일관된 각도를 얻기 위해 worldLandmarks(3D)가 있으면 우선 사용
    // - worldLandmarks가 없으면 기존 2D(이미지 평면) 각도로 fallback
    const angles = this.calculateAllAngles(landmarks, worldLandmarks);

    // 콜백 호출
    if (this.onPoseDetected) {
      this.onPoseDetected({
        landmarks,
        worldLandmarks,
        angles,
        timestamp
      });
    }
  }

  /**
   * 모든 주요 관절 각도 계산
   */
  calculateAllAngles(landmarks, worldLandmarks = null) {
    const canUseWorld = Array.isArray(worldLandmarks) && worldLandmarks.length >= 33;
    const get = (arr, idx) => (Array.isArray(arr) ? arr[idx] : null);
    const validPoint = (p) =>
      p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

    const view = canUseWorld ? this.getStableView(worldLandmarks) : 'UNKNOWN';
    const prefer2DForFlexion = view === 'SIDE';

    const angle2D = (idx1, idx2, idx3) =>
      this.getAngle(get(landmarks, idx1), get(landmarks, idx2), get(landmarks, idx3));

    const angle3D = (idx1, idx2, idx3) => {
      if (canUseWorld) {
        const p1 = get(worldLandmarks, idx1);
        const p2 = get(worldLandmarks, idx2);
        const p3 = get(worldLandmarks, idx3);
        if (validPoint(p1) && validPoint(p2) && validPoint(p3)) {
          return this.getAngle3D(p1, p2, p3);
        }
      }
      return null;
    };

    const normalizeAngle = (value) => {
      if (!Number.isFinite(value)) return null;
      return Math.max(0, Math.min(180, value));
    };

    const pickAngle = (a2, a3, options = {}) => {
      if (!canUseWorld) return normalizeAngle(a2);

      const v2 = normalizeAngle(a2);
      const v3 = normalizeAngle(a3);

      if (options.prefer3D) return v3 != null ? v3 : v2;
      if (options.prefer2D) return v2 != null ? v2 : v3;

      // 측면: 2D가 더 안정적인 경우가 많고(특히 스쿼트/푸쉬업 굽힘각),
      // 정면: 굽힘이 화면 밖(z축)으로 빠져 2D가 둔감해져서 3D를 우선 사용
      if (prefer2DForFlexion) return v2 != null ? v2 : v3;
      return v3 != null ? v3 : v2;
    };

    const angleFlexion = (idx1, idx2, idx3, options = {}) => {
      const a2 = angle2D(idx1, idx2, idx3);
      const a3 = angle3D(idx1, idx2, idx3);
      return pickAngle(a2, a3, options);
    };

    const quality = this.getFrameQuality(landmarks, view);

    return {
      // 무릎 각도 (서있을 때 ~180도, 스쿼트 시 ~90도)
      leftKnee: angleFlexion(LANDMARKS.LEFT_HIP, LANDMARKS.LEFT_KNEE, LANDMARKS.LEFT_ANKLE),
      rightKnee: angleFlexion(LANDMARKS.RIGHT_HIP, LANDMARKS.RIGHT_KNEE, LANDMARKS.RIGHT_ANKLE),

      // 팔꿈치 각도 (팔 폈을 때 ~180도, 굽힐 때 ~45도)
      leftElbow: angleFlexion(LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_ELBOW, LANDMARKS.LEFT_WRIST, { prefer3D: true }),
      rightElbow: angleFlexion(LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_ELBOW, LANDMARKS.RIGHT_WRIST, { prefer3D: true }),

      // 엉덩이 각도 (서있을 때 ~180도, 굽힐 때 감소)
      leftHip: angleFlexion(LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_HIP, LANDMARKS.LEFT_KNEE),
      rightHip: angleFlexion(LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_HIP, LANDMARKS.RIGHT_KNEE),

      // 어깨 각도 (팔 내렸을 때 ~0도, 올렸을 때 ~180도)
      leftShoulder: angleFlexion(LANDMARKS.LEFT_HIP, LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_ELBOW),
      rightShoulder: angleFlexion(LANDMARKS.RIGHT_HIP, LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_ELBOW),

      // 척추 각도 (상체 기울기)
      spine: this.getSpineAngle(landmarks, canUseWorld ? worldLandmarks : null),

      // 무릎 정렬 (무릎이 발끝을 넘는지)
      kneeAlignment: this.getKneeAlignment(landmarks),

      // 디버깅/품질 확인용
      view,
      angleSource: !canUseWorld ? 'IMAGE_2D' : (prefer2DForFlexion ? 'SMART_IMAGE_2D' : 'SMART_WORLD_3D'),
      quality
    };
  }

  getFrameQuality(landmarks, view = 'UNKNOWN') {
    const keyIndices = [
      LANDMARKS.LEFT_SHOULDER,
      LANDMARKS.RIGHT_SHOULDER,
      LANDMARKS.LEFT_HIP,
      LANDMARKS.RIGHT_HIP,
      LANDMARKS.LEFT_KNEE,
      LANDMARKS.RIGHT_KNEE,
      LANDMARKS.LEFT_ANKLE,
      LANDMARKS.RIGHT_ANKLE
    ];
    const inFrameMargin = 0.05;

    const visibilities = keyIndices
      .map((idx) => landmarks?.[idx]?.visibility)
      .filter((value) => Number.isFinite(value));
    const trackedPoints = keyIndices
      .map((idx) => landmarks?.[idx])
      .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));
    const inFramePoints = trackedPoints.filter((point) =>
      point.x >= inFrameMargin && point.x <= (1 - inFrameMargin) &&
      point.y >= inFrameMargin && point.y <= (1 - inFrameMargin)
    );

    const avgVisibility = visibilities.length
      ? visibilities.reduce((sum, value) => sum + value, 0) / visibilities.length
      : 0;
    const visibleRatio = keyIndices.length > 0
      ? visibilities.filter((value) => value >= 0.6).length / keyIndices.length
      : 0;
    const trackedJointRatio = keyIndices.length > 0
      ? trackedPoints.length / keyIndices.length
      : 0;
    const inFrameRatio = trackedPoints.length > 0
      ? inFramePoints.length / trackedPoints.length
      : 0;
    const viewStability = this.getViewStability(view);

    const score = Math.max(0, Math.min(1,
      avgVisibility * 0.5 +
      visibleRatio * 0.15 +
      trackedJointRatio * 0.15 +
      inFrameRatio * 0.1 +
      viewStability * 0.1
    ));

    return {
      score: Math.round(score * 100) / 100,
      level: this.getQualityLevel(score),
      factor: this.getQualityFactor(score),
      avgVisibility: Math.round(avgVisibility * 100) / 100,
      visibleRatio: Math.round(visibleRatio * 100) / 100,
      trackedJointRatio: Math.round(trackedJointRatio * 100) / 100,
      inFrameRatio: Math.round(inFrameRatio * 100) / 100,
      viewStability: Math.round(viewStability * 100) / 100
    };
  }

  getViewStability(view) {
    if (view === 'UNKNOWN' || this.viewHistory.length === 0) {
      return 0.4;
    }

    const matches = this.viewHistory.filter((item) => item === view).length;
    return matches / this.viewHistory.length;
  }

  getQualityLevel(score) {
    if (score >= 0.8) return 'HIGH';
    if (score >= 0.6) return 'MEDIUM';
    return 'LOW';
  }

  getQualityFactor(score) {
    if (score >= 0.8) return 1;
    if (score >= 0.6) return 0.85;
    return 0.7;
  }

  /**
   * worldLandmarks 기반으로 카메라 뷰(정면/측면) 분류
   * - 좌/우 어깨(또는 힙)의 z 차이가 x 차이보다 크면 측면에 가까움
   */
  classifyView(worldLandmarks) {
    if (!Array.isArray(worldLandmarks) || worldLandmarks.length < 33) return 'UNKNOWN';

    const ls = worldLandmarks[LANDMARKS.LEFT_SHOULDER];
    const rs = worldLandmarks[LANDMARKS.RIGHT_SHOULDER];
    const lh = worldLandmarks[LANDMARKS.LEFT_HIP];
    const rh = worldLandmarks[LANDMARKS.RIGHT_HIP];

    const valid = (p) =>
      p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
    if (!valid(ls) || !valid(rs) || !valid(lh) || !valid(rh)) return 'UNKNOWN';

    const eps = 1e-6;
    const shoulderX = Math.abs(ls.x - rs.x);
    const shoulderZ = Math.abs(ls.z - rs.z);
    const hipX = Math.abs(lh.x - rh.x);
    const hipZ = Math.abs(lh.z - rh.z);

    const shoulderRatio = shoulderZ / (shoulderX + eps);
    const hipRatio = hipZ / (hipX + eps);
    const ratio = Math.max(shoulderRatio, hipRatio);

    // 경험적으로 0.75~1.0 사이가 전환 구간 (OBLIQUE는 SIDE로 취급)
    return ratio > 0.75 ? 'SIDE' : 'FRONT';
  }

  /**
   * 뷰 분류를 히스토리로 안정화 (최근 N프레임 다수결)
   */
  getStableView(worldLandmarks) {
    const raw = this.classifyView(worldLandmarks);
    if (raw === 'UNKNOWN') return raw;

    this.viewHistory.push(raw);
    if (this.viewHistory.length > this.maxViewHistoryLength) {
      this.viewHistory.shift();
    }

    let side = 0;
    let front = 0;
    for (const v of this.viewHistory) {
      if (v === 'SIDE') side++;
      else if (v === 'FRONT') front++;
    }
    return side >= front ? 'SIDE' : 'FRONT';
  }

  /**
   * 세 점 사이의 각도 계산 (도 단위)
   */
  getAngle(p1, p2, p3) {
    if (!p1 || !p2 || !p3) return null;

    const radians = Math.atan2(p3.y - p2.y, p3.x - p2.x) -
      Math.atan2(p1.y - p2.y, p1.x - p2.x);
    let degrees = Math.abs(radians * 180 / Math.PI);

    if (degrees > 180) {
      degrees = 360 - degrees;
    }

    return Math.round(degrees);
  }

  /**
   * 세 점 사이의 3D 각도 계산 (도 단위)
   * - camera view(측면/정면)에 덜 민감
   */
  getAngle3D(p1, p2, p3) {
    if (!p1 || !p2 || !p3) return null;

    const v1 = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y, z: p3.z - p2.z };

    const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
    if (!mag1 || !mag2) return null;

    let cos = dot / (mag1 * mag2);
    cos = Math.max(-1, Math.min(1, cos));
    const radians = Math.acos(cos);
    return Math.round(radians * 180 / Math.PI);
  }

  /**
   * 척추(상체) 기울기 각도 계산
   */
  getSpineAngle(landmarks, worldLandmarks = null) {
    // 3D world landmark가 있으면 전체 기울기(수직 대비)를 계산해서 정면/측면 모두에서 의미 있게 만듦
    if (Array.isArray(worldLandmarks) && worldLandmarks.length >= 33) {
      const ls = worldLandmarks[LANDMARKS.LEFT_SHOULDER];
      const rs = worldLandmarks[LANDMARKS.RIGHT_SHOULDER];
      const lh = worldLandmarks[LANDMARKS.LEFT_HIP];
      const rh = worldLandmarks[LANDMARKS.RIGHT_HIP];

      const valid = (p) =>
        p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

      if (valid(ls) && valid(rs) && valid(lh) && valid(rh)) {
        const shoulderMid = {
          x: (ls.x + rs.x) / 2,
          y: (ls.y + rs.y) / 2,
          z: (ls.z + rs.z) / 2
        };
        const hipMid = {
          x: (lh.x + rh.x) / 2,
          y: (lh.y + rh.y) / 2,
          z: (lh.z + rh.z) / 2
        };

        const vx = shoulderMid.x - hipMid.x;
        const vy = shoulderMid.y - hipMid.y;
        const vz = shoulderMid.z - hipMid.z;

        const horiz = Math.sqrt(vx * vx + vz * vz);
        const vert = Math.abs(vy);
        const angle = Math.atan2(horiz, vert) * 180 / Math.PI;
        return Math.round(angle);
      }
    }

    const shoulderMid = {
      x: (landmarks[LANDMARKS.LEFT_SHOULDER].x + landmarks[LANDMARKS.RIGHT_SHOULDER].x) / 2,
      y: (landmarks[LANDMARKS.LEFT_SHOULDER].y + landmarks[LANDMARKS.RIGHT_SHOULDER].y) / 2
    };
    const hipMid = {
      x: (landmarks[LANDMARKS.LEFT_HIP].x + landmarks[LANDMARKS.RIGHT_HIP].x) / 2,
      y: (landmarks[LANDMARKS.LEFT_HIP].y + landmarks[LANDMARKS.RIGHT_HIP].y) / 2
    };

    // 수직선과의 각도 계산
    const dx = shoulderMid.x - hipMid.x;
    const dy = shoulderMid.y - hipMid.y;
    const angle = Math.abs(Math.atan2(dx, -dy) * 180 / Math.PI);

    return Math.round(angle);
  }

  /**
   * 무릎 정렬 체크 (무릎이 발끝보다 앞으로 나왔는지)
   */
  getKneeAlignment(landmarks) {
    const leftDiff = landmarks[LANDMARKS.LEFT_KNEE].x - landmarks[LANDMARKS.LEFT_ANKLE].x;
    const rightDiff = landmarks[LANDMARKS.RIGHT_KNEE].x - landmarks[LANDMARKS.RIGHT_ANKLE].x;

    return {
      left: leftDiff,
      right: rightDiff,
      isAligned: Math.abs(leftDiff) < 0.05 && Math.abs(rightDiff) < 0.05
    };
  }

  /**
   * 점수 breakdown 기반 시각 피드백 업데이트
   * @param {Array} breakdown - ScoringEngine breakdown
   */
  setVisualFeedback(breakdown) {
    if (!Array.isArray(breakdown) || breakdown.length === 0) {
      this.visualFeedback = null;
      return;
    }

    const map = { landmarks: {}, connections: {} };

    for (const item of breakdown) {
      if (!item || !item.key) continue;
      const severity = this.getSeverityFromScore(item.score, item.maxScore);
      if (severity == null || severity === 0) continue;

      const mapping = this.getVisualMappingForMetric(item.key);
      if (!mapping) continue;

      if (Array.isArray(mapping.landmarks)) {
        for (const idx of mapping.landmarks) {
          const prev = map.landmarks[idx] || 0;
          map.landmarks[idx] = Math.max(prev, severity);
        }
      }

      if (Array.isArray(mapping.connections)) {
        for (const [start, end] of mapping.connections) {
          const key = this.getConnectionKey(start, end);
          const prev = map.connections[key] || 0;
          map.connections[key] = Math.max(prev, severity);
        }
      }
    }

    const hasFeedback = Object.keys(map.landmarks).length > 0 || Object.keys(map.connections).length > 0;
    this.visualFeedback = hasFeedback ? map : null;
  }

  getSeverityFromScore(score, maxScore) {
    if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) return null;
    const ratio = score / maxScore;
    if (ratio < FEEDBACK_THRESHOLDS.warn) return 2;
    if (ratio < FEEDBACK_THRESHOLDS.good) return 1;
    return 0;
  }

  getColorForSeverity(severity) {
    if (severity === 2) return FEEDBACK_COLORS.bad;
    if (severity === 1) return FEEDBACK_COLORS.warn;
    return FEEDBACK_COLORS.good;
  }

  getConnectionKey(start, end) {
    const a = Math.min(start, end);
    const b = Math.max(start, end);
    return `${a}-${b}`;
  }

  getLandmarkSeverity(index) {
    const map = this.visualFeedback?.landmarks;
    if (!map) return 0;
    return map[index] || 0;
  }

  getConnectionSeverity(start, end) {
    const map = this.visualFeedback?.connections;
    if (!map) return 0;
    const key = this.getConnectionKey(start, end);
    return map[key] || 0;
  }

  getVisualMappingForMetric(metricKey) {
    const key = (metricKey || '').toString().toLowerCase();
    if (!key) return null;

    if (key.includes('spine') || key.includes('torso') || key.includes('back')) {
      return this.getSpineVisualMap();
    }

    const side = key.startsWith('left_') ? 'left' : (key.startsWith('right_') ? 'right' : 'both');
    const base = key.replace(/^left_|^right_/, '');

    if (base.includes('elbow')) return this.getElbowVisualMap(side);
    if (base.includes('shoulder')) return this.getShoulderVisualMap(side);
    if (base.includes('hip')) return this.getHipVisualMap(side);
    if (base.includes('knee') || base === 'depth') return this.getKneeVisualMap(side);

    return null;
  }

  getSpineVisualMap() {
    return {
      landmarks: [
        LANDMARKS.LEFT_SHOULDER,
        LANDMARKS.RIGHT_SHOULDER,
        LANDMARKS.LEFT_HIP,
        LANDMARKS.RIGHT_HIP
      ],
      connections: [
        [LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_HIP],
        [LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_HIP],
        [LANDMARKS.LEFT_SHOULDER, LANDMARKS.RIGHT_SHOULDER],
        [LANDMARKS.LEFT_HIP, LANDMARKS.RIGHT_HIP]
      ]
    };
  }

  getElbowVisualMap(side) {
    const left = {
      landmarks: [LANDMARKS.LEFT_ELBOW],
      connections: [
        [LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_ELBOW],
        [LANDMARKS.LEFT_ELBOW, LANDMARKS.LEFT_WRIST]
      ]
    };
    const right = {
      landmarks: [LANDMARKS.RIGHT_ELBOW],
      connections: [
        [LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_ELBOW],
        [LANDMARKS.RIGHT_ELBOW, LANDMARKS.RIGHT_WRIST]
      ]
    };
    if (side === 'left') return left;
    if (side === 'right') return right;
    return {
      landmarks: left.landmarks.concat(right.landmarks),
      connections: left.connections.concat(right.connections)
    };
  }

  getShoulderVisualMap(side) {
    const left = {
      landmarks: [LANDMARKS.LEFT_SHOULDER],
      connections: [
        [LANDMARKS.LEFT_HIP, LANDMARKS.LEFT_SHOULDER],
        [LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_ELBOW]
      ]
    };
    const right = {
      landmarks: [LANDMARKS.RIGHT_SHOULDER],
      connections: [
        [LANDMARKS.RIGHT_HIP, LANDMARKS.RIGHT_SHOULDER],
        [LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_ELBOW]
      ]
    };
    if (side === 'left') return left;
    if (side === 'right') return right;
    return {
      landmarks: left.landmarks.concat(right.landmarks),
      connections: left.connections.concat(right.connections)
    };
  }

  getHipVisualMap(side) {
    const left = {
      landmarks: [LANDMARKS.LEFT_HIP],
      connections: [
        [LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_HIP],
        [LANDMARKS.LEFT_HIP, LANDMARKS.LEFT_KNEE]
      ]
    };
    const right = {
      landmarks: [LANDMARKS.RIGHT_HIP],
      connections: [
        [LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_HIP],
        [LANDMARKS.RIGHT_HIP, LANDMARKS.RIGHT_KNEE]
      ]
    };
    if (side === 'left') return left;
    if (side === 'right') return right;
    return {
      landmarks: left.landmarks.concat(right.landmarks),
      connections: left.connections.concat(right.connections)
    };
  }

  getKneeVisualMap(side) {
    const left = {
      landmarks: [LANDMARKS.LEFT_KNEE],
      connections: [
        [LANDMARKS.LEFT_HIP, LANDMARKS.LEFT_KNEE],
        [LANDMARKS.LEFT_KNEE, LANDMARKS.LEFT_ANKLE]
      ]
    };
    const right = {
      landmarks: [LANDMARKS.RIGHT_KNEE],
      connections: [
        [LANDMARKS.RIGHT_HIP, LANDMARKS.RIGHT_KNEE],
        [LANDMARKS.RIGHT_KNEE, LANDMARKS.RIGHT_ANKLE]
      ]
    };
    if (side === 'left') return left;
    if (side === 'right') return right;
    return {
      landmarks: left.landmarks.concat(right.landmarks),
      connections: left.connections.concat(right.connections)
    };
  }

  /**
   * 캔버스에 포즈 그리기
   */
  drawPose(canvas, results) {
    if (!results || !results.poseLandmarks) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // 연결선 그리기
    this.drawConnections(ctx, results.poseLandmarks, width, height);

    // 랜드마크 점 그리기
    this.drawLandmarks(ctx, results.poseLandmarks, width, height);
  }

  /**
   * 관절 연결선 그리기
   */
  drawConnections(ctx, landmarks, width, height) {
    const connections = [
      // 상체
      [LANDMARKS.LEFT_SHOULDER, LANDMARKS.RIGHT_SHOULDER],
      [LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_ELBOW],
      [LANDMARKS.LEFT_ELBOW, LANDMARKS.LEFT_WRIST],
      [LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_ELBOW],
      [LANDMARKS.RIGHT_ELBOW, LANDMARKS.RIGHT_WRIST],

      // 몸통
      [LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_HIP],
      [LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_HIP],
      [LANDMARKS.LEFT_HIP, LANDMARKS.RIGHT_HIP],

      // 하체
      [LANDMARKS.LEFT_HIP, LANDMARKS.LEFT_KNEE],
      [LANDMARKS.LEFT_KNEE, LANDMARKS.LEFT_ANKLE],
      [LANDMARKS.RIGHT_HIP, LANDMARKS.RIGHT_KNEE],
      [LANDMARKS.RIGHT_KNEE, LANDMARKS.RIGHT_ANKLE]
    ];

    ctx.lineWidth = 3;

    connections.forEach(([start, end]) => {
      const p1 = landmarks[start];
      const p2 = landmarks[end];

      if (p1.visibility > 0.5 && p2.visibility > 0.5) {
        const severity = this.getConnectionSeverity(start, end);
        ctx.strokeStyle = this.getColorForSeverity(severity);
        ctx.beginPath();
        ctx.moveTo(p1.x * width, p1.y * height);
        ctx.lineTo(p2.x * width, p2.y * height);
        ctx.stroke();
      }
    });
  }

  /**
   * 랜드마크 점 그리기
   */
  drawLandmarks(ctx, landmarks, width, height) {
    landmarks.forEach((landmark, index) => {
      // 얼굴 랜드마크는 운동 피드백에 사용하지 않으므로 캔버스에서 제외한다.
      if (index < LANDMARKS.LEFT_SHOULDER) return;

      if (landmark.visibility > 0.5) {
        ctx.beginPath();
        ctx.arc(landmark.x * width, landmark.y * height, 5, 0, 2 * Math.PI);
        const severity = this.getLandmarkSeverity(index);
        ctx.fillStyle = this.getColorForSeverity(severity);
        ctx.fill();
      }
    });
  }

  /**
   * 시작
   */
  start() {
    this.isRunning = true;
    console.log('[PoseEngine] 포즈 감지 시작');
  }

  /**
   * 정지
   */
  stop() {
    this.isRunning = false;
    console.log('[PoseEngine] 포즈 감지 정지');
  }

  /**
   * 필터 리셋 (새 세션 시작 시)
   */
  resetFilters() {
    if (this.landmarkSmoother) {
      this.landmarkSmoother.reset();
    }
    if (this.worldLandmarkSmoother) {
      this.worldLandmarkSmoother.reset();
    }
    this.viewHistory = [];
    console.log('[PoseEngine] 필터 리셋 완료');
  }

  /**
   * 필터 파라미터 변경
   * @param {string} presetName - 프리셋 이름: 'ULTRA_SMOOTH', 'SMOOTH', 'RESPONSIVE', 'MINIMAL'
   */
  setSmootherPreset(presetName) {
    if (typeof SMOOTHER_PRESETS !== 'undefined' && SMOOTHER_PRESETS[presetName]) {
      const preset = SMOOTHER_PRESETS[presetName];
      if (this.landmarkSmoother) {
        this.landmarkSmoother.setParameters(preset.minCutoff, preset.beta, preset.dCutoff);
      }
      if (this.worldLandmarkSmoother) {
        this.worldLandmarkSmoother.setParameters(preset.minCutoff, preset.beta, preset.dCutoff);
      }
      console.log('[PoseEngine] 스무딩 프리셋 변경:', presetName);
    }
  }

  /**
   * 리소스 정리
   */
  destroy() {
    this.stop();
    if (this.pose) {
      this.pose.close();
      this.pose = null;
    }
    this.isInitialized = false;
  }
}

// 전역 접근 가능하도록 export
window.PoseEngine = PoseEngine;
window.LANDMARKS = LANDMARKS;
