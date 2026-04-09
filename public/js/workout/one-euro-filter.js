/**
 * One Euro Filter (1€ Filter) - JavaScript 구현
 * 움직임 속도에 따라 차단 주파수를 동적으로 조절하는 적응형 저역 통과 필터
 * - 정지 시 떨림(jitter)을 줄이고 움직임 시 지연(lag)을 최소화
 * 
 * Python core/filter.py 기반 JavaScript 포팅
 */

/**
 * 지수 평활 계수 alpha 계산 (시간 간격과 차단 주파수 기준)
 */
function smoothingFactor(deltaTime, cutoff) {
  const r = 2 * Math.PI * cutoff * deltaTime;
  return r / (r + 1);
}

/**
 * 기본 지수 평활 적용
 */
function exponentialSmoothing(alpha, x, xPrev) {
  return alpha * x + (1.0 - alpha) * xPrev;
}

/**
 * One Euro Filter 클래스
 */
class OneEuroFilter {
  /**
   * @param {number} t0 - 초기 타임스탬프 (초)
   * @param {number} x0 - 초기 신호 값
   * @param {number} dx0 - 초기 미분값(속도) 추정치
   * @param {number} minCutoff - 최소 차단 주파수 (Hz) - 낮을수록 저속에서 더 부드러움
   * @param {number} beta - 속도 계수 - 높을수록 속도에 따른 반응성 증가 (지연 감소)
   * @param {number} dCutoff - 미분값(속도)에 대한 차단 주파수 (Hz)
   */
  constructor(t0, x0, dx0 = 0.0, minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;

    this.tPrev = t0;
    this.xPrev = x0;
    this.dxPrev = dx0;
  }

  /**
   * 새로운 값을 입력받아 필터링된 결과 반환
   * @param {number} t - 현재 타임스탬프 (초)
   * @param {number} x - 현재 입력값
   * @returns {number} 필터링된 값
   */
  filter(t, x) {
    const deltaTime = t - this.tPrev;
    
    if (deltaTime <= 0) {
      return this.xPrev;
    }

    // 1. 속도(미분값) 계산 및 필터링
    const dx = (x - this.xPrev) / deltaTime;
    const alphaD = smoothingFactor(deltaTime, this.dCutoff);
    const dxHat = exponentialSmoothing(alphaD, dx, this.dxPrev);

    // 2. 속도에 따른 가변 차단 주파수 계산
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);

    // 3. 신호 필터링
    const alpha = smoothingFactor(deltaTime, cutoff);
    const xHat = exponentialSmoothing(alpha, x, this.xPrev);

    // 상태 업데이트
    this.tPrev = t;
    this.xPrev = xHat;
    this.dxPrev = dxHat;

    return xHat;
  }

  /**
   * 필터 상태 리셋
   */
  reset(t, x) {
    this.tPrev = t;
    this.xPrev = x;
    this.dxPrev = 0;
  }
}

/**
 * 3D 포인트용 One Euro Filter
 * x, y, z 각 축에 대해 독립적인 필터 적용
 */
class OneEuroFilter3D {
  /**
   * @param {number} t0 - 초기 타임스탬프 (초)
   * @param {Object} point0 - 초기 포인트 {x, y, z}
   * @param {number} minCutoff - 최소 차단 주파수
   * @param {number} beta - 속도 계수
   * @param {number} dCutoff - 미분값 차단 주파수
   */
  constructor(t0, point0, minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
    this.filterX = new OneEuroFilter(t0, point0.x || 0, 0, minCutoff, beta, dCutoff);
    this.filterY = new OneEuroFilter(t0, point0.y || 0, 0, minCutoff, beta, dCutoff);
    this.filterZ = new OneEuroFilter(t0, point0.z || 0, 0, minCutoff, beta, dCutoff);
  }

  /**
   * 3D 포인트 필터링
   * @param {number} t - 현재 타임스탬프 (초)
   * @param {Object} point - 현재 포인트 {x, y, z, visibility?}
   * @returns {Object} 필터링된 포인트
   */
  filter(t, point) {
    return {
      x: this.filterX.filter(t, point.x),
      y: this.filterY.filter(t, point.y),
      z: this.filterZ.filter(t, point.z || 0),
      visibility: point.visibility // visibility는 필터링하지 않음
    };
  }

  /**
   * 필터 상태 리셋
   */
  reset(t, point) {
    this.filterX.reset(t, point.x || 0);
    this.filterY.reset(t, point.y || 0);
    this.filterZ.reset(t, point.z || 0);
  }
}

