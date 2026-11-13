"use client";

import Image from "next/image";
import { useRef, type ClipboardEvent, type FormEvent } from "react";
import { ErrorMessage } from "@/components/ui/error-message";
import { Icon } from "@/components/ui/icon";
import { EMBEDDER_TEXT_MAX } from "@/lib/search/embedder-contract";
import { PHOTO_MEDIA_TYPES } from "@/lib/search/pb30-shim";

type Props = {
  value: string;
  // Every keystroke: the grid's instant filter by name, group and color (AC1).
  onChange: (value: string) => void;
  // Enter or the search button: the description search.
  onSubmit: () => void;
  photoPreviewUrl: string | null;
  // A picked or pasted photo; the page shrinks it and searches at once (AC2).
  onPhoto: (file: File) => void;
  onRemovePhoto: () => void;
  busy: boolean;
  error: string;
};

// PB-34: the grid's search bar, by keyword as before, by description on Enter,
// or by photo (button or Ctrl+V). Buttons are 44 px for touch (AC6).
export function SmartSearch({ value, onChange, onSubmit, photoPreviewUrl, onPhoto, onRemovePhoto, busy, error }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  // The first image on the clipboard becomes the search photo; text pastes normally.
  function paste(event: ClipboardEvent<HTMLInputElement>) {
    const item = [...event.clipboardData.items].find((entry) => entry.kind === "file" && entry.type.startsWith("image/"));
    const file = item?.getAsFile();
    if (!file) return;
    event.preventDefault();
    onPhoto(file);
  }

  return (
    <div className="min-w-0 sm:min-w-80">
      <form role="search" onSubmit={submit} className="flex min-h-11 items-center gap-1 border-b border-[#8f8a82] transition-shadow focus-within:border-[#171717] focus-within:shadow-[0_1px_0_#171717]">
        {photoPreviewUrl && (
          <span className="relative size-11 shrink-0 overflow-hidden bg-[#efebe4]">
            <Image src={photoPreviewUrl} alt="Ảnh đang tìm" fill sizes="44px" unoptimized className="object-cover" />
          </span>
        )}
        {photoPreviewUrl && (
          <button type="button" onClick={onRemovePhoto} aria-label="Xóa ảnh" className="inline-grid size-11 shrink-0 place-items-center text-[#706d67] hover:text-[#171717]">
            <Icon name="close" className="size-4" />
          </button>
        )}
        <label className="min-w-0 flex-1">
          <span className="sr-only">Tìm sản phẩm</span>
          <input
            type="search"
            value={value}
            maxLength={EMBEDDER_TEXT_MAX}
            onChange={(event) => onChange(event.target.value)}
            onPaste={paste}
            placeholder="Tìm theo tên, màu, hoặc mô tả..."
            className="w-full bg-transparent px-1 py-2 text-sm outline-none placeholder:text-[#7a766f]"
          />
        </label>
        <button type="button" onClick={() => fileRef.current?.click()} aria-label="Tìm bằng ảnh" title="Tìm bằng ảnh" className="inline-grid size-11 shrink-0 place-items-center text-[#171717] hover:text-[#c2412b]">
          <Icon name="camera" className="size-5" />
        </button>
        <button type="submit" aria-label="Tìm" disabled={busy} className="inline-grid size-11 shrink-0 place-items-center text-[#171717] hover:text-[#c2412b] disabled:opacity-50">
          <Icon name="search" className="size-5" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={PHOTO_MEDIA_TYPES.join(",")}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset so picking the same photo again still fires a change.
            event.target.value = "";
            if (file) onPhoto(file);
          }}
        />
      </form>
      {busy && <p className="mt-1 text-xs text-[#706d67]" aria-live="polite">Đang tìm...</p>}
      {error && <ErrorMessage className="mt-1">{error}</ErrorMessage>}
    </div>
  );
}
