import { useState, useRef } from "react";
import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL;

export default function UploadPanel() {
  const [audioFile, setAudioFile] = useState(null);
  const [photoFiles, setPhotoFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);


  const handleUpload = async () => {
    if (!audioFile && photoFiles.length === 0) {
      setError("Carica almeno un audio o una foto.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      if (audioBlob) {
        const audioFile = new File([audioBlob], "voice-note.webm", {
          type: audioBlob.type,
        });
        formData.append("audio", audioFile);
      }

      photoFiles.forEach((p) => formData.append("photos", p));

      const res = await axios.post(`${API_URL}/api/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setResult(res.data);
    } catch (err) {
      console.error(err);
      setError("Upload fallito. Controlla console/log.");
    } finally {
      setLoading(false);
    }
  };

  const startRecording = async () => {
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });

        setAudioBlob(blob);

        const url = URL.createObjectURL(blob);
        setAudioUrl(url);

        // stop all tracks (important on iPhone)
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start();
      setRecording(true);
    } catch (err) {
      console.error(err);
      setError("Permesso microfono negato o errore recording.");
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    setRecording(false);
  };


  return (
    <div style={{ maxWidth: 420, margin: "0 auto", padding: 16 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
        SYTCORE Upload
      </h2>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
          Voice Note (opzionale)
        </label>

        <div style={{ display: "flex", gap: 10 }}>
          {!recording ? (
            <button
              onClick={startRecording}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              🎙️ Record
            </button>
          ) : (
            <button
              onClick={stopRecording}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              ⏹ Stop
            </button>
          )}

          {audioBlob && (
            <button
              onClick={() => {
                setAudioBlob(null);
                setAudioUrl(null);
              }}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              🗑 Reset
            </button>
          )}
        </div>

        {audioUrl && (
          <div style={{ marginTop: 10 }}>
            <audio controls src={audioUrl} style={{ width: "100%" }} />
          </div>
        )}
      </div>


      {/* PHOTOS */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
          Foto (1+)
        </label>
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => setPhotoFiles(Array.from(e.target.files || []))}
        />
        {photoFiles.length > 0 && (
          <p style={{ fontSize: 12, marginTop: 6 }}>
            ✅ {photoFiles.length} foto selezionate
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
            Risultato
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
              <p style={{ fontSize: 13, fontWeight: 600 }}>Foto:</p>

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
