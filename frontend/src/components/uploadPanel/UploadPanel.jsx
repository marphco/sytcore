import { useEffect, useRef, useState } from "react";
import axios from "axios";
import "./UploadPanel.css";

const API_URL = import.meta.env.VITE_API_URL;

// ---------- Helpers ----------
function createEntry() {
  return {
    id: crypto.randomUUID(),
    audioBlob: null,
    audioPreviewUrl: null,
    audioRemoteUrl: null,

    photoFiles: [],
    photoRemoteUrls: [],

    transcript: null,
    text: "", // ✅ testo finale editabile

    uploading: false,
    transcribing: false,
    error: null,
  };
}


// localStorage key
const LS_KEY = "sytcore_entries_v1";

export default function UploadPanel() {
  const [entries, setEntries] = useState([createEntry()]);
  const [globalError, setGlobalError] = useState(null);

  // MediaRecorder refs
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const activeEntryIdRef = useRef(null);

  const hasMediaRecorder =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  // ---------- Load from localStorage ----------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);

      const restored = saved.map((e) => ({
        ...createEntry(),
        id: e.id || crypto.randomUUID(),
        audioRemoteUrl: e.audioRemoteUrl || null,
        photoRemoteUrls: e.photoRemoteUrls || [],
        transcript: e.transcript || null,
      }));

      if (restored.length > 0) setEntries(restored);
    } catch (err) {
      console.error("localStorage load error:", err);
    }
  }, []);

  // ---------- Save to localStorage ----------
  useEffect(() => {
    try {
      const minimal = entries.map((e) => ({
        id: e.id,
        audioRemoteUrl: e.audioRemoteUrl,
        photoRemoteUrls: e.photoRemoteUrls,
        transcript: e.transcript,
        text: e.text,
      }));
      localStorage.setItem(LS_KEY, JSON.stringify(minimal));
    } catch (err) {
      console.error("localStorage save error:", err);
    }
  }, [entries]);

  // ---------- Update entry ----------
  const updateEntry = (id, patch) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e))
    );
  };

  // ✅ AUTO TRANSCRIBE DIRECTLY FROM BLOB (NO UPLOAD NEEDED)
  const transcribeBlob = async (entryId, audioBlob) => {
    updateEntry(entryId, {
      transcribing: true,
      transcript: null,
      error: null,
    });

    try {
      const formData = new FormData();

      // ✅ Convert blob -> File (important for OpenAI)
      const file = new File([audioBlob], "voice-note.webm", {
        type: audioBlob.type || "audio/webm",
      });

      formData.append("audio", file);

      const tRes = await axios.post(`${API_URL}/api/transcribe-file`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      updateEntry(entryId, {
        transcript: tRes.data.transcript,
        text: tRes.data.transcript,
        transcribing: false,
      });

    } catch (err) {
      console.error("TRANSCRIBE ERROR:", err?.response?.data || err.message);

      updateEntry(entryId, {
        transcribing: false,
        error: err?.response?.data?.error || "Transcription failed.",
      });
    }
  };


  // ---------- Recording ----------
  const startRecording = async (entryId) => {
    setGlobalError(null);
    updateEntry(entryId, { error: null });

    // block if already recording another entry
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      updateEntry(entryId, {
        error: "Already recording another entry. Stop it first.",
      });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      activeEntryIdRef.current = entryId;

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });

        const previewUrl = URL.createObjectURL(blob);

        updateEntry(entryId, {
          audioBlob: blob,
          audioPreviewUrl: previewUrl,
          recording: false,
          transcript: null,
          error: null,
        });

        // stop mic
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        activeEntryIdRef.current = null;

        // ✅ AUTO TRANSCRIBE RIGHT HERE
        await transcribeBlob(entryId, blob);
      };

      recorder.start();
      updateEntry(entryId, { recording: true });
    } catch (err) {
      console.error(err);
      updateEntry(entryId, {
        recording: false,
        error: "Microphone permission denied or recording error.",
      });
    }
  };

  const stopRecording = (entryId) => {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    updateEntry(entryId, { recording: false });
  };

  const resetEntry = (entryId) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        if (e.audioPreviewUrl) URL.revokeObjectURL(e.audioPreviewUrl);

        return {
          ...createEntry(),
          id: e.id,
        };
      })
    );

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    mediaRecorderRef.current = null;
    activeEntryIdRef.current = null;
  };

  // ---------- Upload Entry (ONLY for saving media remote) ----------
  const uploadEntry = async (entry) => {
    if (!entry.audioBlob && entry.photoFiles.length === 0) {
      updateEntry(entry.id, {
        error: "Please add a voice note OR at least one photo.",
      });
      return;
    }

    updateEntry(entry.id, {
      uploading: true,
      error: null,
    });

    try {
      const formData = new FormData();

      if (entry.audioBlob) {
        const audioFile = new File([entry.audioBlob], `voice-note.webm`, {
          type: entry.audioBlob.type || "audio/webm",
        });
        formData.append("audio", audioFile);
      }

      entry.photoFiles.forEach((p) => formData.append("photos", p));

      const uploadRes = await axios.post(`${API_URL}/api/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const { audioUrl, photoUrls } = uploadRes.data;

      updateEntry(entry.id, {
        audioRemoteUrl: audioUrl,
        photoRemoteUrls: photoUrls || [],
      });
    } catch (err) {
      console.error("UPLOAD ERROR:", err?.response?.data || err.message);
      updateEntry(entry.id, {
        error: err?.response?.data?.error || "Upload failed.",
      });
    } finally {
      updateEntry(entry.id, { uploading: false });
    }
  };

  // ---------- Add Entry ----------
  const addEntry = () => {
    setEntries((prev) => [...prev, createEntry()]);
  };

  // ---------- Clear all ----------
  const clearReport = () => {
    if (!confirm("Clear all entries?")) return;

    entries.forEach((e) => {
      if (e.audioPreviewUrl) URL.revokeObjectURL(e.audioPreviewUrl);
    });

    localStorage.removeItem(LS_KEY);
    setEntries([createEntry()]);
  };

  return (
    <div className="wrapper">
      <div className="topBar">
        <h2 className="title">SYTCORE Daily Report</h2>

        <button className="btnDanger" onClick={clearReport}>
          Clear Report
        </button>
      </div>

      {!hasMediaRecorder && (
        <p className="muted">
          Recording is not supported on this browser. Use Safari/Chrome.
        </p>
      )}

      {globalError && <p className="error">{globalError}</p>}

      <div className="entries">
        {entries.map((entry, idx) => (
          <div key={entry.id} className="entryCard">
            {/* LEFT */}
            <div className="leftCol">
              <p className="entryHeader">Entry #{idx + 1}</p>

              <div className="controlsRow">
                {!entry.recording ? (
                  <button
                    className="btn"
                    onClick={() => startRecording(entry.id)}
                    disabled={!hasMediaRecorder || entry.uploading}
                  >
                    🎙 Record
                  </button>
                ) : (
                  <button className="btn" onClick={() => stopRecording(entry.id)}>
                    ⏹ Stop
                  </button>
                )}

                <button
                  className="btnGhost"
                  onClick={() => resetEntry(entry.id)}
                  disabled={entry.uploading || entry.transcribing}
                >
                  🗑 Reset
                </button>
              </div>

              {entry.audioPreviewUrl && (
                <audio className="audio" controls src={entry.audioPreviewUrl} />
              )}

              {/* DESCRIPTION (editable) */}
              <div style={{ marginTop: 18 }}>
                <p style={{ fontWeight: 700, marginBottom: 8, letterSpacing: 1, opacity: 0.85 }}>
                  DESCRIPTION
                </p>

                {entry.transcribing && (
                  <p style={{ fontSize: 13, opacity: 0.75, marginBottom: 8 }}>
                    Transcribing...
                  </p>
                )}

                <textarea
                  value={entry.text || ""}
                  onChange={(e) => updateEntry(entry.id, { text: e.target.value })}
                  placeholder="Your description will appear here after transcription… but you can edit it."
                  style={{
                    width: "100%",
                    minHeight: 110,
                    resize: "vertical",
                    borderRadius: 12,
                    padding: 14,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.04)",
                    color: "#fff",
                    fontSize: 13.5,
                    lineHeight: 1.5,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

            </div>

            {/* RIGHT */}
            <div className="rightCol">
              <p className="sectionTitle">Photos</p>

              <input
                className="fileInput"
                type="file"
                accept="image/*"
                multiple
                disabled={entry.uploading}
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  updateEntry(entry.id, { photoFiles: files });
                }}
              />

              {entry.photoFiles.length > 0 && (
                <p className="mutedSmall">
                  ✅ {entry.photoFiles.length} photo(s) selected
                </p>
              )}

              {entry.photoRemoteUrls?.length > 0 && (
                <div className="grid">
                  {entry.photoRemoteUrls.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer">
                      <img className="thumb" src={url} alt="uploaded" />
                    </a>
                  ))}
                </div>
              )}

              <button
                className="btnPrimary"
                onClick={() => uploadEntry(entry)}
                disabled={entry.uploading || entry.transcribing}
              >
                {entry.uploading ? "Uploading..." : "Upload Entry"}
              </button>

              {entry.error && <p className="error">{entry.error}</p>}
            </div>
          </div>
        ))}
      </div>

      <button className="addEntryBtn" onClick={addEntry}>
        ➕ Add Entry
      </button>
    </div>
  );
}
