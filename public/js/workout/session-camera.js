/**
 * 운동 세션용 미디어 스트림 (웹캠 / 화면 공유 / 휴대폰 카메라)
 */
class SessionCamera {
  /**
   * @param {HTMLVideoElement} videoElement
   * @param {HTMLCanvasElement} canvasElement
   */
  constructor(videoElement, canvasElement) {
    this.videoElement = videoElement;
    this.canvasElement = canvasElement;
    this.currentStream = null;
  }

  /**
   * @param {'webcam'|'screen'|'mobile_rear'|'mobile_front'} sourceType
   * @returns {Promise<MediaStream>}
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
   * @param {MediaStream} stream
   */
  applyStream(stream) {
    this.destroy();
    this.currentStream = stream;

    const video = this.videoElement;
    const canvas = this.canvasElement;

    video.srcObject = stream;

    const syncCanvasSize = () => {
      if (video.videoWidth && video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
    };

    video.onloadedmetadata = () => {
      syncCanvasSize();
      video.play().catch(() => {});
    };

    if (video.readyState >= 1) {
      syncCanvasSize();
      video.play().catch(() => {});
    }

    stream.getVideoTracks().forEach((track) => {
      track.onended = () => {
        if (this.currentStream === stream) {
          this.destroy();
        }
      };
    });
  }

  destroy() {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach((t) => t.stop());
      this.currentStream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement.onloadedmetadata = null;
    }
  }
}

window.SessionCamera = SessionCamera;
window.SESSION_CAMERA_DEFAULT_SOURCE = 'webcam';
