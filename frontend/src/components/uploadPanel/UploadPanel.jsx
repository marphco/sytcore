import { useRef, useState } from "react";
import axios from "axios";

const API_URL =
  import.meta.env.VITE_API_URL ||
  `${window.location.protocol}//${window.location.hostname}:5050`;

export default function UploadPanel() {
  // -------- Detect iOS (Safari / PWA) --------
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  // -------- Photos --------
  const [photoFiles, setPhotoFiles] = useState([]);

  // -------- iOS fallback audio file (native recorder creates a file) --------
  const [audioFileFallback, setAudioFileFallback] = useState(null);

  // -------- Desktop MediaRecorder audio --------
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  // -------- UI state --------
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const hasMediaRecorder =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  // ---------- Desktop Recording ----------
  const startRecording = async () => {
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });

        setAudioBlob(blob);

        const url = URL.createObjectURL(blob);
        setAudioPreviewUrl(url);

        // stop mic tracks
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start();
      setRecording(true);
    } catch (err) {
      console.error(err);
      setError("Microphone permission denied or recording error.");
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    setRecording(false);
  };

  const resetAudio = () => {
    setAudioBlob(null);
    setAudioPreviewUrl(null);
    setAudioFileFallback(null);
    setRecording(false);
  };

  // ---------- Upload ----------
  const handleUpload = async () => {
    const hasAudio = !!audioBlob || !!audioFileFallback;
    const hasPhotos = photoFiles.length > 0;

    if (!hasAudio && !hasPhotos) {
      setError("Please add at least one voice note or photo.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();

      // Prefer desktop recorded audio
      if (audioBlob) {
        const audioFile = new File([audioBlob], "voice-note.webm", {
          type: audioBlob.type || "audio/webm",
        });
        formData.append("audio", audioFile);
      }
      // Else iOS native recorded file
      else if (audioFileFallback) {
        formData.append("audio", audioFileFallback);
      }

      // Photos
      photoFiles.forEach((p) => formData.append("photos", p));

      const res = await axios.post(`${API_URL}/api/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setResult(res.data);
    } catch (err) {
      console.error(err);
      setError("Upload failed. Check console/logs.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", padding: 16 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
        SYTCORE Upload
      </h2>

      {/* VOICE NOTE */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
          Voice Note (optional)
        </label>

        {/* iOS: use native recorder via input capture (works on HTTP LAN) */}
        {isIOS ? (
          <>
            <input
              id="voiceNoteInput"
              type="file"
              accept="audio/mp4,audio/m4a,audio/*"
              style={{ display: "none" }}
              onChange={(e) => setAudioFileFallback(e.target.files?.[0] || null)}
            />


            <button
              type="button"
              onClick={() => document.getElementById("voiceNoteInput").click()}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                fontWeight: 700,
                cursor: "pointer",
                width: "100%",
                marginBottom: 8,
              }}
            >
              🎙 Record Voice Note
            </button>

            {audioFileFallback && (
              <div style={{ fontSize: 12 }}>
                ✅ {audioFileFallback.name}
                <button
                  type="button"
                  onClick={() => setAudioFileFallback(null)}
                  style={{
                    marginLeft: 10,
                    fontSize: 12,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  Remove
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Desktop: MediaRecorder */}
            {hasMediaRecorder ? (
              <>
                <button
                  type="button"
                  onClick={recording ? stopRecording : startRecording}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "none",
                    fontWeight: 700,
                    cursor: "pointer",
                    width: "100%",
                    marginBottom: 8,
                  }}
                >
                  {recording ? "⏹ Stop Recording" : "🎙 Start Recording"}
                </button>

                {audioPreviewUrl && (
                  <div style={{ marginTop: 10 }}>
                    <audio
                      controls
                      src={audioPreviewUrl}
                      style={{ width: "100%" }}
                    />
                    <button
                      type="button"
                      onClick={resetAudio}
                      style={{
                        marginTop: 10,
                        width: "100%",
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: "none",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      🗑 Remove Voice Note
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Desktop fallback if MediaRecorder unsupported */}
                <p style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
                  Recording is not supported on this browser. Upload an audio
                  file instead.
                </p>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) =>
                    setAudioFileFallback(e.target.files?.[0] || null)
                  }
                />
                {audioFileFallback && (
                  <p style={{ fontSize: 12, marginTop: 6 }}>
                    ✅ {audioFileFallback.name}
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* PHOTOS */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
          Photos (1+)
        </label>

        <input
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={(e) => setPhotoFiles(Array.from(e.target.files || []))}
        />

        {photoFiles.length > 0 && (
          <p style={{ fontSize: 12, marginTop: 6 }}>
            ✅ {photoFiles.length} photos selected
          </p>
        )}
      </div>

      {/* BUTTON */}
      <button
        onClick={handleUpload}
        disabled={loading}
        style={{
          width: "100%",
          padding: "12px 14px",
          borderRadius: 10,
          border: "none",
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        {loading ? "Uploading..." : "Upload"}
      </button>

      {/* ERROR */}
      {error && (
        <p style={{ color: "red", marginTop: 12, fontSize: 13 }}>{error}</p>
      )}

      {/* RESULT */}
      {result && (
        <div style={{ marginTop: 18 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
            Result
          </h3>

          {result.audioUrl && (
            <div style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 13, fontWeight: 600 }}>Audio:</p>
              <a href={result.audioUrl} target="_blank" rel="noreferrer">
                {result.audioUrl}
              </a>
            </div>
          )}

          {result.photoUrls?.length > 0 && (
            <div>
              <p style={{ fontSize: 13, fontWeight: 600 }}>Photos:</p>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {result.photoUrls.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    <img
                      src={url}
                      alt="uploaded"
                      style={{
                        width: 90,
                        height: 90,
                        objectFit: "cover",
                        borderRadius: 10,
                      }}
                    />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
