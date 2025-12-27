import { useEffect, useRef, useState } from "react";
import axios from "axios";
import jsPDF from "jspdf";
import "./UploadPanel.css";
import { normalizeImage } from "../../utils/normalizeImage";

import { DndContext, closestCenter } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const RAW_API_URL = import.meta.env.VITE_API_URL || "";
const API_URL = RAW_API_URL.startsWith("http")
  ? RAW_API_URL
  : `https://${RAW_API_URL}`;

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

// ✅ prevent React crash if error is object
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

// ---------- Sortable Photo ----------
function SortablePhoto({ photo, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: photo.id });

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
      <div className="dragHandle" {...attributes} {...listeners}>
        ⠿
      </div>
    </div>
  );
}

export default function UploadPanel() {
  const [entries, setEntries] = useState([createEntry()]);
  const [globalError, setGlobalError] = useState(null);

  const [projectName, setProjectName] = useState("");
  const [reportDate, setReportDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });

  const fileInputRef = useRef({});

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
        photos: [],
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

  // ---------- Transcribe blob ----------
  const transcribeBlob = async (entryId, audioBlob) => {
    updateEntry(entryId, {
      transcribing: true,
      error: null,
    });

    if (!API_URL || API_URL === "https://") {
      updateEntry(entryId, {
        transcribing: false,
        error: "API URL missing or invalid. Check VITE_API_URL on Vercel.",
      });
      return;
    }

    console.log("➡️ TRANSCRIBE URL:", `${API_URL}/api/transcribe-file`);

    try {
      if (!API_URL) {
        throw new Error("VITE_API_URL is missing. Check your .env");
      }

      const formData = new FormData();
      const ext = audioBlob.type?.includes("mp4") ? "m4a" : "webm";
      formData.append("audio", audioBlob, `voice-note.${ext}`);

      const url = `${API_URL}/api/transcribe-file`;
      console.log("🎯 TRANSCRIBE URL:", url);

      const tRes = await axios.post(url, formData, {
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

      // ✅ ALWAYS convert to string (prevents React crash)
      const serverErr = err?.response?.data?.error || err?.response?.data;
      const msg =
        err.code === "ECONNABORTED"
          ? "Transcription timed out. Try again."
          : safeErrorMessage(serverErr || err.message || "Transcription failed.");

      updateEntry(entryId, {
        transcribing: false,
        error: msg,
      });
    }
  };

  // ---------- Add photos ----------
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

  // ---------- Recording ----------
  const getSupportedMimeType = () => {
    const types = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
    return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
  };

  const startRecording = async (entryId) => {
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
          updateEntry(entryId, {
            recording: false,
            error: safeErrorMessage(err),
          });
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

  const stopRecording = (entryId) => {
    try {
      const recorder = mediaRecorderRef.current;
      if (!recorder) return;
      if (recorder.state === "inactive") return;
      recorder.stop();
      updateEntry(entryId, { recording: false });
    } catch (err) {
      updateEntry(entryId, {
        recording: false,
        error: safeErrorMessage(err),
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
      doc.text(`${projectName || "SYTCORE"} Daily Report`, 12, 20);
      doc.text(`Report date: ${reportDate}`, 12, 30);

      let y = 45;
      entries.forEach((e, i) => {
        doc.text(`Entry #${i + 1}`, 12, y);
        y += 6;
        const lines = doc.splitTextToSize(e.text || "(empty)", 180);
        doc.text(lines, 12, y);
        y += lines.length * 5 + 10;
      });

      doc.save(`sytcore-report-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error(err);
      setGlobalError("PDF generation failed.");
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

      {globalError && <p className="error">{globalError}</p>}

      <div className="entries">
        {entries.map((entry, idx) => (
          <div key={entry.id} className="entryCard">
            <div className="leftCol">
              <p className="entryHeader">Entry #{idx + 1}</p>

              <div className="controlsRow">
                {!entry.recording ? (
                  <button
                    className="btn"
                    onClick={() => startRecording(entry.id)}
                    disabled={entry.transcribing}
                    type="button"
                  >
                    🎙 Record
                  </button>
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

                {entry.transcribing && (
                  <p className="mutedSmall">Transcribing...</p>
                )}

                <textarea
                  className="textarea"
                  value={entry.text || ""}
                  onChange={(e) => updateEntry(entry.id, { text: e.target.value })}
                  placeholder="Your description will appear here after transcription… but you can edit it."
                />

                {entry.error && <p className="error">{safeErrorMessage(entry.error)}</p>}
              </div>
            </div>

            <div className="rightCol">
              <p className="sectionTitle">Photos</p>

              <div
                className="dropzone"
                onClick={() => fileInputRef.current[entry.id]?.click()}
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
                <DndContext
                  collisionDetection={closestCenter}
                  onDragEnd={(event) => {
                    const { active, over } = event;
                    if (!over || active.id === over.id) return;

                    updateEntry(entry.id, (prev) => {
                      const oldIndex = prev.photos.findIndex(
                        (p) => p.id === active.id
                      );
                      const newIndex = prev.photos.findIndex(
                        (p) => p.id === over.id
                      );

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
