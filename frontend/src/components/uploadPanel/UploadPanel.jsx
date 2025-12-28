import { useEffect, useRef, useState } from "react";
import axios from "axios";
import jsPDF from "jspdf";
import "./UploadPanel.css";
import { normalizeImage } from "../../utils/normalizeImage";
import { Canvg } from "canvg";

import { DndContext, closestCenter } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ✅ ICONS (premium)
import {
  Mic,
  Square,
  RotateCcw,
  Trash2,
  Plus,
  Download,
  X,
  ImagePlus,
  Eraser,
} from "lucide-react";

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

// ✅ slugify for file naming (project/site)
function slugify(str) {
  return (str || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

// ✅ Compress image before adding to PDF
async function compressImageToDataUrl(
  fileOrBlob,
  targetMaxWidth = 1400,
  quality = 0.72
) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(fileOrBlob);
  });

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ratio = img.width / img.height;

      let newW = img.width;
      let newH = img.height;

      if (img.width > targetMaxWidth) {
        newW = targetMaxWidth;
        newH = Math.round(targetMaxWidth / ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = newW;
      canvas.height = newH;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, newW, newH);

      const compressed = canvas.toDataURL("image/jpeg", quality);
      resolve(compressed);
    };

    img.src = dataUrl;
  });
}

// ---------- Sortable Photo ----------
function SortablePhoto({ photo, onRemove, disabled }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: photo.id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    cursor: disabled ? "not-allowed" : "grab",
  };

  return (
    <div ref={setNodeRef} style={style} className="thumbWrap">
      <img className="thumb" src={photo.url} alt="photo" />

      <button
        type="button"
        className="thumbRemove"
        onClick={() => onRemove(photo)}
        aria-label="Remove photo"
        disabled={disabled}
      >
        <X size={16} />
      </button>

      <div
        className="dragHandle"
        {...attributes}
        {...listeners}
        style={{ opacity: disabled ? 0.5 : 1 }}
      >
        ⠿
      </div>
    </div>
  );
}

