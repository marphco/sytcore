import { useEffect, useRef, useState } from "react";
import axios from "axios";
import jsPDF from "jspdf";
import "./UploadPanel.css";
import { normalizeImage } from "../../utils/normalizeImage";
import { startWavRecording, stopWavRecording } from "../../utils/wavRecorder";

import { DndContext, closestCenter } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const API_URL = import.meta.env.VITE_API_URL;

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

const isIOS = () =>
  typeof navigator !== "undefined" &&
  /iPad|iPhone|iPod/.test(navigator.userAgent);

const isSafari = () =>
  typeof navigator !== "undefined" &&
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

const useNativeWav = () => isIOS() && isSafari();

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

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);

  const wavRecorderRef = useRef(null);

  const hasMediaRecorder =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

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

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({
          projectName,
          reportDate,
          entries: entries.map((e) => ({
            id: e.id,
            transcript: e.transcript,
            text: e.text,
          })),
        })
      );
    } catch {}
  }, [entries, projectName, reportDate]);

  const updateEntry = (id, patch) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;
        const resolvedPatch = typeof patch === "function" ? patch(e) : patch;
        return { ...e, ...resolvedPatch };
      })
    );
  };

  const transcribeBlob = async (entryId, audioBlob) => {
    updateEntry(entryId, { transcribing: true, error: null });

    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, `voice-note.wav`);

      const tRes = await axios.post(`${API_URL}/api/transcribe-file`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 45000,
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

  const startRecording = async (entryId) => {
    updateEntry(entryId, { error: null });
    setGlobalError(null);

    try {
      // ✅ iOS Safari = WAV recorder
      if (useNativeWav()) {
        wavRecorderRef.current = await startWavRecording();
        updateEntry(entryId, { recording: true });
        return;
      }

      // ✅ Desktop/Android = MediaRecorder
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        const previewUrl = URL.createObjectURL(blob);

        updateEntry(entryId, {
          audioBlob: blob,
          audioPreviewUrl: previewUrl,
          recording: false,
        });

        stream.getTracks().forEach((t) => t.stop());
        await transcribeBlob(entryId, blob);
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

  const stopRecording = async (entryId) => {
    try {
      if (useNativeWav()) {
        const wavBlob = stopWavRecording(wavRecorderRef.current);
        wavRecorderRef.current = null;

        const previewUrl = URL.createObjectURL(wavBlob);
        updateEntry(entryId, {
          audioBlob: wavBlob,
          audioPreviewUrl: previewUrl,
          recording: false,
        });

        await transcribeBlob(entryId, wavBlob);
        return;
      }

      const recorder = mediaRecorderRef.current;
      if (!recorder) return;
      recorder.stop();
      updateEntry(entryId, { recording: false });
    } catch (err) {
      console.error("stopRecording error:", err);
      updateEntry(entryId, {
        recording: false,
        error: "Could not stop recording.",
      });
    }
  };

  return (
    <div className="wrapper">
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
              </div>

              {entry.audioPreviewUrl && (
                <audio className="audio" controls src={entry.audioPreviewUrl} />
              )}

              {entry.transcribing && <p className="mutedSmall">Transcribing...</p>}

              {entry.error && <p className="error">{entry.error}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
