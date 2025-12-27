import { useEffect, useRef, useState } from "react";
import axios from "axios";
import jsPDF from "jspdf";
import "./UploadPanel.css";
import { normalizeImage } from "../../utils/normalizeImage";
import {
  DndContext,
  closestCenter,
} from "@dnd-kit/core";

import {
  arrayMove,
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";

import { CSS } from "@dnd-kit/utilities";


const API_URL = import.meta.env.VITE_API_URL;

// ---------- Helpers ----------
function createEntry() {
  return {
    id: crypto.randomUUID(),

    audioBlob: null,
    audioPreviewUrl: null,

    photos: [],

    transcript: null,
    text: "",

    uploading: false,
    transcribing: false,
    error: null,
    recording: false,
  };
}

const LS_KEY = "sytcore_entries_v1";

function SortablePhoto({ photo, onRemove }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: photo.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    cursor: "grab",
  };

  return (
    <div ref={setNodeRef} style={style} className="thumbWrap">
      <img className="thumb" src={photo.url} alt="photo" />

      <button
        type="button"
        className="thumbRemove"
        onClick={() => onRemove(photo)}
        aria-label="Remove photo"
      >
        ✕
      </button>

      {/* handle */}
      <div className="dragHandle" {...attributes} {...listeners}>
        ⠿
      </div>
    </div>
  );
}

const isIOS = () =>
  typeof navigator !== "undefined" &&
  /iPad|iPhone|iPod/.test(navigator.userAgent);

const isSafari = () =>
  typeof navigator !== "undefined" &&
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

const useNativeRecorder = () => isIOS() && isSafari();


