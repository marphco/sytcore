import jsPDF from "jspdf";

// ✅ slugify for file naming
function slugify(str) {
    return (str || "")
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
}

// ✅ Compress image before adding to PDF
async function compressImageToDataUrl(fileOrBlob, targetMaxWidth = 1400, quality = 0.72) {
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

// ✅ Draw images inside a box
function drawImageContain(doc, dataUrl, x, y, boxW, boxH) {
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
    const offsetY = y + (boxH - drawH) / 2;

    const format = dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
    doc.addImage(dataUrl, format, offsetX, offsetY, drawW, drawH);
}

// ✅ MAIN EXPORT
export async function generatePdfBlob({ entries, logoDataUrl, projectName, reportDate }) {
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

    const drawHeader = (isFirstPage) => {
        const headerTop = isFirstPage ? 12 : 8;
        const logoBox = isFirstPage ? 24 : 14;

        const titleSize = isFirstPage ? 15 : 11;
        const metaSize = isFirstPage ? 11 : 9;

        if (logoDataUrl) {
            drawImageContain(doc, logoDataUrl, marginX, headerTop, logoBox, logoBox);
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

        doc.text(`Report date: ${reportDate}`, rightX, headerTop + 13, { align: "right" });

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
        const photosH = photoRows > 0 ? photoRows * imgH + (photoRows - 1) * gridGap : 0;

        const entryH =
            padding +
            textH +
            (hasPhotos ? 10 + 6 + photosH : 0) +
            padding;

        ensureSpace(entryH + 10);

        doc.setDrawColor(220);
        doc.roundedRect(boxX, y, boxW, entryH, 4, 4);

        let innerY = y + padding;

        doc.setDrawColor(200);
        doc.roundedRect(boxX + padding, innerY, boxW - padding * 2, textH, 3, 3);

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

                const dataUrl = await compressImageToDataUrl(photo.blob || photo.file, 1400, 0.72);
                drawImageContain(doc, dataUrl, x + 1, imgY + 1, imgW - 2, imgH - 2);
            }
        }

        y += entryH + 12;
    }

    // ✅ Pagination
    const totalPages = doc.getNumberOfPages();

    for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        drawHeader(p === 1);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(140);

        doc.text(`Page ${p} / ${totalPages}`, pageW / 2, pageH - 10, { align: "center" });

        doc.setTextColor(0);
    }

    const safeProject = slugify(projectName || "site");
    const fileName = `${reportDate}__${safeProject}__daily-report.pdf`;

    const blob = doc.output("blob");
    const pagesCount = doc.getNumberOfPages();

    return { blob, fileName, pagesCount };
}
