const React = require('react');

const RTCPeerConnection =
  typeof window !== 'undefined' && window.RTCPeerConnection ? window.RTCPeerConnection : class {};
const RTCIceCandidate =
  typeof window !== 'undefined' && window.RTCIceCandidate ? window.RTCIceCandidate : class {};
const RTCSessionDescription =
  typeof window !== 'undefined' && window.RTCSessionDescription
    ? window.RTCSessionDescription
    : class {};
const MediaStream =
  typeof window !== 'undefined' && window.MediaStream ? window.MediaStream : class {};
const MediaStreamTrack =
  typeof window !== 'undefined' && window.MediaStreamTrack ? window.MediaStreamTrack : class {};

const mediaDevices =
  typeof navigator !== 'undefined' && navigator.mediaDevices
    ? navigator.mediaDevices
    : {
        getUserMedia: () =>
          Promise.reject(new Error('mediaDevices not available on this platform')),
        enumerateDevices: () => Promise.resolve([]),
      };

const RTCView = ({ streamURL, objectFit = 'cover', style, ...props }) => {
  const videoRef = React.useRef(null);

  React.useEffect(() => {
    if (videoRef.current && streamURL && typeof streamURL === 'object') {
      videoRef.current.srcObject = streamURL;
    }
  }, [streamURL]);

  return React.createElement('video', {
    ref: videoRef,
    autoPlay: true,
    playsInline: true,
    muted: true,
    style: {
      width: '100%',
      height: '100%',
      objectFit,
      ...style,
    },
    ...props,
  });
};

module.exports = {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  MediaStream,
  MediaStreamTrack,
  mediaDevices,
  RTCView,
  registerGlobals: () => {},
};
