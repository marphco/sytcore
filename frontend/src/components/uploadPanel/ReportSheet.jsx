import { useRef } from "react";
import { Canvg } from "canvg";
import SheetEntry from "./SheetEntry";
import { makeId } from "./utils/id";


async function handleLogoUploadInsideSheet(file, setLogoDataUrl) {
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
    }
}

export default function ReportSheet({
    projectName,
    setProjectName,
    reportDate,
    setReportDate,
    logoDataUrl,
    setLogoDataUrl,
    entries,
    setEntries,
    isExporting,
    transcribeBlob,
    hasMediaRecorder,
    pagesCount
}) {
    const logoInputRef = useRef(null);

    const addSheetEntry = () => {
        if (isExporting) return;

        setEntries((prev) => [
            ...prev,
            {
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
            },
        ]);
    };


    return (
        <div className="sheetWrap">
            <div className="sheetPaper">
                {/* HEADER */}
                <div className="sheetHeader">
                    <div
                        className="sheetLogo"
                        onClick={() => !isExporting && logoInputRef.current?.click()}
                        style={{ cursor: isExporting ? "not-allowed" : "pointer" }}
                    >
                        {logoDataUrl ? (
                            <img src={logoDataUrl} alt="logo" />
                        ) : (
                            <div className="sheetLogoPlaceholder">Logo</div>
                        )}
                    </div>

                    <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
                        hidden
                        disabled={isExporting}
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            handleLogoUploadInsideSheet(file, setLogoDataUrl);
                            e.target.value = "";
                        }}
                    />

                    <div className="sheetTitle">
                        <h3>Daily Report</h3>
                    </div>

                    <div className="sheetMeta">
                        <input
                            className="sheetMetaInput"
                            value={projectName}
                            disabled={isExporting}
                            onChange={(e) => setProjectName(e.target.value)}
                            placeholder="Project name"
                        />

                        <input
                            className="sheetMetaInput"
                            type="date"
                            value={reportDate}
                            disabled={isExporting}
                            onChange={(e) => setReportDate(e.target.value)}
                        />
                    </div>
                </div>

                {/* BODY */}
                <div className="sheetBody">
                    {entries.map((entry, idx) => (
                        <SheetEntry
                            key={entry.id}
                            entry={entry}
                            index={idx}
                            setEntries={setEntries}
                            isExporting={isExporting}
                            transcribeBlob={transcribeBlob}
                            hasMediaRecorder={hasMediaRecorder}
                            entriesCount={entries.length}
                        />
                    ))}

                    <button
                        type="button"
                        className="sheetAddEntryBtn"
                        disabled={isExporting}
                        onClick={addSheetEntry}
                    >
                        + Add Entry
                    </button>
                </div>


                <div className="sheetFooter">
                    <span className="sheetFooterText">Pages: {pagesCount}</span>
                </div>
            </div>
        </div>
    );
}
