import loadImage from "blueimp-load-image";

/**
 * Normalize image orientation (EXIF-safe) + compress to jpeg.
 * Works reliably on iOS/Android/Chrome and fixes upside-down / sideways photos.
 */
export async function normalizeImage(file) {
  return new Promise((resolve, reject) => {
    loadImage(
      file,
      (canvasOrImg) => {
        try {
          // if something failed, we may get an HTMLImageElement instead of canvas
          if (!(canvasOrImg instanceof HTMLCanvasElement)) {
            return reject(new Error("Failed to create canvas"));
          }

          canvasOrImg.toBlob(
            (blob) => {
              if (!blob) return reject(new Error("Failed to export blob"));
              resolve(blob);
            },
            "image/jpeg",
            0.92
          );
        } catch (err) {
          reject(err);
        }
      },
      {
        canvas: true,
        orientation: true,        // ✅ IMPORTANT: applies EXIF orientation
        maxWidth: 2200,           // optional resize
        maxHeight: 2200,
        cover: false,
      }
    );
  });
}
