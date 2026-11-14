"use client";

import Image from "next/image";
import { useRef, useState, type KeyboardEvent, type TouchEvent } from "react";
import { Icon } from "@/components/ui/icon";
import { galleryAlt, galleryKeyTarget } from "@/lib/shop/gallery";

const SWIPE_PX = 40;
const MAIN_SIZES = "(max-width: 1024px) 100vw, 48vw";

// PB-32: the product detail photo gallery. A main photo plus a row of
// thumbnails. Touch: tap a thumbnail, swipe the main photo, or use the arrow
// buttons (44 px). Keyboard: Tab to the thumbnails (one tab stop), then the
// arrow keys, Home and End move between photos. Every photo's alt text comes
// from the product name.
export function ProductGallery({ name, images }: { name: string; images: string[] }) {
  const [selected, setSelected] = useState(0);
  const thumbs = useRef<Array<HTMLButtonElement | null>>([]);
  const touchX = useRef<number | null>(null);
  const count = images.length;
  const current = Math.min(selected, Math.max(0, count - 1));

  if (count === 0) {
    return (
      <div className="relative aspect-square overflow-hidden rounded-lg bg-[#eeebe5]">
        <Image src="/images/product-placeholder.jpg" alt="" fill priority sizes={MAIN_SIZES} className="object-cover" />
      </div>
    );
  }

  function show(index: number, focusThumb = false) {
    const next = (index + count) % count;
    setSelected(next);
    if (focusThumb) {
      const thumb = thumbs.current[next];
      thumb?.focus();
      thumb?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  function onThumbKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const target = galleryKeyTarget(event.key, index, count);
    if (target === null) return;
    event.preventDefault();
    show(target, true);
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = touchX.current;
    touchX.current = null;
    if (start === null || count < 2) return;
    const dx = event.changedTouches[0].clientX - start;
    if (Math.abs(dx) >= SWIPE_PX) show(current + (dx < 0 ? 1 : -1));
  }

  const navButton = "absolute top-1/2 inline-grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-[#171717] shadow-[0_6px_18px_-8px_#17171799] transition-colors hover:bg-white";

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div
        className="relative aspect-square touch-pan-y overflow-hidden rounded-lg bg-[#eeebe5]"
        onTouchStart={(event) => { touchX.current = event.touches[0].clientX; }}
        onTouchEnd={onTouchEnd}
      >
        <Image
          key={images[current]}
          src={images[current]}
          alt={galleryAlt(name, current, count)}
          fill
          priority={current === 0}
          sizes={MAIN_SIZES}
          className="object-cover"
        />
        {count > 1 && (
          <>
            <button type="button" onClick={() => show(current - 1)} aria-label="Ảnh trước" className={`${navButton} left-2`}>
              <Icon name="up" className="size-5 -rotate-90" />
            </button>
            <button type="button" onClick={() => show(current + 1)} aria-label="Ảnh sau" className={`${navButton} right-2`}>
              <Icon name="up" className="size-5 rotate-90" />
            </button>
            <span aria-hidden="true" className="absolute bottom-2 right-2 rounded-full bg-[#171717cc] px-2.5 py-1 text-xs font-semibold tabular-nums text-white">
              {current + 1}/{count}
            </span>
          </>
        )}
      </div>
      <p className="sr-only" aria-live="polite">{count > 1 ? `Ảnh ${current + 1} trên ${count}` : ""}</p>

      {count > 1 && (
        <div role="group" aria-label={`Ảnh của ${name}`} className="-mx-1 overflow-x-auto px-1 py-1 [scrollbar-width:thin]">
          <ul className="flex gap-2">
            {images.map((url, index) => (
              <li key={url} className="shrink-0">
                <button
                  ref={(element) => { thumbs.current[index] = element; }}
                  type="button"
                  aria-current={index === current ? "true" : undefined}
                  tabIndex={index === current ? 0 : -1}
                  onClick={() => show(index)}
                  onKeyDown={(event) => onThumbKey(event, index)}
                  className={`relative block size-16 overflow-hidden rounded-md border-2 bg-[#eeebe5] transition-colors sm:size-20 ${
                    index === current ? "border-[#171717]" : "border-transparent opacity-80 hover:opacity-100"
                  }`}
                >
                  <Image src={url} alt={galleryAlt(name, index, count)} fill sizes="80px" className="object-cover" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
