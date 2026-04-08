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
    const videoConstraints = {
      width: { ideal: 640 },
      height: { ideal: 480 }
    };

    switch (sourceType) {
      case 'screen':
        return navigator.mediaDevices.getDisplayMedia({
          video: { width: 640, height: 480 }
        });

      case 'webcam':
        return navigator.mediaDevices.getUserMedia({
          video: {
            ...videoConstraints,
            facingMode: 'user'
          }
        });

      case 'mobile_rear':
        return navigator.mediaDevices.getUserMedia({
          video: {
            ...videoConstraints,
            facingMode: { ideal: 'environment' }
          }
        });

      case 'mobile_front':
        return navigator.mediaDevices.getUserMedia({
          video: {
            ...videoConstraints,
            facingMode: 'user'
          }
        });

      default:
        throw new Error(`Unknown camera source: ${sourceType}`);
    }
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
    };

    // 이미 메타데이터가 있는 경우(재연결 등)
    if (video.readyState >= 1) {
      syncCanvasSize();
    }

    // 화면 공유: 사용자가 공유 중지 시 트랙 종료
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
window.SESSION_CAMERA_DEFAULT_SOURCE = 'screen';
