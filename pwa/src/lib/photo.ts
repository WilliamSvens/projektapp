// §6: draw to canvas, longest side 2000 px, JPEG q0.85, blob into IndexedDB.
// A HEIC file the browser cannot decode is refused with a sentence rather than stored
// unrenderable — that was a real bug in the Streamlit app (SPEC.md §11.1).

type Loaded = { image: HTMLImageElement; url: string; width: number; height: number };

function loadImage(file: File): Promise<Loaded> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () =>
      resolve({ image, url, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Filen kunde inte läsas. Fotografera i stället för att välja en HEIC-bild.'));
    };
    image.src = url;
  });
}

export async function fileToJpeg(
  file: File,
  maxSide = 2000,
  quality = 0.85,
): Promise<{ blob: Blob; width: number; height: number }> {
  const loaded = await loadImage(file);
  const scale = Math.min(1, maxSide / Math.max(loaded.width, loaded.height));
  const width = Math.round(loaded.width * scale);
  const height = Math.round(loaded.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Kunde inte bearbeta bilden.');
  context.drawImage(loaded.image, 0, 0, width, height);
  URL.revokeObjectURL(loaded.url);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  );
  if (!blob) throw new Error('Kunde inte skapa JPEG.');
  return { blob, width, height };
}

export type Fix = { lat: number; lng: number; accuracy: number };

/** Best effort: a photo without a position is still a useful photo. */
export async function currentPosition(timeoutMs = 3000): Promise<Fix | null> {
  if (!('geolocation' in navigator)) return null;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), timeoutMs + 250);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.clearTimeout(timer);
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
