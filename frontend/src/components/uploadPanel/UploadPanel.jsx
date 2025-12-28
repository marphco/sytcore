import { useRef, useState, useMemo } from "react";
import "./UploadPanel.css";

import { Plus, Download, X } from "lucide-react";

import ReportSheet from "./ReportSheet";
import EntryCard from "./EntryCard";
import TopBar from "./TopBar";

import { generatePdfBlob } from "./utils/pdfGenerator";
import { estimatePagesCount } from "./utils/estimatePages";
import { usePersistedReport } from "./hooks/usePersistedReport";
import { useAudioRecorder } from "./hooks/useAudioRecorder";
import { useEntriesActions } from "./hooks/useEntriesActions";


const RAW_API_URL = import.meta.env.VITE_API_URL || "";
const API_URL = RAW_API_URL.startsWith("http") ? RAW_API_URL : `https://${RAW_API_URL}`;

export default function UploadPanel() {
  const [globalError, setGlobalError] = useState(null);
  const [isExporting, setIsExporting] = useState(false);

  const {
    entries,
    setEntries,
    projectName,
    setProjectName,
    reportDate,
    setReportDate,
    logoDataUrl,
    setLogoDataUrl,
    clearReportStorage,
  } = usePersistedReport();

  const fileInputRef = useRef({});
  const logoInputRef = useRef(null);

  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [lastFileName, setLastFileName] = useState(null);

  const pagesCount = useMemo(() => {
    return estimatePagesCount({
      entries,
      logoDataUrl,
      projectName,
      reportDate,
    });
  }, [entries, logoDataUrl, projectName, reportDate]);


  const hasMediaRecorder =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

  const openPdfMobile = () => {
    if (!pdfPreviewUrl) return;
    window.open(pdfPreviewUrl, "_blank", "noopener,noreferrer");
  };


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

  const { startRecording, stopRecording, transcribeBlob } = useAudioRecorder({
    API_URL,
    hasMediaRecorder,
    updateEntry,
    setGlobalError,
    isExporting,
  });

  const {
    addEntry,
    deleteEntry,
    resetEntry,
    addPhotosToEntry,
    removePhotoFromEntry,
    clearReport,
  } = useEntriesActions({
    entries,
    setEntries,
    updateEntry,
    isExporting,
    pdfPreviewUrl,
    setPdfPreviewUrl,
    setLastFileName,
    clearReportStorage,
    setLogoDataUrl,
    setGlobalError,
  });

  const handleLogoUpload = async (file) => {
    if (!file) return;

    try {
      if (file.type === "image/svg+xml") {
        const { Canvg } = await import("canvg");
        const svgText = await file.text();

        const canvas = document.createElement("canvas");
        canvas.width = 800;
        canvas.height = 800;
        const ctx = canvas.getContext("2d");

        const v = await Canvg.fromString(ctx, svgText);
        await v.render();

        setLogoDataUrl(canvas.toDataURL("image/png"));
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

  const generatePDF = async () => {
    if (isExporting) return;
    setGlobalError(null);

    const hasContent = entries.some(
      (e) => (e.text && e.text.trim() !== "") || (e.photos && e.photos.length > 0)
    );

    if (!hasContent) {
      setGlobalError("Nothing to export. Add at least one entry before generating the PDF.");
      return;
    }

    try {
      setIsExporting(true);
      await new Promise((r) => setTimeout(r, 50));

      const { blob, fileName } = await generatePdfBlob({
        entries,
        logoDataUrl,
        projectName,
        reportDate,
      });

      // setPagesCount(pagesCount);


      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);

      const blobUrl = URL.createObjectURL(blob);
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
        <TopBar
          isExporting={isExporting}
          onClearReport={clearReport}
        />

        {globalError && <p className="error">{globalError}</p>}

        <ReportSheet
          projectName={projectName}
          setProjectName={setProjectName}
          reportDate={reportDate}
          setReportDate={setReportDate}
          logoDataUrl={logoDataUrl}
          setLogoDataUrl={setLogoDataUrl}
          entries={entries}
          setEntries={setEntries}
          isExporting={isExporting}
          transcribeBlob={transcribeBlob}
          hasMediaRecorder={hasMediaRecorder}
          pagesCount={pagesCount}
        />


        {/* <div className="entries">
          {entries.map((entry, idx) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              idx={idx}
              isExporting={isExporting}
              fileInputRef={fileInputRef}
              updateEntry={updateEntry}
              addPhotosToEntry={addPhotosToEntry}
              removePhotoFromEntry={removePhotoFromEntry}
              startRecording={startRecording}
              stopRecording={stopRecording}
              resetEntry={resetEntry}
              deleteEntry={deleteEntry}
            />
          ))}
        </div> */}

        {/* <button className="addEntryBtn" onClick={addEntry} disabled={isExporting}>
          <Plus size={18} />
          Add Entry
        </button> */}

        <button className="btnPrimary" onClick={generatePDF} disabled={isExporting} type="button">
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

            {!isMobile() ? (
              <div className="previewFrameWrap">
                <iframe title="PDF preview" src={pdfPreviewUrl} className="previewFrame" />
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "18px 0" }}>
                <button className="btnPrimary" type="button" onClick={openPdfMobile}>
                  Open Preview
                </button>
                <p style={{ fontSize: 12, opacity: 0.65, marginTop: 10 }}>
                  (opens in Safari for zoom & navigation)
                </p>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