export default function UploadPanel() {
  const [entries, setEntries] = useState([createEntry()]);
  const [globalError, setGlobalError] = useState(null);

  const [isExporting, setIsExporting] = useState(false);

  const [projectName, setProjectName] = useState("");
  const [reportDate, setReportDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });

  const [logoDataUrl, setLogoDataUrl] = useState(null);

  const fileInputRef = useRef({});
  const logoInputRef = useRef(null);

  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [lastFileName, setLastFileName] = useState(null);

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

      if (saved.logoDataUrl) setLogoDataUrl(saved.logoDataUrl);

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
        logoDataUrl,
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
  }, [entries, projectName, reportDate, logoDataUrl]);

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

  const deleteEntry = (entryId) => {
    if (isExporting) return;
    if (!confirm("Delete this entry?")) return;

    setEntries((prev) => {
      const target = prev.find((e) => e.id === entryId);

      if (target?.audioPreviewUrl) URL.revokeObjectURL(target.audioPreviewUrl);
      target?.photos?.forEach((p) => URL.revokeObjectURL(p.url));

      const filtered = prev.filter((e) => e.id !== entryId);
      return filtered.length > 0 ? filtered : [createEntry()];
    });
  };

  // ---------- LOGO UPLOAD ----------
  const handleLogoUpload = async (file) => {
    if (!file) return;

    try {
      if (file.type === "image/svg+xml") {
        const svgText = await file.text();
        const canvas = document.createElement("canvas");
        canvas.width = 800;
        canvas.height = 800;
        const ctx = canvas.getContext("2d");

        const v = await Canvg.fromString(ctx, svgText);
        await v.render();

        const pngDataUrl = canvas.toDataURL("image/png");
        setLogoDataUrl(pngDataUrl);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => setLogoDataUrl(reader.result);
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      setGlobalError("Logo upload failed.");
    }
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

      updateEntry(entryId, {
        transcribing: false,
        error: msg,
      });
    }
  };

  // ---------- Add photos ----------
  const addPhotosToEntry = async (entryId, files) => {
    if (isExporting) return;
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

  const resetEntry = (entryId) => {
    if (isExporting) return;

    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        if (e.audioPreviewUrl) URL.revokeObjectURL(e.audioPreviewUrl);
        e.photos?.forEach((p) => URL.revokeObjectURL(p.url));
        return { ...createEntry(), id: e.id };
      })
    );
  };

  const addEntry = () => {
    if (isExporting) return;
    setEntries((prev) => [...prev, createEntry()]);
  };

  const clearReport = () => {
    if (isExporting) return;
    if (!confirm("Clear all entries?")) return;

    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    setPdfPreviewUrl(null);
    setLastFileName(null);

    entries.forEach((e) => {
      if (e.audioPreviewUrl) URL.revokeObjectURL(e.audioPreviewUrl);
      e.photos?.forEach((p) => URL.revokeObjectURL(p.url));
    });

    localStorage.removeItem(LS_KEY);
    setEntries([createEntry()]);
    setLogoDataUrl(null);
    setGlobalError(null);
  };

  // ---------- PDF ----------
  const generatePDF = async () => {
    if (isExporting) return;

    setGlobalError(null);

    const hasContent = entries.some(
      (e) =>
        (e.text && e.text.trim() !== "") || (e.photos && e.photos.length > 0)
    );

    if (!hasContent) {
      setGlobalError(
        "Nothing to export. Add at least one entry before generating the PDF."
      );
      return;
    }

    try {
      setIsExporting(true);
      await new Promise((r) => setTimeout(r, 50));

      const doc = new jsPDF("p", "mm", "a4");
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();

      const marginX = 14;
      const bottomMargin = 16;
      let y = 0;

      const ensureSpace = (needed) => {
        if (y + needed > pageH - bottomMargin) {
          doc.addPage();
          drawHeader(false);
        }
      };

      const drawImageContain = (dataUrl, x, yPos, boxW, boxH) => {
        const props = doc.getImageProperties(dataUrl);
        const imgW = props.width;
        const imgH = props.height;

        const imgRatio = imgW / imgH;
        const boxRatio = boxW / boxH;

        let drawW, drawH;

        if (imgRatio > boxRatio) {
          drawW = boxW;
          drawH = boxW / imgRatio;
        } else {
          drawH = boxH;
          drawW = boxH * imgRatio;
        }

        const offsetX = x + (boxW - drawW) / 2;
        const offsetY = yPos + (boxH - drawH) / 2;

        const format = dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
        doc.addImage(dataUrl, format, offsetX, offsetY, drawW, drawH);
      };

      const drawHeader = (isFirstPage) => {
        const headerTop = isFirstPage ? 12 : 8;
        const logoBox = isFirstPage ? 24 : 14;

        const titleSize = isFirstPage ? 15 : 11;
        const metaSize = isFirstPage ? 11 : 9;

        if (logoDataUrl) {
          drawImageContain(logoDataUrl, marginX, headerTop, logoBox, logoBox);
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(titleSize);

        const titleY = headerTop + (isFirstPage ? 11 : 9);
        doc.text("Daily Report", pageW / 2, titleY, { align: "center" });

        doc.setFont("helvetica", "normal");
        doc.setFontSize(metaSize);
        doc.setTextColor(80);

        const rightX = pageW - marginX;

        if (projectName && projectName.trim()) {
          doc.text(projectName, rightX, headerTop + 7, { align: "right" });
        }

        doc.text(`Report date: ${reportDate}`, rightX, headerTop + 13, {
          align: "right",
        });

        doc.setTextColor(0);

        y = isFirstPage ? headerTop + logoBox + 14 : headerTop + logoBox + 10;
      };

      drawHeader(true);

      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];

        const isEmpty =
          (!e.text || e.text.trim() === "") &&
          (!e.photos || e.photos.length === 0);

        if (isEmpty) continue;

        const boxX = marginX;
        const boxW = pageW - marginX * 2;
        const padding = 6;

        const textLines = doc.splitTextToSize(e.text || "", boxW - padding * 4);
        const textH = Math.max(18, textLines.length * 5 + 10);

        const photos = e.photos?.slice(0, 4) || [];
        const hasPhotos = photos.length > 0;

        const gridGap = 6;
        const gridW = boxW - padding * 2;

        const imgW = (gridW - gridGap) / 2;
        const imgH = 55;

        const photoRows = photos.length > 2 ? 2 : photos.length > 0 ? 1 : 0;
        const photosH =
          photoRows > 0
            ? photoRows * imgH + (photoRows - 1) * gridGap
            : 0;

        const entryH =
          padding + textH + (hasPhotos ? 10 + 6 + photosH : 0) + padding;

        ensureSpace(entryH + 10);

        doc.setDrawColor(220);
        doc.roundedRect(boxX, y, boxW, entryH, 4, 4);

        let innerY = y + padding;

        doc.setDrawColor(200);
        doc.roundedRect(
          boxX + padding,
          innerY,
          boxW - padding * 2,
          textH,
          3,
          3
        );

        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        doc.text(textLines, boxX + padding * 2, innerY + 7);

        innerY += textH + 10;

        if (hasPhotos) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.text("Photos", boxX + padding, innerY);
          innerY += 6;

          for (let p = 0; p < photos.length; p++) {
            const photo = photos[p];
            const col = p % 2;
            const row = Math.floor(p / 2);

            const x = boxX + padding + col * (imgW + gridGap);
            const imgY = innerY + row * (imgH + gridGap);

            doc.setDrawColor(220);
            doc.roundedRect(x, imgY, imgW, imgH, 3, 3);

            const dataUrl = await compressImageToDataUrl(
              photo.blob || photo.file,
              1400,
              0.72
            );

            drawImageContain(dataUrl, x + 1, imgY + 1, imgW - 2, imgH - 2);
          }
        }

        y += entryH + 12;
      }

      const totalPages = doc.getNumberOfPages();

      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        drawHeader(p === 1);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(140);

        doc.text(`Page ${p} / ${totalPages}`, pageW / 2, pageH - 10, {
          align: "center",
        });

        doc.setTextColor(0);
      }

      const safeProject = slugify(projectName || "site");
      const fileName = `${reportDate}__${safeProject}__daily-report.pdf`;

      const pdfBlob = doc.output("blob");
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);

      const blobUrl = URL.createObjectURL(pdfBlob);

      setPdfPreviewUrl(blobUrl);
      setLastFileName(fileName);
    } catch (err) {
      console.error(err);
      setGlobalError("PDF generation failed. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="wrapper">
      <div className="shell">
      <div className="topBar">
        {/* LEFT */}
        <div className="topLeft">
          <div className="metaRow">
            <div className="metaField">
              <label>Project</label>
              <input
                value={projectName}
                disabled={isExporting}
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
                disabled={isExporting}
                onChange={(e) => setReportDate(e.target.value)}
                className="metaInput"
              />
            </div>
          </div>

          <button
            className="btnGhost"
            type="button"
            disabled={isExporting}
            onClick={() => logoInputRef.current?.click()}
          >
            <ImagePlus size={16} />
            {logoDataUrl ? "Change Logo" : "Add Logo"}
          </button>

          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              handleLogoUpload(file);
              e.target.value = "";
            }}
          />
        </div>

        {/* CENTER */}
        <h2 className="title">SYTCORE Daily Report</h2>

        {/* RIGHT */}
        <div className="topRight">
          <button
            className="btnDanger"
            onClick={clearReport}
            disabled={isExporting}
            type="button"
          >
            <Eraser size={16} />
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
                    disabled={entry.transcribing || isExporting}
                    onClick={() => startRecording(entry.id)}
                    type="button"
                  >
                    <Mic size={16} />
                    Record
                  </button>
                ) : (
                  <button
                    className="btn"
                    disabled={isExporting}
                    onClick={stopRecording}
                    type="button"
                  >
                    <Square size={16} />
                    Stop
                  </button>
                )}

                <button
                  className="btnGhost"
                  disabled={entry.transcribing || isExporting}
                  onClick={() => resetEntry(entry.id)}
                  type="button"
                >
                  <RotateCcw size={16} />
                  Reset
                </button>

                <button
                  className="btnDanger"
                  disabled={entry.transcribing || isExporting}
                  onClick={() => deleteEntry(entry.id)}
                  type="button"
                >
                  <Trash2 size={16} />
                  Delete
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
                  disabled={isExporting}
                  value={entry.text || ""}
                  onChange={(e) =>
                    updateEntry(entry.id, { text: e.target.value })
                  }
                  placeholder="Your description will appear here after transcription… but you can edit it."
                />

                {entry.error && (
                  <p className="error">{safeErrorMessage(entry.error)}</p>
                )}
              </div>
            </div>

            <div className="rightCol">
              <p className="sectionTitle">Photos</p>

              <div
                className="dropzone"
                onClick={() =>
                  !isExporting && fileInputRef.current[entry.id]?.click()
                }
                style={{ opacity: isExporting ? 0.6 : 1 }}
              >
                <input
                  ref={(el) => (fileInputRef.current[entry.id] = el)}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  disabled={isExporting}
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
                    if (isExporting) return;
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
                          disabled={isExporting}
                          onRemove={(p) => {
                            if (isExporting) return;
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

      <button
        className="addEntryBtn"
        onClick={addEntry}
        disabled={isExporting}
      >
        <Plus size={18} />
        Add Entry
      </button>

      <button
        className="btnPrimary"
        onClick={generatePDF}
        disabled={isExporting}
        type="button"
      >
        {isExporting ? (
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="spinner" />
            Generating…
          </span>
        ) : (
          <>
            <Download size={18} />
            Generate PDF
          </>
        )}
      </button>

      {pdfPreviewUrl && (
        <div className="previewBox">
          <div className="previewTop">
            <p className="previewTitle">Preview Ready</p>

            <div className="previewActions">
              <button
                className="btnPrimary"
                type="button"
                onClick={() => {
                  const link = document.createElement("a");
                  link.href = pdfPreviewUrl;
                  link.download = lastFileName || "daily-report.pdf";
                  link.click();
                }}
              >
                <Download size={18} />
                Download
              </button>

              <button
                className="btnDanger"
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(pdfPreviewUrl);
                  setPdfPreviewUrl(null);
                  setLastFileName(null);
                }}
              >
                <X size={18} />
                Close
              </button>
            </div>
          </div>

          <div className="previewFrameWrap">
            <iframe
              title="PDF preview"
              src={pdfPreviewUrl}
              className="previewFrame"
            />
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
