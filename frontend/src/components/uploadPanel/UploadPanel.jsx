import { useEffect, useRef, useState } from "react";
import axios from "axios";
import jsPDF from "jspdf";
import "./UploadPanel.css";
import { normalizeImage } from "../../utils/normalizeImage";
import imageCompression from "browser-image-compression";


const API_URL = import.meta.env.VITE_API_URL;

// ---------- Helpers ----------
function createEntry() {
  return {
    id: crypto.randomUUID(),

    audioBlob: null,
    audioPreviewUrl: null,

    // ✅ foto originali selezionate
    photoFiles: [],

    // ✅ foto normalizzate (BLOB JPG pronti per PDF)
    photoBlobs: [],

    // ✅ preview urls per mostrare le foto in UI
    photoPreviewUrls: [],

    transcript: null,
    text: "",

    uploading: false,
    transcribing: false,
    error: null,
  };
}

const LS_KEY = "sytcore_entries_v1";

// convert file -> dataURL (base64)
const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

export default function UploadPanel() {
  const [entries, setEntries] = useState([createEntry()]);
  const [globalError, setGlobalError] = useState(null);

  const [projectName, setProjectName] = useState("");
  const [reportDate, setReportDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });


  // MediaRecorder refs
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);

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

      setProjectName(saved.projectName || "");
      setReportDate(saved.reportDate || new Date().toISOString().slice(0, 10));

      const restored = (saved.entries || []).map((e) => ({
        ...createEntry(),
        id: e.id || crypto.randomUUID(),
        text: e.text || "",
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
      const minimal = {
        projectName,
        reportDate,
        entries: entries.map((e) => ({
          id: e.id,
          transcript: e.transcript,
          text: e.text,
        })),
      };

      localStorage.setItem(LS_KEY, JSON.stringify(minimal));

    } catch (err) {
      console.error("localStorage save error:", err);
    }
  }, [entries]);

  // ---------- Update entry ----------
  const updateEntry = (id, patch) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;

        // patch può essere oggetto o funzione
        const resolvedPatch =
          typeof patch === "function" ? patch(e) : patch;

        // supporta anche campo text: (prevText)=>...
        const finalPatch = { ...resolvedPatch };

        if (typeof resolvedPatch.text === "function") {
          finalPatch.text = resolvedPatch.text(e.text || "");
        }

        return { ...e, ...finalPatch };
      })
    );
  };


  async function normalizeImages(files) {
    const normalized = [];

    for (const file of files) {
      try {
        const compressed = await imageCompression(file, {
          maxSizeMB: 2,                  // puoi alzare o abbassare
          maxWidthOrHeight: 2000,        // mantiene buona qualità
          useWebWorker: true,
          exifOrientation: true,         // ✅ QUESTO è il punto chiave
        });

        // manteniamo name e type coerenti
        const fixedFile = new File([compressed], file.name, { type: compressed.type });
        normalized.push(fixedFile);
      } catch (err) {
        console.error("normalizeImages error:", err);
        normalized.push(file); // fallback
      }
    }

    return normalized;
  }

  // ✅ AUTO TRANSCRIBE DIRECTLY FROM BLOB
  const transcribeBlob = async (entryId, audioBlob) => {
    updateEntry(entryId, {
      transcribing: true,
      transcript: null,
      error: null,
    });

    try {
      const formData = new FormData();
      const file = new File([audioBlob], "voice-note.webm", {
        type: audioBlob.type || "audio/webm",
      });

      formData.append("audio", file);

      const tRes = await axios.post(`${API_URL}/api/transcribe-file`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      updateEntry(entryId, {
        transcript: tRes.data.transcript,
        text: (prevText) =>
          prevText ? `${prevText}\n${tRes.data.transcript}` : tRes.data.transcript,
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

        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

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
        e.photoPreviewUrls?.forEach((u) => URL.revokeObjectURL(u));

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
  };

  const addEntry = () => {
    setEntries((prev) => [...prev, createEntry()]);
  };

  const clearReport = () => {
    if (!confirm("Clear all entries?")) return;

    entries.forEach((e) => {
      if (e.audioPreviewUrl) URL.revokeObjectURL(e.audioPreviewUrl);
      e.photoPreviewUrls?.forEach((u) => URL.revokeObjectURL(u));
    });

    localStorage.removeItem(LS_KEY);
    setEntries([createEntry()]);
  };

  // ---------- PDF GENERATOR ----------
  const generatePDF = async () => {
    setGlobalError(null);

    try {
      const doc = new jsPDF("p", "mm", "a4");

      const pageW = 210;
      const pageH = 297;
      const margin = 12;
      const contentW = pageW - margin * 2;

      let y = margin;

      // Header
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text(`${projectName || "SYTCORE"} Daily Report`, margin, y);
      y += 10;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.text(`Report date: ${reportDate}   •   Generated: ${new Date().toLocaleString()}`, margin, y);
      y += 12;

      // Helper for page break
      const ensureSpace = (neededHeight) => {
        if (y + neededHeight > pageH - margin) {
          doc.addPage();
          y = margin;
        }
      };

      // Helper: render photo gallery (full width)
      const drawPhotoGallery = async (photos) => {
        if (!photos || photos.length === 0) {
          doc.setTextColor(130);
          doc.text("No photos", margin, y + 6);
          doc.setTextColor(0);
          y += 10;
          return;
        }

        const gap = 3;
        const cols = photos.length === 1 ? 1 : 2;

        const cellW = cols === 1 ? contentW : (contentW - gap) / 2;
        const cellH = cellW * 0.7;

        let col = 0;

        const blobToDataUrl = (blob) =>
          new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = reject;
            r.readAsDataURL(blob);
          });

        const getImageSize = (dataUrl) =>
          new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve({ w: img.width, h: img.height });
            img.onerror = reject;
            img.src = dataUrl;
          });

        for (let i = 0; i < photos.length; i++) {
          ensureSpace(cellH + 8);

          const x = margin + col * (cellW + gap);

          const dataUrl = await blobToDataUrl(photos[i]);
          const { w, h } = await getImageSize(dataUrl);

          // ✅ contain scaling
          const scale = Math.min(cellW / w, cellH / h);
          const drawW = w * scale;
          const drawH = h * scale;

          const offsetX = x + (cellW - drawW) / 2;
          const offsetY = y + (cellH - drawH) / 2;

          // optional background frame
          doc.setDrawColor(200);
          doc.setFillColor(245, 245, 245);
          doc.roundedRect(x, y, cellW, cellH, 2, 2, "FD");

          doc.addImage(dataUrl, "JPEG", offsetX, offsetY, drawW, drawH);

          col++;

          if (col >= cols) {
            col = 0;
            y += cellH + gap;
          }
        }

        if (col !== 0) y += cellH + gap;
        y += 6;
      };


      // Loop entries
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];

        const text = (entry.text || "").trim() || "(empty)";
        const lines = doc.splitTextToSize(text, contentW - 6);
        const textH = lines.length * 5;

        // Entry title
        ensureSpace(12);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text(`Entry #${i + 1}`, margin, y);
        y += 7;

        // Text box
        ensureSpace(textH + 14);
        doc.setDrawColor(40);
        doc.setFillColor(245, 245, 245);
        doc.roundedRect(margin, y, contentW, textH + 10, 3, 3, "FD");

        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        doc.text(lines, margin + 3, y + 7);

        y += textH + 14;

        // Photos label
        ensureSpace(10);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text("Photos", margin, y);
        y += 6;

        // Photos gallery
        await drawPhotoGallery(entry.photoBlobs);

        // Divider
        ensureSpace(8);
        doc.setDrawColor(70);
        doc.line(margin, y, margin + contentW, y);
        y += 8;
      }

      doc.save(`sytcore-report-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error(err);
      setGlobalError("PDF generation failed. Check console.");
    }
  };


  return (
    <div className="wrapper">
      <div className="topBar">
        <div className="metaRow">
          <div className="metaField">
            <label>Project</label>
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Project name..."
              className="metaInput"
            />
          </div>

          <div className="metaField">
            <label>Report date</label>
            <input
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              className="metaInput"
            />
          </div>
        </div>

        <h2 className="title">SYTCORE Daily Report</h2>

        <div className="topActions">
          <button className="btnPrimaryGhost" onClick={generatePDF}>
            Generate PDF
          </button>
          <button className="btnDanger" onClick={clearReport}>
            Clear Report
          </button>
        </div>
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
                    disabled={!hasMediaRecorder || entry.transcribing}
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
                  disabled={entry.transcribing}
                >
                  🗑 Reset
                </button>
              </div>

              {entry.audioPreviewUrl && (
                <audio className="audio" controls src={entry.audioPreviewUrl} />
              )}

              <div className="descBlock">
                <p className="sectionTitle">Description</p>

                {entry.transcribing && <p className="mutedSmall">Transcribing...</p>}

                <textarea
                  className="textarea"
                  value={entry.text || ""}
                  onChange={(e) => updateEntry(entry.id, { text: e.target.value })}
                  placeholder="Your description will appear here after transcription… but you can edit it."
                />

                {entry.error && <p className="error">{entry.error}</p>}
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
                disabled={entry.transcribing}
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);

                  if (files.length === 0) return;

                  // metti un piccolo loading visivo
                  updateEntry(entry.id, { uploading: true, error: null });

                  try {
                    // normalizza tutte le immagini
                    const normalizedBlobs = [];
                    const previewUrls = [];

                    for (const file of files) {
                      const normalizedBlob = await normalizeImage(file);
                      normalizedBlobs.push(normalizedBlob);
                      previewUrls.push(URL.createObjectURL(normalizedBlob));

                    }

                    // revoca vecchie preview per evitare memory leak
                    entry.photoPreviewUrls?.forEach((url) => URL.revokeObjectURL(url));

                    updateEntry(entry.id, {
                      photoFiles: files,          // opzionale (puoi anche non salvarle)
                      photoBlobs: normalizedBlobs,
                      photoPreviewUrls: previewUrls,
                      uploading: false,
                    });
                  } catch (err) {
                    console.error(err);
                    updateEntry(entry.id, {
                      uploading: false,
                      error: "Failed to process photos.",
                    });
                  }
                }}

              />

              {entry.photoFiles.length > 0 && (
                <p className="mutedSmall">
                  ✅ {entry.photoFiles.length} photo(s) selected
                </p>
              )}

              {entry.photoPreviewUrls?.length > 0 && (
                <div className="grid">
                  {entry.photoPreviewUrls.map((url, i) => (
                    <div key={url} style={{ position: "relative" }}>
                      <img className="thumb" src={url} alt="photo" />

                      <button
                        onClick={() => {
                          // revoke preview
                          URL.revokeObjectURL(url);

                          updateEntry(entry.id, {
                            photoBlobs: entry.photoBlobs.filter((_, idx) => idx !== i),
                            photoPreviewUrls: entry.photoPreviewUrls.filter((_, idx) => idx !== i),
                          });
                        }}
                        style={{
                          position: "absolute",
                          top: 6,
                          right: 6,
                          width: 26,
                          height: 26,
                          borderRadius: 999,
                          border: "none",
                          cursor: "pointer",
                          background: "rgba(0,0,0,0.7)",
                          color: "white",
                          fontWeight: 900,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

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