export default function UploadPanel() {
  const [entries, setEntries] = useState([createEntry()]);
  const [globalError, setGlobalError] = useState(null);

  const [projectName, setProjectName] = useState("");
  const [reportDate, setReportDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });

  // ✅ QUESTO VA QUI (TOP LEVEL)
  const fileInputRef = useRef({});
  const audioInputRef = useRef({});


  // MediaRecorder refs
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);

  const hasMediaRecorder =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined" &&
    !useNativeRecorder();

  useEffect(() => {
    const onError = (msg, src, line, col, err) => {
      console.log("🔥 window.onerror:", msg, src, line, col, err);
      alert("JS ERROR: " + msg);
    };

    const onRejection = (event) => {
      console.log("🔥 unhandledrejection:", event.reason);
      alert("PROMISE ERROR: " + (event.reason?.message || event.reason));
    };

    window.onerror = onError;
    window.onunhandledrejection = onRejection;

    return () => {
      window.onerror = null;
      window.onunhandledrejection = null;
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({
          projectName,
          reportDate,
          entries: entries.map(e => ({
            id: e.id,
            transcript: e.transcript,
            text: e.text,
          })),
        }));
      } catch { }
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [entries, projectName, reportDate]);


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
        photos: [],
      }));

      if (restored.length > 0) setEntries(restored);
    } catch (err) {
      console.error("localStorage load error:", err);
    }
    // eslint-disable-next-line
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
  }, [entries, projectName, reportDate]);

  // ---------- Update entry ----------
  const updateEntry = (id, patch) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;

        const resolvedPatch = typeof patch === "function" ? patch(e) : patch;
        const finalPatch = { ...resolvedPatch };

        if (typeof resolvedPatch.text === "function") {
          finalPatch.text = resolvedPatch.text(e.text || "");
        }

        return { ...e, ...finalPatch };
      })
    );
  };

  useEffect(() => {
    const minimal = {
      projectName,
      reportDate,
      entries: entries.map((e) => ({
        id: e.id,
        transcript: e.transcript,
        text: e.text,
      })),
    };

    try {
      localStorage.setItem(LS_KEY, JSON.stringify(minimal));
    } catch (e) {
      console.warn("localStorage write failed", e);
    }
  }, [entries, projectName, reportDate]);


  // ✅ AUTO TRANSCRIBE DIRECTLY FROM BLOB
  const transcribeBlob = async (entryId, audioBlob) => {
    updateEntry(entryId, {
      transcribing: true,
      error: null,
    });

    try {
      const formData = new FormData();

      // ✅ IMPORTANT: send blob directly (Safari safe)
      const ext = audioBlob.type.includes("mp4") ? "m4a" : "webm";
      formData.append("audio", audioBlob, `voice-note.${ext}`);


      const tRes = await axios.post(`${API_URL}/api/transcribe-file`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 45000,
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
        error:
          err.code === "ECONNABORTED"
            ? "Transcription timed out. Try again."
            : err?.response?.data?.error || "Transcription failed.",
      });
    }
  };


  const cleanupRecording = () => {
    try {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.ondataavailable = null;
        mediaRecorderRef.current.onstop = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      chunksRef.current = [];
      mediaRecorderRef.current = null;
    } catch (e) {
      console.warn("cleanupRecording error:", e);
    }
  };

  const getSupportedMimeType = () => {
    const types = [
      "audio/mp4",
      "audio/aac",
      "audio/webm;codecs=opus",
      "audio/webm",
    ];
    return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
  };



  // ---------- Recording ----------
  const startRecording = async (entryId) => {
    setGlobalError(null);
    updateEntry(entryId, { error: null });

    if (!hasMediaRecorder) {
      updateEntry(entryId, { error: "Recording not supported on this device." });
      return;
    }

    // se per qualche motivo c'è un recorder attivo -> cleanup
    if (mediaRecorderRef.current?.state === "recording") {
      updateEntry(entryId, { error: "Already recording. Stop it first." });
      return;
    }

    try {
      // cleanup prima di iniziare
      cleanupRecording();

      localStorage.setItem(LS_KEY, JSON.stringify({
        projectName,
        reportDate,
        entries: entries.map((e) => ({
          id: e.id,
          transcript: e.transcript,
          text: e.text,
        })),
      }));

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Safari a volte vuole un mimeType specifico
      const mimeType = getSupportedMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;

      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data?.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const safeChunks = [...chunksRef.current];

        // ✅ IMPORTANT: Safari fix - delay everything
        setTimeout(() => {
          try {
            const blob = new Blob(safeChunks, {
              type: recorder.mimeType || safeChunks[0]?.type || "audio/mp4",
            });

            if (!blob || blob.size === 0) {
              updateEntry(entryId, {
                recording: false,
                error: "Recording failed (empty audio). Try again.",
              });
              cleanupRecording();
              return;
            }

            const previewUrl = URL.createObjectURL(blob);

            updateEntry(entryId, {
              audioBlob: blob,
              audioPreviewUrl: previewUrl,
              recording: false,
              error: null,
            });

            cleanupRecording();

            // ✅ transcribe outside event loop
            setTimeout(() => {
              transcribeBlob(entryId, blob);
            }, 250);

          } catch (err) {
            console.error("onstop crash:", err);
            updateEntry(entryId, {
              recording: false,
              error: "Recording processing failed. Please retry.",
            });
            cleanupRecording();
          }
        }, 50);
      };


      try {
        recorder.start(250);
        updateEntry(entryId, { recording: true });
      } catch (err) {
        console.error("recorder.start failed:", err);
        updateEntry(entryId, {
          recording: false,
          error: "Recording failed on Safari. Try closing other tabs or use Chrome.",
        });
        cleanupRecording();
      }

    } catch (err) {
      console.error("startRecording error:", err);
      updateEntry(entryId, {
        recording: false,
        error: "Microphone permission denied or recording error.",
      });
      cleanupRecording();
    }
  };


  const stopRecording = (entryId) => {
    try {
      const recorder = mediaRecorderRef.current;
      if (!recorder) return;

      if (recorder.state === "inactive") return; // già stoppato
      recorder.stop();

      updateEntry(entryId, { recording: false });
    } catch (err) {
      console.error("stopRecording error:", err);
      updateEntry(entryId, {
        recording: false,
        error: "Could not stop recording. Please retry.",
      });
      cleanupRecording();
    }
  };


  // ---------- Photos handler ----------
  const addPhotosToEntry = async (entryId, files) => {
    if (!files || files.length === 0) return;

    updateEntry(entryId, { uploading: true, error: null });

    try {
      const newPhotos = [];

      for (const file of files) {
        const normalizedBlob = await normalizeImage(file);
        const url = URL.createObjectURL(normalizedBlob);

        newPhotos.push({
          id: crypto.randomUUID(),
          file,
          blob: normalizedBlob,
          url,
        });
      }

      updateEntry(entryId, (prev) => ({
        photos: [...prev.photos, ...newPhotos],
        uploading: false,
      }));
    } catch (err) {
      console.error(err);
      updateEntry(entryId, {
        uploading: false,
        error: "Failed to process photos.",
      });
    }
  };


  // ---------- Reset Entry ----------
  const resetEntry = (entryId) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;

        if (e.audioPreviewUrl) URL.revokeObjectURL(e.audioPreviewUrl);
        e.photos?.forEach((p) => URL.revokeObjectURL(p.url));

        return { ...createEntry(), id: e.id };
      })
    );
  };

  const addEntry = () => setEntries((prev) => [...prev, createEntry()]);

  const clearReport = () => {
    if (!confirm("Clear all entries?")) return;

    entries.forEach((e) => {
      if (e.audioPreviewUrl) URL.revokeObjectURL(e.audioPreviewUrl);
      e.photos?.forEach((p) => URL.revokeObjectURL(p.url));
    });

    localStorage.removeItem(LS_KEY);
    setEntries([createEntry()]);
  };

  // ---------- PDF ----------
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
      doc.text(
        `Report date: ${reportDate}   •   Generated: ${new Date().toLocaleString()}`,
        margin,
        y
      );
      y += 12;

      const ensureSpace = (neededHeight) => {
        if (y + neededHeight > pageH - margin) {
          doc.addPage();
          y = margin;
        }
      };

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

        for (let i = 0; i < photos.length; i++) {
          ensureSpace(cellH + 8);

          const x = margin + col * (cellW + gap);

          const dataUrl = await blobToDataUrl(photos[i]);
          const { w, h } = await getImageSize(dataUrl);

          const scale = Math.min(cellW / w, cellH / h);
          const drawW = w * scale;
          const drawH = h * scale;

          const offsetX = x + (cellW - drawW) / 2;
          const offsetY = y + (cellH - drawH) / 2;

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

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];

        const text = (entry.text || "").trim() || "(empty)";
        const lines = doc.splitTextToSize(text, contentW - 6);
        const textH = lines.length * 5;

        ensureSpace(12);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text(`Entry #${i + 1}`, margin, y);
        y += 7;

        ensureSpace(textH + 14);
        doc.setDrawColor(40);
        doc.setFillColor(245, 245, 245);
        doc.roundedRect(margin, y, contentW, textH + 10, 3, 3, "FD");

        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        doc.text(lines, margin + 3, y + 7);

        y += textH + 14;

        ensureSpace(10);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text("Photos", margin, y);
        y += 6;

        await drawPhotoGallery(entry.photos.map((p) => p.blob));

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
                  useNativeRecorder() ? (
                    <>
                      <button
                        className="btn"
                        onClick={() => audioInputRef.current[entry.id]?.click()}
                        disabled={entry.transcribing}
                        type="button"
                      >
                        🎙 Record
                      </button>

                      <input
                        ref={(el) => (audioInputRef.current[entry.id] = el)}
                        type="file"
                        accept="audio/mp4,audio/x-m4a,audio/m4a,audio/*"
                        hidden
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;

                          const previewUrl = URL.createObjectURL(file);

                          updateEntry(entry.id, {
                            audioBlob: file,
                            audioPreviewUrl: previewUrl,
                            error: null,
                          });

                          await transcribeBlob(entry.id, file);

                          e.target.value = "";
                        }}
                      />

                    </>
                  ) : (
                    <button
                      className="btn"
                      onClick={() => startRecording(entry.id)}
                      disabled={!hasMediaRecorder || entry.transcribing}
                      type="button"
                    >
                      🎙 Record
                    </button>
                  )
                ) : (
                  <button
                    className="btn"
                    onClick={() => stopRecording(entry.id)}
                    type="button"
                  >
                    ⏹ Stop
                  </button>
                )}

                <button
                  className="btnGhost"
                  onClick={() => resetEntry(entry.id)}
                  disabled={entry.transcribing}
                  type="button"
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

              <div
                className="dropzone"
                onClick={() => fileInputRef.current[entry.id]?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.classList.add("dropzoneActive");
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.classList.remove("dropzoneActive");
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.classList.remove("dropzoneActive");

                  const files = Array.from(e.dataTransfer.files || []).filter((f) =>
                    f.type.startsWith("image/")
                  );
                  await addPhotosToEntry(entry.id, files);
                }}
              >
                <input
                  ref={(el) => (fileInputRef.current[entry.id] = el)}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    await addPhotosToEntry(entry.id, files);
                    e.target.value = "";
                  }}
                />

                <p className="dropzoneText">
                  Drag & drop photos here <span>or click to select</span>
                </p>
              </div>

              {entry.photos?.length > 0 && (
                <p className="mutedSmall">
                  ✅ {entry.photos.length} photo(s) selected
                </p>
              )}


              {entry.photos?.length > 0 && (
                <DndContext
                  collisionDetection={closestCenter}
                  onDragEnd={(event) => {
                    const { active, over } = event;
                    if (!over || active.id === over.id) return;

                    updateEntry(entry.id, (prev) => {
                      const oldIndex = prev.photos.findIndex((p) => p.id === active.id);
                      const newIndex = prev.photos.findIndex((p) => p.id === over.id);

                      return {
                        photos: arrayMove(prev.photos, oldIndex, newIndex),
                      };
                    });
                  }}
                >
                  <SortableContext
                    items={entry.photos.map((p) => p.id)}
                    strategy={rectSortingStrategy}
                  >
                    <div className="grid">
                      {entry.photos.map((photo) => (
                        <SortablePhoto
                          key={photo.id}
                          photo={photo}
                          onRemove={(p) => {
                            URL.revokeObjectURL(p.url);

                            updateEntry(entry.id, (prev) => ({
                              photos: prev.photos.filter((x) => x.id !== p.id),
                            }));
                          }}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
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
