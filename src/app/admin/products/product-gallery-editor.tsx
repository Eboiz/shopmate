"use client";

import Image from "next/image";
import { useActionState, useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { Icon } from "@/components/ui/icon";
import { addImage, MAX_PRODUCT_IMAGES, moveImage, PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_MAX_SIDE, removeImage } from "@/lib/shop/gallery";
import { PRODUCT_IMAGES_BUCKET } from "@/lib/shop/media-validation";
import { ACCEPT_ATTRIBUTE, shrinkAndUpload, uploadErrorMessage } from "@/lib/shop/upload-image";
import { INITIAL_FORM_STATE, type FormAction } from "./form-state";

type GalleryProduct = { id: string; name: string; images: string[] };

type Props = {
  product: GalleryProduct;
  shopId: string;
  canEdit: boolean;
  saveProductImages: FormAction;
};

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((url, i) => url === b[i]);

// PB-32: a product's photos in the product editor. The first photo is the card
// photo on the shop page and in chat. Staff see the photos; only the owner adds,
// removes and reorders them, and RLS refuses anyone else's save.
export function ProductGallery({ product, shopId, canEdit, saveProductImages }: Props) {
  if (!canEdit) {
    return (
      <section aria-label={`Ảnh của ${product.name}`} className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-[#474640]">Ảnh sản phẩm</h3>
        {product.images.length === 0 ? (
          <p className="text-sm text-[#706d67]">Sản phẩm này chưa có ảnh.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {product.images.map((url, index) => (
              <li key={url} className="relative size-20 overflow-hidden rounded-lg bg-[#efebe4]">
                <Image src={url} alt={`${product.name} – ảnh ${index + 1}`} fill sizes="80px" className="object-cover" />
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }
  return <GalleryEditor product={product} shopId={shopId} saveProductImages={saveProductImages} />;
}

function GalleryEditor({ product, shopId, saveProductImages }: Omit<Props, "canEdit">) {
  const [state, formAction, pending] = useActionState(saveProductImages, INITIAL_FORM_STATE);
  // Only the owner's changes; untouched, the list follows the saved photos.
  const [edit, setEdit] = useState<string[]>();
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const headingId = useId();

  const list = edit ?? product.images;
  const dirty = !sameList(list, product.images);
  const error = uploadError ?? (dirty ? state.error : null);
  const saved = state !== INITIAL_FORM_STATE && state.error === null && !dirty && !pending;
  const room = MAX_PRODUCT_IMAGES - list.length;

  useEffect(() => {
    if (!dirty && uploading === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, uploading]);

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])].slice(0, Math.max(0, room));
    event.target.value = "";
    if (files.length === 0) return;
    setUploadError(null);
    setUploading(files.length);
    // One at a time, so the photos keep the order they were picked in.
    let next = list;
    for (const file of files) {
      try {
        const url = await shrinkAndUpload(file, {
          bucket: PRODUCT_IMAGES_BUCKET,
          folder: `${shopId}/${product.id}`,
          maxSide: PRODUCT_IMAGE_MAX_SIDE,
          maxBytes: PRODUCT_IMAGE_MAX_BYTES,
        });
        next = addImage(next, url);
        setEdit(next);
      } catch (uploadFailure) {
        setUploadError(`${file.name}: ${uploadErrorMessage(uploadFailure)}`);
      } finally {
        setUploading((count) => count - 1);
      }
    }
    setAnnounce(`Đã thêm ảnh. Có ${next.length} ảnh, chưa lưu.`);
  }

  function move(index: number, delta: number) {
    setUploadError(null);
    setEdit(moveImage(list, index, delta));
    setAnnounce(`Đã chuyển ảnh ${index + 1} thành ảnh ${index + delta + 1}.`);
  }

  function remove(index: number) {
    setUploadError(null);
    setEdit(removeImage(list, index));
    setAnnounce(`Đã bỏ ảnh ${index + 1}. Còn ${list.length - 1} ảnh, chưa lưu.`);
  }

  function discard() {
    setEdit(undefined);
    setUploadError(null);
  }

  return (
    <form action={formAction} aria-labelledby={headingId} aria-describedby={error ? errorId : undefined} className="flex flex-col gap-3 border-t border-[#efebe4] pt-4">
      <input type="hidden" name="productId" value={product.id} />
      <input type="hidden" name="urls" value={JSON.stringify(list)} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headingId} className="text-sm font-medium text-[#474640]">Ảnh sản phẩm</h3>
        <span className="text-xs text-[#706d67] tabular-nums">{list.length}/{MAX_PRODUCT_IMAGES} ảnh · ảnh đầu tiên là ảnh bìa</span>
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-[#706d67]">Chưa có ảnh. Khách sẽ thấy ảnh mẫu của shop.</p>
      ) : (
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {list.map((url, index) => (
            <li key={url} className="flex flex-col gap-2 rounded-lg border border-[#e3dfd8] p-2">
              <div className="relative aspect-square overflow-hidden rounded-md bg-[#efebe4]">
                <Image src={url} alt={`${product.name} – ảnh ${index + 1}`} fill sizes="(max-width: 640px) 45vw, 160px" className="object-cover" />
                {index === 0 && <span className="absolute left-1.5 top-1.5 rounded-full bg-[#171717] px-2 py-0.5 text-[11px] font-semibold text-white">Ảnh bìa</span>}
              </div>
              <div className="flex items-center justify-between gap-1">
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Đưa ảnh ${index + 1} lên trước`} title="Lên trước" className="inline-grid size-11 place-items-center rounded-lg border border-[#d5d0c8] hover:border-[#171717] disabled:opacity-40">
                  <Icon name="up" className="size-4 -rotate-90" />
                </button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === list.length - 1} aria-label={`Đưa ảnh ${index + 1} ra sau`} title="Ra sau" className="inline-grid size-11 place-items-center rounded-lg border border-[#d5d0c8] hover:border-[#171717] disabled:opacity-40">
                  <Icon name="up" className="size-4 rotate-90" />
                </button>
                <button type="button" onClick={() => remove(index)} aria-label={`Xóa ảnh ${index + 1}`} title="Xóa ảnh" className="inline-grid size-11 place-items-center rounded-lg border border-[#d5d0c8] text-[#a83826] hover:border-[#a83826]">
                  <Icon name="trash" className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <p className="sr-only" aria-live="polite">{announce}</p>
      {error && <ErrorMessage id={errorId}>{error}</ErrorMessage>}
      {saved && <p role="status" className="text-sm text-[#2f6b3a]">Đã lưu ảnh. Trang shop hiện ảnh mới.</p>}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <input ref={fileRef} type="file" accept={ACCEPT_ATTRIBUTE} multiple hidden onChange={onFiles} />
        <Button
          type="button"
          variant="secondary"
          className="mr-auto"
          onClick={() => fileRef.current?.click()}
          disabled={room <= 0 || pending}
          loading={uploading > 0}
          loadingText="Đang tải ảnh…"
        >
          Thêm ảnh
        </Button>
        {dirty && !pending && uploading === 0 && <Button type="button" variant="secondary" onClick={discard}>Bỏ thay đổi</Button>}
        <Button type="submit" loading={pending} loadingText="Đang lưu…" disabled={!dirty || uploading > 0}>
          Lưu ảnh
        </Button>
      </div>
      {room <= 0 && <p className="text-xs text-[#706d67]">Đã đủ {MAX_PRODUCT_IMAGES} ảnh. Xóa bớt một ảnh để thêm ảnh khác.</p>}
    </form>
  );
}
