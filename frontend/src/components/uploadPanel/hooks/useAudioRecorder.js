import { useRef } from "react";
import axios from "axios";

function safeErrorMessage(err) {
  if (!err) return null;
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function useAudioRecorder({
  API_URL,
  hasMediaRecorder,
  updateEntry,
  setGlobalError,
  isExporting,
}) {
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);

  const getSupportedMimeType = () => {
    if (typeof MediaRecorder === "undefined") return "";
    const types = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
    return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
  };

  const transcribeBlob = async (entryId, audioBlob) => {
    updateEntry(entryId, { transcribing: true, error: null });

    if (!API_URL || API_URL === "https://") {
      updateEntry(entryId, {
        transcribing: false,
        error: "API URL missing or invalid. Check VITE_API_URL on Vercel.",
      });
      return;
    }

    try {
      const formData = new FormData();
      const ext = audioBlob.type?.includes("mp4") ? "m4a" : "webm";
      formData.append("audio", audioBlob, `voice-note.${ext}`);

      const url = `${API_URL}/api/transcribe-file`;

      const tRes = await axios.post(url, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 45000,
      });

      updateEntry(entryId, {
        transcript: tRes.data.transcript,
        text: (prevText) =>
          prevText
            ? `${prevText}\n${tRes.data.transcript}`
            : tRes.data.transcript,
        transcribing: false,
      });
    } catch (err) {
      const serverErr = err?.response?.data?.error || err?.response?.data;
      const msg =
        err.code === "ECONNABORTED"
          ? "Transcription timed out. Try again."
          : safeErrorMessage(serverErr || err.message || "Transcription failed.");

      updateEntry(entryId, { transcribing: false, error: msg });
    }
  };

  const startRecording = async (entryId) => {
    if (isExporting) return;

    setGlobalError(null);
    updateEntry(entryId, { error: null });

    if (!hasMediaRecorder) {
      updateEntry(entryId, { error: "Recording not supported on this device." });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = getSupportedMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType });

          if (!blob || blob.size === 0) {
            updateEntry(entryId, {
              recording: false,
              error: "Empty recording. Try again.",
            });
            return;
          }

          const previewUrl = URL.createObjectURL(blob);

          updateEntry(entryId, {
            audioBlob: blob,
            audioPreviewUrl: previewUrl,
            recording: false,
          });

          stream.getTracks().forEach((t) => t.stop());
          await transcribeBlob(entryId, blob);
        } catch (err) {
          updateEntry(entryId, { recording: false, error: safeErrorMessage(err) });
        }
      };

      recorder.start();
      updateEntry(entryId, { recording: true });
    } catch (err) {
      console.error("startRecording error:", err);
      updateEntry(entryId, {
        recording: false,
        error: "Microphone permission denied or recording failed.",
      });
    }
  };

  const stopRecording = () => {
    if (isExporting) return;

    try {
      const recorder = mediaRecorderRef.current;
      if (!recorder) return;
      if (recorder.state === "inactive") return;
      recorder.stop();
    } catch (err) {
      console.error(err);
    }
  };

  return {
    startRecording,
    stopRecording,
    transcribeBlob, // ✅ important: reused in sheet recording
  };
}
