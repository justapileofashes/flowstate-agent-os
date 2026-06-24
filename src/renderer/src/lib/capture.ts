import { ipc } from './ipc';

// Captures system audio via the loopback handler registered in main.
// Caller creates the job first (ipc.capture.start) and passes its id here.
export async function startSystemAudioCapture(
  captureId: string,
): Promise<{ stop: () => Promise<void> }> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  for (const track of stream.getVideoTracks()) track.stop(); // audio only
  const audio = new MediaStream(stream.getAudioTracks());
  const rec = new MediaRecorder(audio, { mimeType: 'audio/webm;codecs=opus' });
  rec.ondataavailable = (ev) => {
    if (ev.data.size > 0) {
      void ev.data.arrayBuffer().then((buf) => ipc.capture.chunk(captureId, buf));
    }
  };
  rec.start(5_000);
  return {
    stop: () =>
      new Promise<void>((resolve) => {
        rec.onstop = () => {
          for (const track of audio.getTracks()) track.stop();
          void ipc.capture.stop(captureId).then(() => resolve());
        };
        rec.stop(); // flushes a final ondataavailable before onstop
      }),
  };
}
