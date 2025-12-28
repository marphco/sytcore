import jsPDF from "jspdf";

/**
 * Simula la stessa logica del PDF generator (senza immagini)
 * e ritorna quante pagine verranno generate.
 */
export function estimatePagesCount({ entries, logoDataUrl, projectName, reportDate }) {
  const doc = new jsPDF("p", "mm", "a4");

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const marginX = 14;
  const bottomMargin = 16;

  let y = 0;
  let pages = 1;

  const drawHeader = (isFirstPage) => {
    const headerTop = isFirstPage ? 12 : 8;
    const logoBox = isFirstPage ? 24 : 14;

    y = isFirstPage ? headerTop + logoBox + 14 : headerTop + logoBox + 10;
  };

  const ensureSpace = (needed) => {
    if (y + needed > pageH - bottomMargin) {
      pages += 1;
      y = 0;
      drawHeader(false);
    }
  };

  drawHeader(true);

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];

    const isEmpty =
      (!e.text || e.text.trim() === "") &&
      (!e.photos || e.photos.length === 0);

    if (isEmpty) continue;

    const boxW = pageW - marginX * 2;
    const padding = 6;

    // ✅ TESTO: calcoliamo quante righe verranno
    const textLines = doc.splitTextToSize(e.text || "", boxW - padding * 4);
    const textH = Math.max(18, textLines.length * 5 + 10);

    // ✅ FOTO: simuliamo l’altezza (non carichiamo immagini)
    const photos = e.photos?.slice(0, 4) || [];
    const hasPhotos = photos.length > 0;

    const imgH = 55;
    const gridGap = 6;

    const photoRows = photos.length > 2 ? 2 : photos.length > 0 ? 1 : 0;
    const photosH =
      photoRows > 0 ? photoRows * imgH + (photoRows - 1) * gridGap : 0;

    const entryH =
      padding + textH + (hasPhotos ? 10 + 6 + photosH : 0) + padding;

    ensureSpace(entryH + 10);

    y += entryH + 12;
  }

  return pages;
}
