import { useEffect, useState } from "react";
import { makeId } from "../utils/id";

const LS_KEY = "sytcore_entries_v1";

// ---------- Helpers ----------
export function createEntry() {
  return {
    id: makeId(),
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

export function usePersistedReport() {
  const [entries, setEntries] = useState([createEntry()]);
  const [projectName, setProjectName] = useState("");
  const [logoDataUrl, setLogoDataUrl] = useState(null);

  const [reportDate, setReportDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });

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
        id: e.id || uuid(),
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

  const clearReportStorage = () => {
    localStorage.removeItem(LS_KEY);
  };

  return {
    entries,
    setEntries,
    projectName,
    setProjectName,
    reportDate,
    setReportDate,
    logoDataUrl,
    setLogoDataUrl,
    clearReportStorage,
  };
}
