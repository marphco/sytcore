import { normalizeImage } from "../../../utils/normalizeImage";
import { createEntry } from "./usePersistedReport";
import { makeId } from "../utils/id";

/**
 * Tutte le azioni su entries (CRUD + photos)
 * - altamente riutilizzabile
 * - UploadPanel diventa skinny
 */
export function useEntriesActions({
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
}) {
  // ---------- Add entry ----------
  const addEntry = () => {
    if (isExporting) return;
    setEntries((prev) => [...prev, createEntry()]);
  };

  // ---------- Delete entry ----------
  const deleteEntry = (entryId) => {
  if (isExporting) return;
  if (entries.length === 1) return; // ✅ blocco

  if (!confirm("Delete this entry?")) return;

    setEntries((prev) => {
      const target = prev.find((e) => e.id === entryId);

      if (target?.audioPreviewUrl) URL.revokeObjectURL(target.audioPreviewUrl);
      target?.photos?.forEach((p) => URL.revokeObjectURL(p.url));

      const filtered = prev.filter((e) => e.id !== entryId);
      return filtered.length > 0 ? filtered : [createEntry()];
    });
  };

  // ---------- Reset entry ----------
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
          id: makeId(),
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

  // ---------- Remove single photo ----------
  const removePhotoFromEntry = (entryId, photo) => {
    if (isExporting) return;

    URL.revokeObjectURL(photo.url);

    updateEntry(entryId, (prev) => ({
      photos: prev.photos.filter((p) => p.id !== photo.id),
    }));
  };

  // ---------- Clear entire report ----------
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

    clearReportStorage();
    setEntries([createEntry()]);
    setLogoDataUrl(null);
    setGlobalError(null);
  };

  return {
    addEntry,
    deleteEntry,
    resetEntry,
    addPhotosToEntry,
    removePhotoFromEntry,
    clearReport,
  };
}
