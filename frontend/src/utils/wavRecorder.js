export async function startWavRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioContext.createMediaStreamSource(stream);

  const processor = audioContext.createScriptProcessor(4096, 1, 1);

  const chunks = [];
  processor.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(data));
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  return { stream, audioContext, source, processor, chunks };
}

export function stopWavRecording(recorder) {
  const { stream, audioContext, source, processor, chunks } = recorder;

  processor.disconnect();
  source.disconnect();

  stream.getTracks().forEach((t) => t.stop());

  const wavBlob = encodeWAV(chunks, audioContext.sampleRate);

  audioContext.close();

  return wavBlob;
}

// ---- WAV encoder ----
function encodeWAV(chunks, sampleRate) {
  const buffer = flattenChunks(chunks);
  const wavBuffer = new ArrayBuffer(44 + buffer.length * 2);
  const view = new DataView(wavBuffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + buffer.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, buffer.length * 2, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
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

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
