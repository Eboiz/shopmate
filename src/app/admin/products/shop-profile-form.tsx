"use client";

import Image from "next/image";
import { useActionState, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { TextInput } from "@/components/ui/text-input";
import type { ShopProfile } from "@/lib/catalog";
import { contactItems, MAX_ADDRESS, MAX_FANPAGE_URL } from "@/lib/shop/contact";
import { BANNER_MAX_BYTES, BANNER_MAX_SIDE, DEFAULT_BANNER } from "@/lib/shop/gallery";
import { BANNER_BUCKET } from "@/lib/shop/media-validation";
import { ACCEPT_ATTRIBUTE, shrinkAndUpload, uploadErrorMessage } from "@/lib/shop/upload-image";
import { INITIAL_FORM_STATE, type FormAction } from "./form-state";

type Props = {
  profile: ShopProfile;
  shopId: string;
  canEdit: boolean;
  saveShopProfile: FormAction;
};

// PB-32: address, phone, fanpage and banner of the shop page. Staff read them;
// only the owner edits, and RLS refuses anyone else's save.
export function ShopProfileForm({ profile, shopId, canEdit, saveShopProfile }: Props) {
  if (!canEdit) {
    const items = contactItems(profile);
    return (
      <section className="ui-card flex flex-col gap-4 p-5 sm:p-6">
        <BannerPreview url={profile.bannerUrl} />
        {items.length === 0 ? (
          <p className="text-sm text-[#706d67]">Shop chưa nhập địa chỉ, số điện thoại hay fanpage.</p>
        ) : (
          <dl className="grid gap-3 text-sm">
            {items.map((item) => (
              <div key={item.kind}>
                <dt className="text-xs font-semibold text-[#706d67]">{{ address: "Địa chỉ", phone: "Số điện thoại", fanpage: "Fanpage" }[item.kind]}</dt>
                <dd className="break-words">{item.text}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    );
  }
  return <ProfileEditor profile={profile} shopId={shopId} saveShopProfile={saveShopProfile} />;
}

function BannerPreview({ url }: { url: string | null }) {
  return (
    <figure className="flex flex-col gap-2">
      <div className="relative aspect-[16/7] overflow-hidden rounded-lg bg-[#33312d]">
        <Image src={url ?? DEFAULT_BANNER} alt="" fill sizes="(max-width: 768px) 100vw, 640px" className="object-cover" />
      </div>
      <figcaption className="text-xs text-[#706d67]">{url ? "Ảnh bìa của shop" : "Đang dùng ảnh bìa mặc định"}</figcaption>
    </figure>
  );
}

function ProfileEditor({ profile, shopId, saveShopProfile }: Omit<Props, "canEdit">) {
  const [state, formAction, pending] = useActionState(saveShopProfile, INITIAL_FORM_STATE);
  // A failed save gives back what was typed (form-state.ts).
  const [address, setAddress] = useState(state.values?.address ?? profile.address ?? "");
  const [phone, setPhone] = useState(state.values?.phone ?? profile.phone ?? "");
  const [fanpageUrl, setFanpageUrl] = useState(state.values?.fanpageUrl ?? profile.fanpageUrl ?? "");
  const [bannerUrl, setBannerUrl] = useState(state.values?.bannerUrl ?? profile.bannerUrl ?? "");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty =
    address.trim() !== (profile.address ?? "") ||
    phone.trim() !== (profile.phone ?? "") ||
    fanpageUrl.trim() !== (profile.fanpageUrl ?? "") ||
    bannerUrl !== (profile.bannerUrl ?? "");
  const error = uploadError ?? (dirty ? state.error : null);
  const saved = state !== INITIAL_FORM_STATE && state.error === null && !dirty && !pending;

  async function onBanner(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      setBannerUrl(await shrinkAndUpload(file, { bucket: BANNER_BUCKET, folder: shopId, maxSide: BANNER_MAX_SIDE, maxBytes: BANNER_MAX_BYTES }));
    } catch (failure) {
      setUploadError(uploadErrorMessage(failure));
    } finally {
      setUploading(false);
    }
  }

  return (
    <form action={formAction} className="ui-card flex flex-col gap-5 p-5 sm:p-6">
      <input type="hidden" name="bannerUrl" value={bannerUrl} />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold text-[#474640]">Ảnh bìa trang shop</legend>
        <BannerPreview url={bannerUrl || null} />
        <input ref={fileRef} type="file" accept={ACCEPT_ATTRIBUTE} hidden onChange={onBanner} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()} loading={uploading} loadingText="Đang tải ảnh…" disabled={pending}>
            {bannerUrl ? "Đổi ảnh bìa" : "Tải ảnh bìa"}
          </Button>
          {bannerUrl && (
            <Button type="button" variant="secondary" onClick={() => setBannerUrl("")} disabled={uploading || pending}>
              Dùng ảnh mặc định
            </Button>
          )}
        </div>
        <p className="text-xs text-[#706d67]">Ảnh ngang, ví dụ 1920 × 840. Ảnh lớn được tự thu nhỏ trước khi tải lên.</p>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold text-[#474640]">Thông tin liên hệ</legend>
        <TextInput label="Địa chỉ" name="address" value={address} maxLength={MAX_ADDRESS} autoComplete="street-address" placeholder="Ví dụ: 12 Lê Lợi, Quận 1, TP.HCM" onChange={(event) => setAddress(event.target.value)} />
        <TextInput label="Số điện thoại" name="phone" type="tel" inputMode="tel" value={phone} maxLength={20} autoComplete="tel" placeholder="Ví dụ: 0901 234 567" onChange={(event) => setPhone(event.target.value)} />
        <TextInput label="Link fanpage" name="fanpageUrl" inputMode="url" value={fanpageUrl} maxLength={MAX_FANPAGE_URL} placeholder="https://facebook.com/tenshop" onChange={(event) => setFanpageUrl(event.target.value)} />
        <p className="text-xs text-[#706d67]">Ô để trống sẽ không hiện trên trang shop.</p>
      </fieldset>

      {error && <ErrorMessage>{error}</ErrorMessage>}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {saved && <p role="status" className="mr-auto text-sm text-[#2f6b3a]">Đã lưu. Trang shop hiện thông tin mới.</p>}
        {dirty && !pending && <span className="mr-auto text-xs text-[#706d67]">Chưa lưu</span>}
        <Button type="submit" loading={pending} loadingText="Đang lưu…" disabled={!dirty || uploading}>
          Lưu thông tin shop
        </Button>
      </div>
    </form>
  );
}
