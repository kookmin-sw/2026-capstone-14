/**
 * session-camera.js
 *
 * 운동 세션용 미디어 스트림 관리 클래스.
 * 웹캠, 화면 공유, 휴대폰 카메라(전면/후면) 스트림을 획득하고
 * 비디오 요소에 바인딩하며, 캔버스 오버레이 크기를 동기화합니다.
 */
class SessionCamera {
  /**
   * @param {HTMLVideoElement} videoElement - 비디오 요소
   * @param {HTMLCanvasElement} canvasElement - 랜드마크 오버레이 캔버스
   */
  constructor(videoElement, canvasElement) {
    this.videoElement = videoElement;
    this.canvasElement = canvasElement;
    this.currentStream = null;
    this.syncCanvasSize = null;
    this.resizeObserver = null;
    this.windowResizeHandler = null;
    this.videoResizeHandler = null;
    this.syncFrameId = null;
  }

  /**
   * 지정된 소스 타입의 미디어 스트림을 획득합니다.
   * 해상도/facingMode 제약 조건을 단계적으로 완화하여 최대한 스트림을 확보합니다.
   * 1차: 해상도 + facingMode → 2차: facingMode만 → 3차: 제약 없음
   * @param {'webcam'|'screen'|'mobile_rear'|'mobile_front'} sourceType - 미디어 소스 타입
   * @returns {Promise<MediaStream>} 미디어 스트림
   */
  async getStream(sourceType) {
    if (sourceType === 'screen') {
      return navigator.mediaDevices.getDisplayMedia({
        video: { width: 640, height: 480 }
      });
    }

    const facingMode =
      sourceType === 'mobile_rear' ? { ideal: 'environment' } : 'user';

    // 1차: 해상도 + facingMode 로 시도
    const preferred = {
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode
      }
    };

    try {
      return await navigator.mediaDevices.getUserMedia(preferred);
    } catch (firstError) {
      console.warn('[SessionCamera] 선호 제약 실패, fallback 시도:', firstError.name);
    }

    // 2차: facingMode만 (해상도 제약 제거)
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode }
      });
    } catch (secondError) {
      console.warn('[SessionCamera] facingMode 제약 실패, 최소 제약 시도:', secondError.name);
    }

    // 3차: 제약 없이 아무 카메라나 잡기
    return navigator.mediaDevices.getUserMedia({ video: true });
  }

  /**
   * 스트림을 비디오 요소에 적용하고 캔버스 오버레이 크기를 동기화합니다.
   * - 비디오 srcObject에 스트림 연결
   * - 캔버스 크기를 원본 비디오 해상도로 설정 (MediaPipe 랜드마크 좌표 비율 맞춤)
   * - CSS로 캔버스 표시 위치/크기를 비디오 object-fit 영역과 일치시킴
   * - 윈도우 리사이즈, 비디오 리사이즈, ResizeObserver로 캔버스 크기 자동 조정
   * @param {MediaStream} stream - 적용할 미디어 스트림
   */
  applyStream(stream) {
    this.destroy();
    this.currentStream = stream;

    const video = this.videoElement;
    const canvas = this.canvasElement;

    video.srcObject = stream;

    const container = canvas.parentElement;

    this.syncCanvasSize = () => {
      if (!video.videoWidth || !video.videoHeight || !container) return;

      const { width: containerW, height: containerH } = container.getBoundingClientRect();
      if (!containerW || !containerH) return;

      const videoRatio = video.videoWidth / video.videoHeight;
      const containerRatio = containerW / containerH;

      let displayW, displayH, offsetX, offsetY;

      if (videoRatio > containerRatio) {
        displayW = containerW;
        displayH = containerW / videoRatio;
        offsetX = 0;
        offsetY = (containerH - displayH) / 2;
      } else {
        displayH = containerH;
        displayW = containerH * videoRatio;
        offsetX = (containerW - displayW) / 2;
        offsetY = 0;
      }

      // 낮은 해상도 낼까봐 코너 케이스 방지
      displayW = Math.max(1, displayW);
      displayH = Math.max(1, displayH);

      // MediaPipe 랜드마크는 원본 비디오 해상도 기준 0~1 normalized.
      // 캔버스 낮은 해상도도 원본 해상도로 유지하여 좌표 비율을 맞춤.
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // CSS로 실제 표시 크기와 위치를 비디오 object-fit 영역과 동일하게 맞춤
      canvas.style.left = offsetX + 'px';
      canvas.style.top = offsetY + 'px';
      canvas.style.width = displayW + 'px';
      canvas.style.height = displayH + 'px';
    };

    const scheduleCanvasSync = () => {
      if (!this.syncCanvasSize) return;

      if (this.syncFrameId !== null) {
        window.cancelAnimationFrame(this.syncFrameId);
      }

      this.syncFrameId = window.requestAnimationFrame(() => {
        this.syncFrameId = null;
        if (this.syncCanvasSize) {
          this.syncCanvasSize();
        }
      });
    };

    video.onloadedmetadata = () => {
      scheduleCanvasSync();
      video.play().catch(() => {});
    };

    if (video.readyState >= 1) {
      scheduleCanvasSync();
      video.play().catch(() => {});
    }

    this.windowResizeHandler = scheduleCanvasSync;
    window.addEventListener('resize', this.windowResizeHandler);

    this.videoResizeHandler = scheduleCanvasSync;
    video.addEventListener('resize', this.videoResizeHandler);

    if (container && typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => {
        scheduleCanvasSync();
      });
      this.resizeObserver.observe(container);
    }

    stream.getVideoTracks().forEach((track) => {
      track.onended = () => {
        if (this.currentStream === stream) {
          this.destroy();
        }
      };
    });
  }

  /** 캔버스 크기 동기화 관련 이벤트 리스너와 애니메이션 프레임을 정리합니다. */
  teardownCanvasSync() {
    if (this.syncFrameId !== null) {
      window.cancelAnimationFrame(this.syncFrameId);
      this.syncFrameId = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.windowResizeHandler) {
      window.removeEventListener('resize', this.windowResizeHandler);
      this.windowResizeHandler = null;
    }

    if (this.videoElement && this.videoResizeHandler) {
      this.videoElement.removeEventListener('resize', this.videoResizeHandler);
      this.videoResizeHandler = null;
    }

    this.syncCanvasSize = null;
  }

  /**
   * 모든 리소스를 해제합니다.
   * - 캔버스 동기화 정리
   * - 미디어 스트림 트랙 중지
   * - 비디오 srcObject 제거
   * - 캔버스 CSS 초기화
   */
  destroy() {
    this.teardownCanvasSync();

    if (this.currentStream) {
      this.currentStream.getTracks().forEach((t) => t.stop());
      this.currentStream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement.onloadedmetadata = null;
    }
    if (this.canvasElement) {
      this.canvasElement.style.left = '';
      this.canvasElement.style.top = '';
      this.canvasElement.style.width = '';
      this.canvasElement.style.height = '';
    }
  }
}

window.SessionCamera = SessionCamera;
window.SESSION_CAMERA_DEFAULT_SOURCE = 'webcam';
