export async function startWavRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const audioContext = new (window.AudioContext || window.webkitAudioContext)({
    sampleRate: 44100,
  });

  const source = audioContext.createMediaStreamSource(stream);

  // ✅ gain node muted (NO output to speakers!)
  const gainNode = audioContext.createGain();
  gainNode.gain.value = 0;

  const processor = audioContext.createScriptProcessor(2048, 1, 1);

  const chunks = [];
  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
  };

  source.connect(processor);
  processor.connect(gainNode);
  gainNode.connect(audioContext.destination);

  return { stream, audioContext, source, processor, chunks, gainNode };
}

export function stopWavRecording(recorder) {
  const { stream, audioContext, source, processor, gainNode, chunks } = recorder;

  processor.disconnect();
  source.disconnect();
  gainNode.disconnect();

  stream.getTracks().forEach((t) => t.stop());

  const wavBlob = encodeWAV(chunks, audioContext.sampleRate);

  audioContext.close();

  return wavBlob;
}

// ---- WAV encoder ----
function encodeWAV(chunks, sampleRate) {
  const buffer = flattenChunks(chunks);

  // ✅ downsample to 16000 to reduce memory + huge blobs
  const downsampled = downsampleBuffer(buffer, sampleRate, 16000);

  const wavBuffer = new ArrayBuffer(44 + downsampled.length * 2);
  const view = new DataView(wavBuffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + downsampled.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 16000 * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, downsampled.length * 2, true);

  let offset = 44;
  for (let i = 0; i < downsampled.length; i++) {
    const s = Math.max(-1, Math.min(1, downsampled[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([view], { type: "audio/wav" });
}

function flattenChunks(chunks) {
  const length = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Float32Array(length);

  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });

  return result;
}

function downsampleBuffer(buffer, sampleRate, outSampleRate) {
  if (outSampleRate === sampleRate) return buffer;
  const ratio = sampleRate / outSampleRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);

  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);

    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }

    result[offsetResult] = accum / count;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
