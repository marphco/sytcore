import { useRef, useState } from "react";
import { normalizeImage } from "../../utils/normalizeImage";
import { Mic, Square, Trash2, ImagePlus, X } from "lucide-react";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { arrayMove, SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import SortableSheetPhoto from "./SortableSheetPhoto";
import { makeId } from "./utils/id";

let scrollY = 0;

function lockBodyScroll() {
    scrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
}

function unlockBodyScroll() {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    window.scrollTo(0, scrollY);
}



export default function SheetEntry({
    entry,
    index,
    entriesCount,
    setEntries,
    isExporting,
    transcribeBlob,
    hasMediaRecorder,
}) {
    const fileRef = useRef(null);
    const [isRecording, setIsRecording] = useState(false);

    const recorderRef = useRef(null);
    const streamRef = useRef(null);
    const chunksRef = useRef([]);

    const getSupportedMimeType = () => {
        if (typeof MediaRecorder === "undefined") return "";
        const types = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
        return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
    };

    const updateEntry = (patch) => {
        setEntries((prev) =>
            prev.map((e) => (e.id === entry.id ? { ...e, ...patch } : e))
        );
    };

    const removeEntry = () => {
        if (isExporting) return;

        // ✅ blocco se è l'unica entry
        if (entriesCount === 1) return;

        if (!confirm("Delete this entry?")) return;
        setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    };


    const startSheetRecording = async () => {
        if (isExporting) return;
        if (!hasMediaRecorder) {
            alert("Recording not supported on this device.");
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            const mimeType = getSupportedMimeType();
            const recorder = mimeType
                ? new MediaRecorder(stream, { mimeType })
                : new MediaRecorder(stream);

            recorderRef.current = recorder;
            chunksRef.current = [];

            recorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
            };

            recorder.onstop = async () => {
                try {
                    const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
                    if (!blob || blob.size === 0) return;

                    stream.getTracks().forEach((t) => t.stop());

                    await transcribeBlob(entry.id, blob);
                } catch (err) {
                    console.error(err);
                }
            };

            recorder.start();
            setIsRecording(true);
        } catch (err) {
            console.error(err);
            alert("Microphone permission denied or recording failed.");
        }
    };

    const stopSheetRecording = () => {
        try {
            const recorder = recorderRef.current;
            if (!recorder) return;
            if (recorder.state === "inactive") return;
            recorder.stop();
            setIsRecording(false);
        } catch (err) {
            console.error(err);
        }
    };

    const handleAddPhotos = async (files) => {
        if (isExporting) return;
        if (!files || files.length === 0) return;

        const newPhotos = [];

        for (const file of files) {
            const normalizedBlob = await normalizeImage(file);
            const url = URL.createObjectURL(normalizedBlob);

            newPhotos.push({
                id: makeId(),
                file,
                blob: normalizedBlob,
                url,
            });
        }

        updateEntry({ photos: [...(entry.photos || []), ...newPhotos] });
    };

    const removePhoto = (photoId) => {
        if (isExporting) return;

        updateEntry({
            photos: entry.photos.filter((p) => {
                if (p.id === photoId) URL.revokeObjectURL(p.url);
                return p.id !== photoId;
            }),
        });
    };

    return (
        <div className="sheetEntry">
            <div className="sheetEntryTop">
                <p className="sheetEntryTitle">Entry {index + 1}</p>

                {entriesCount > 1 && (
                    <button
                        className="sheetEntryDelete"
                        type="button"
                        disabled={isExporting}
                        onClick={removeEntry}
                        title="Delete entry"
                    >
                        <Trash2 size={16} />
                    </button>
                )}


            </div>

            {/* TEXT */}
            <div className="sheetTextBox">
                <div className="sheetTextTop">
                    <button
                        className={`sheetMicBtn ${isRecording ? "isRecording" : ""}`}
                        type="button"
                        disabled={isExporting}
                        onClick={isRecording ? stopSheetRecording : startSheetRecording}
                        title={isRecording ? "Stop recording" : "Record (dictate)"}
                    >
                        {isRecording ? <Square size={16} /> : <Mic size={16} />}
                    </button>

                    <p className="sheetHintMuted">
                        Dictate or type · audio appends
                    </p>
                </div>

                <textarea
                    className="sheetTextarea"
                    value={entry.text || ""}
                    disabled={isExporting}
                    placeholder="Write your report here…"
                    onChange={(e) => updateEntry({ text: e.target.value })}
                />
            </div>

            {/* PHOTOS */}
            <div className="sheetPhotos">
                <div
                    className="sheetDropzone"
                    onClick={() => !isExporting && fileRef.current?.click()}
                    style={{ opacity: isExporting ? 0.65 : 1 }}
                >
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        disabled={isExporting}
                        onChange={(e) => {
                            const files = Array.from(e.target.files || []);
                            handleAddPhotos(files);
                            e.target.value = "";
                        }}
                    />
                    <span>Add photos</span>
                </div>

                {entry.photos?.length > 0 && (
                    <DndContext
                        collisionDetection={closestCenter}
                        onDragStart={() => {
                            if (isExporting) return;
                            lockBodyScroll();
                        }}
                        onDragCancel={() => {
                            unlockBodyScroll();
                        }}
                        onDragEnd={(event) => {
                            unlockBodyScroll();
                            if (isExporting) return;

                            const { active, over } = event;
                            if (!over || active.id === over.id) return;

                            setEntries((prev) =>
                                prev.map((e) => {
                                    if (e.id !== entry.id) return e;

                                    const oldIndex = e.photos.findIndex((p) => p.id === active.id);
                                    const newIndex = e.photos.findIndex((p) => p.id === over.id);

                                    return {
                                        ...e,
                                        photos: arrayMove(e.photos, oldIndex, newIndex),
                                    };
                                })
                            );
                        }}
                    >

                        <SortableContext items={entry.photos.map((p) => p.id)} strategy={rectSortingStrategy}>
                            <div className="sheetPhotoGrid">
                                {entry.photos.slice(0, 4).map((p) => (
                                    <SortableSheetPhoto
                                        key={p.id}
                                        photo={p}
                                        disabled={isExporting}
                                        onRemove={(photo) => removePhoto(photo.id)}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                )}
            </div>

        </div>
    );
}
