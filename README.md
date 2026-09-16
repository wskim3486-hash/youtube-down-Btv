# ClipPort

사내 구성원이 공개 영상 URL을 분석하고 실제 제공 화질의 MP4 또는 MP3를 저장하는
Windows/macOS용 Electron 데스크톱 앱입니다.
DRM, 로그인, 인증, 유료·비공개 콘텐츠 접근 우회는 지원하지 않습니다.

## 데스크톱 앱 실행

개발 환경에서 Windows/macOS용 앱 도구를 준비하고 Electron을 실행합니다.

```sh
npm install
npm run desktop
```

`tools:prepare` 단계에서 현재 운영체제에 맞는 yt-dlp를 체크섬 검증해 내려받고,
고정된 npm 패키지의 FFmpeg/ffprobe 실행파일을 `resources/tools/<platform>-<arch>`에 준비합니다.
실행 중에는 개발 PC의 전역 PATH를 사용하지 않습니다.

Windows 설치파일 생성:

```powershell
npm run dist:win
```

macOS 설치 이미지 생성(Mac에서 실행):

```sh
npm run dist:mac
```

실행한 Mac의 아키텍처(Intel x64 또는 Apple Silicon arm64)에 맞는 도구와 설치 이미지가
생성됩니다. 생성 결과는 `dist/`에 저장됩니다. macOS 배포용 정식 설치 이미지는 Apple
Developer ID 서명과 notarization 설정이 추가로 필요합니다.
