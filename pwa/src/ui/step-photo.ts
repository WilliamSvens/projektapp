import { markDirty, type Photo } from '../db/db';
import { currentPosition, fileToJpeg } from '../lib/photo';
import { el, newId, nowIso } from '../lib/util';
import type { Ctx } from './context';
import type { Step } from '../db/db';

/**
 * Photos are captured on the device, downscaled to JPEG, and stored as a blob keyed by the
 * same id as the row — which is what lets a killed upload resume as one object (§9).
 */
export async function attachPhoto(input: {
  ctx: Ctx;
  step: Step;
  container: HTMLElement;
  anchor: HTMLElement;
}): Promise<void> {
  const { ctx, step, container, anchor } = input;

  async function paintThumbs(): Promise<void> {
    container.replaceChildren();
    const photos = (
      await ctx.database.photos.where('step_id').equals(step.id).toArray()
    ).filter((photo) => !photo.deleted_at);

    for (const photo of photos) {
      const stored = await ctx.database.blobs.get(photo.id);
      const frame = el('figure', 'h-16 w-16 overflow-hidden rounded-lg bg-slate-100');
      if (stored) {
        const image = el('img', 'h-full w-full object-cover');
        image.src = URL.createObjectURL(stored.blob);
        image.alt = photo.caption ?? 'Foto';
        frame.append(image);
      } else {
        frame.append(el('span', 'block p-1 text-[10px] leading-tight text-slate-500', 'Foto'));
      }
      container.append(frame);
    }
  }

  const label = el(
    'label',
    'inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700',
    'Foto',
  );
  const fileInput = el('input', 'hidden');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.setAttribute('capture', 'environment');
  label.append(fileInput);
  anchor.append(label);

  fileInput.addEventListener('change', () => {
    void (async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      fileInput.disabled = true;
      try {
        const { blob, width, height } = await fileToJpeg(file);
        const fix = await currentPosition();
        const stamp = nowIso();
        const photo: Photo = {
          id: newId(),
          project_id: step.project_id,
          apartment_id: step.apartment_id,
          step_id: step.id,
          storage_path: null,
          caption: null,
          taken_at: stamp,
          captured_lat: fix?.lat ?? null,
          captured_lng: fix?.lng ?? null,
          gps_accuracy_m: fix?.accuracy ?? null,
          width,
          height,
          bytes: blob.size,
          created_at: stamp,
          deleted_at: null,
        };

        await ctx.database.transaction(
          'rw',
          ctx.database.photos,
          ctx.database.blobs,
          ctx.database.dirty,
          async () => {
            await ctx.database.photos.put(photo);
            await ctx.database.blobs.put({ id: photo.id, blob });
            await markDirty(ctx.database, 'photos', photo.id, photo.project_id);
          },
        );

        await paintThumbs();
        await ctx.refreshHeader();
      } catch (error) {
        anchor.append(
          el(
            'p',
            'w-full text-xs text-amber-700',
            error instanceof Error ? error.message : 'Fotot kunde inte sparas.',
          ),
        );
      } finally {
        fileInput.disabled = false;
        fileInput.value = '';
      }
    })();
  });

  await paintThumbs();
}