/**
 * MediaPipe 랜드마크 전체에 One Euro Filter 적용하는 클래스
 */
class LandmarkSmoother {
  /**
   * @param {Object} options - 필터 옵션
   * @param {number} options.minCutoff - 최소 차단 주파수 (기본: 1.0, 낮을수록 부드러움)
   * @param {number} options.beta - 속도 계수 (기본: 0.5, 높을수록 빠른 움직임에 반응)
   * @param {number} options.dCutoff - 미분값 차단 주파수 (기본: 1.0)
   * @param {number} options.landmarkCount - 랜드마크 개수 (MediaPipe Pose: 33)
   */
  constructor(options = {}) {
    this.minCutoff = options.minCutoff ?? 1.0;
    this.beta = options.beta ?? 0.5;
    this.dCutoff = options.dCutoff ?? 1.0;
    this.landmarkCount = options.landmarkCount ?? 33;
    
    this.filters = null; // 랜드마크별 필터 배열
    this.isInitialized = false;
  }

  /**
   * 첫 프레임으로 필터 초기화
   * @param {number} timestamp - 타임스탬프 (ms → 초 변환됨)
   * @param {Array} landmarks - 랜드마크 배열
   */
  initialize(timestamp, landmarks) {
    const t = timestamp / 1000; // ms → 초
    
    this.filters = landmarks.map(landmark => 
      new OneEuroFilter3D(t, landmark, this.minCutoff, this.beta, this.dCutoff)
    );
    
    this.isInitialized = true;
    console.log('[LandmarkSmoother] 초기화 완료 - landmarkCount:', landmarks.length);
  }

  /**
   * 랜드마크 배열 필터링
   * @param {number} timestamp - 타임스탬프 (ms)
   * @param {Array} landmarks - 원본 랜드마크 배열
   * @returns {Array} 필터링된 랜드마크 배열
   */
  filter(timestamp, landmarks) {
    if (!landmarks || landmarks.length === 0) {
      return landmarks;
    }

    // 첫 프레임이면 초기화
    if (!this.isInitialized) {
      this.initialize(timestamp, landmarks);
      return landmarks; // 첫 프레임은 그대로 반환
    }

    const t = timestamp / 1000; // ms → 초
    
    return landmarks.map((landmark, index) => {
      if (!this.filters[index]) {
        // 새 랜드마크면 필터 생성
        this.filters[index] = new OneEuroFilter3D(t, landmark, this.minCutoff, this.beta, this.dCutoff);
        return landmark;
      }
      return this.filters[index].filter(t, landmark);
    });
  }

  /**
   * 필터 리셋 (새 세션 시작 시)
   */
  reset() {
    this.filters = null;
    this.isInitialized = false;
    console.log('[LandmarkSmoother] 리셋 완료');
  }

  /**
   * 파라미터 업데이트
   */
  setParameters(minCutoff, beta, dCutoff) {
    this.minCutoff = minCutoff ?? this.minCutoff;
    this.beta = beta ?? this.beta;
    this.dCutoff = dCutoff ?? this.dCutoff;
    
    // 기존 필터 리셋 (새 파라미터로 다시 초기화됨)
    this.reset();
    console.log('[LandmarkSmoother] 파라미터 업데이트:', { minCutoff: this.minCutoff, beta: this.beta, dCutoff: this.dCutoff });
  }
}

// 프리셋 설정
const SMOOTHER_PRESETS = {
  // 매우 부드러움 - 느린 동작, 정적 자세 분석용
  ULTRA_SMOOTH: { minCutoff: 0.5, beta: 0.1, dCutoff: 1.0 },
  
  // 부드러움 - 일반 운동 트래킹용 (기본값)
  SMOOTH: { minCutoff: 1.0, beta: 0.5, dCutoff: 1.0 },
  
  // 반응적 - 빠른 동작 감지용
  RESPONSIVE: { minCutoff: 1.5, beta: 1.0, dCutoff: 1.0 },
  
  // 최소 필터링 - 원본에 가까움
  MINIMAL: { minCutoff: 3.0, beta: 2.0, dCutoff: 1.0 }
};

// 전역 export
window.OneEuroFilter = OneEuroFilter;
window.OneEuroFilter3D = OneEuroFilter3D;
window.LandmarkSmoother = LandmarkSmoother;
window.SMOOTHER_PRESETS = SMOOTHER_PRESETS;
