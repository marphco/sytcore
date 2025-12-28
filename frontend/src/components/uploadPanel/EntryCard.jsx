import { DndContext, closestCenter } from "@dnd-kit/core";
import { arrayMove, SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { Mic, Square, RotateCcw, Trash2 } from "lucide-react";

import SortablePhoto from "./SortablePhoto";

export default function EntryCard({
  entry,
  idx,
  isExporting,
  fileInputRef,
  updateEntry,
  addPhotosToEntry,
  removePhotoFromEntry,
  startRecording,
  stopRecording,
  resetEntry,
  deleteEntry,
}) {
  return (
    <div className="entryCard">
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
            <button className="btn" disabled={isExporting} onClick={stopRecording} type="button">
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

        {entry.audioPreviewUrl && <audio className="audio" controls src={entry.audioPreviewUrl} />}

        <div className="descBlock">
          <p className="sectionTitle">Description</p>

          {entry.transcribing && <p className="mutedSmall">Transcribing...</p>}

          <textarea
            className="textarea"
            disabled={isExporting}
            value={entry.text || ""}
            onChange={(e) => updateEntry(entry.id, { text: e.target.value })}
            placeholder="Your description will appear here after transcription… but you can edit it."
          />

          {entry.error && <p className="error">{entry.error}</p>}
        </div>
      </div>

      <div className="rightCol">
        <p className="sectionTitle">Photos</p>

        <div
          className="dropzone"
          onClick={() => !isExporting && fileInputRef.current[entry.id]?.click()}
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
                const oldIndex = prev.photos.findIndex((p) => p.id === active.id);
                const newIndex = prev.photos.findIndex((p) => p.id === over.id);

                return {
                  photos: arrayMove(prev.photos, oldIndex, newIndex),
                };
              });
            }}
          >
            <SortableContext items={entry.photos.map((p) => p.id)} strategy={rectSortingStrategy}>
              <div className="grid">
                {entry.photos.map((photo) => (
                  <SortablePhoto
                    key={photo.id}
                    photo={photo}
                    disabled={isExporting}
                    onRemove={(p) => removePhotoFromEntry(entry.id, p)}
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
