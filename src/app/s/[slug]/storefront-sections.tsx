"use client";

import Image from "next/image";
import { useState, type CSSProperties, type FormEvent } from "react";
import { formatPrice } from "@/lib/format";
import type { ShopProduct, SizeChartRow } from "@/lib/shop/types";
import { HeaderSearch } from "./header-search";

// Presentational blocks of the shop front. Every block that can start a
// conversation calls `onAsk`; the chat itself lives in ShopFront.

export type GroupLink = { name: string; count: number; imageUrl: string | null };

export const QUICK_ASKS = [
  "Tư vấn size giúp mình",
  "Shop còn hàng size M không?",
  "Gợi ý phối đồ đi làm",
  "Phí ship bao nhiêu?",
  "Đổi size thế nào?",
] as const;

const chipClass = "inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full border border-[#8f8a82] bg-white px-4 text-sm font-semibold text-[#171717] transition-colors hover:border-[#171717]";
const solidButton = "inline-flex min-h-12 items-center justify-center gap-2 border-[1.5px] px-5 text-xs font-extrabold uppercase tracking-[.12em] transition-colors";

function readField(event: FormEvent<HTMLFormElement>, name: string) {
  event.preventDefault();
  const input = event.currentTarget.elements.namedItem(name) as HTMLInputElement | null;
  const value = input?.value.trim() ?? "";
  if (input && value) input.value = "";
  return value;
}

export function ShopMarquee({ items }: { items: string[] }) {
  // Decorative repeat of facts the footer states in full, so it stays out of
  // the accessibility tree.
  return (
    <div aria-hidden="true" className="overflow-hidden bg-[#171717] text-white">
      <div className="ui-marquee py-2.5">
        {[...items, ...items].map((text, index) => (
          <span key={index} className="flex shrink-0 items-center gap-3 pr-12 text-[11px] font-bold uppercase tracking-[.14em]">
            <span className="size-1.5 bg-[#e9573f]" />
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}

type HeaderProps = {
  shopName: string;
  groups: GroupLink[];
  itemCount: number;
  onOpenCart: () => void;
  onAsk: (text: string) => void;
  onChooseGroup: (name: string) => void;
  products: ShopProduct[];
  productHref: (productId: string) => string;
  onSearch: (query: string) => void;
};

export function ShopHeader({ shopName, groups, itemCount, onOpenCart, onAsk, onChooseGroup, products, productHref, onSearch }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navLink = "inline-flex min-h-[72px] items-center border-b-2 border-transparent px-3.5 text-xs font-extrabold uppercase tracking-[.12em] transition-colors hover:border-[#171717]";
  const choose = (name: string) => { setMenuOpen(false); onChooseGroup(name); };
  const ask = (text: string) => { setMenuOpen(false); onAsk(text); };
  const search = (query: string) => { setMenuOpen(false); onSearch(query); };

  return (
    <header className="sticky top-0 z-30 border-b border-[#e3dfd8] bg-white">
      <div className="mx-auto flex min-h-16 max-w-[1400px] items-center gap-3 px-4 sm:px-6 lg:min-h-[72px] lg:gap-6 lg:px-10">
        <button
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          aria-expanded={menuOpen}
          aria-controls="shop-menu"
          className="-ml-2 inline-flex min-h-11 items-center px-2 text-xs font-extrabold uppercase tracking-[.12em] lg:hidden"
        >
          {menuOpen ? "Đóng" : "Menu"}
        </button>
        <a href="#dau-trang" className="flex min-w-0 items-center gap-3">
          <Image src="/images/shop-avatar.jpg" alt="" width={36} height={36} className="size-9 shrink-0 object-cover" />
          <span className="flex min-w-0 items-baseline text-lg font-black uppercase tracking-[-.04em] sm:text-xl">
            <h1 className="truncate">{shopName}</h1>
            <span aria-hidden="true" className="text-[#e9573f]">.</span>
          </span>
        </a>

        <nav aria-label="Điều hướng cửa hàng" className="hidden flex-1 justify-center lg:flex">
          <div className="group/mega">
            <a href="#san-pham" className={navLink}>Sản phẩm</a>
            <div className="invisible absolute inset-x-0 top-full border-b border-[#e3dfd8] bg-white opacity-0 shadow-[0_28px_40px_-30px_#17171766] transition-opacity duration-150 group-focus-within/mega:visible group-focus-within/mega:opacity-100 group-hover/mega:visible group-hover/mega:opacity-100">
              <div className="mx-auto grid max-w-[1400px] grid-cols-[1fr_1fr_1.25fr] gap-10 px-10 py-8">
                <div>
                  <h2 className="mb-3 text-xs font-extrabold uppercase tracking-[.14em] text-[#706d67]">Danh mục</h2>
                  <ul className="grid gap-1">
                    {groups.map((group) => (
                      <li key={group.name}>
                        <button type="button" onClick={() => choose(group.name)} className="inline-flex min-h-9 items-baseline gap-2 text-[15px] font-semibold hover:text-[#c2412b]">
                          {group.name}<span className="text-xs tabular-nums text-[#706d67]">{group.count}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h2 className="mb-3 text-xs font-extrabold uppercase tracking-[.14em] text-[#706d67]">Hỏi nhanh</h2>
                  <ul className="grid gap-1">
                    {QUICK_ASKS.map((text) => (
                      <li key={text}><button type="button" onClick={() => ask(text)} className="inline-flex min-h-9 items-center text-left text-[15px] font-semibold hover:text-[#c2412b]">{text}</button></li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col items-start gap-3 bg-[#171717] p-6 text-white">
                  <p className="text-xl font-bold leading-snug">Chưa biết chọn gì?</p>
                  <p className="text-sm leading-6 text-[#d4d1ca]">Kể cho trợ lý AI dịp bạn sắp đi và ngân sách, trợ lý gợi ý cả set.</p>
                  <button type="button" onClick={() => ask("Mình chưa biết chọn gì, gợi ý giúp mình một set đồ")} className={`${solidButton} mt-1 border-white bg-white text-[#171717] hover:border-[#e9573f] hover:bg-[#e9573f]`}>Hỏi trợ lý AI</button>
                </div>
              </div>
            </div>
          </div>
          <a href="#tu-van-size" className={navLink}>Tư vấn size</a>
          <a href="#chinh-sach" className={navLink}>Chính sách</a>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
          <HeaderSearch products={products} productHref={productHref} onSearch={search} onAsk={ask} className="hidden w-[280px] lg:block" />
          <button type="button" onClick={onOpenCart} className="hidden min-h-11 items-center gap-2 px-2 text-xs font-extrabold uppercase tracking-[.1em] hover:text-[#c2412b] sm:inline-flex">
            Giỏ <span className="inline-grid h-5 min-w-5 place-items-center rounded-full bg-[#171717] px-1.5 text-[11px] tabular-nums text-white">{itemCount}</span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav id="shop-menu" aria-label="Danh mục" className="border-t border-[#e3dfd8] bg-white px-4 pb-4 sm:px-6 lg:hidden">
          <HeaderSearch products={products} productHref={productHref} onSearch={search} onAsk={ask} className="mt-3" />
          <ul>
            {groups.map((group) => (
              <li key={group.name} className="border-b border-[#e3dfd8]">
                <button type="button" onClick={() => choose(group.name)} className="flex min-h-12 w-full items-center justify-between text-sm font-bold uppercase tracking-[.08em]">
                  {group.name}<span className="text-xs font-semibold tabular-nums text-[#706d67]">{group.count}</span>
                </button>
              </li>
            ))}
            <li className="border-b border-[#e3dfd8]"><a href="#tu-van-size" onClick={() => setMenuOpen(false)} className="flex min-h-12 items-center text-sm font-bold uppercase tracking-[.08em]">Tư vấn size</a></li>
            <li><a href="#chinh-sach" onClick={() => setMenuOpen(false)} className="flex min-h-12 items-center text-sm font-bold uppercase tracking-[.08em]">Chính sách</a></li>
          </ul>
        </nav>
      )}
    </header>
  );
}

export function AskRow({ onAsk }: { onAsk: (text: string) => void }) {
  return (
    <div className="border-b border-[#e3dfd8] bg-[#f5f3ef]">
      <div className="mx-auto flex max-w-[1400px] items-center gap-2.5 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] sm:px-6 lg:px-10">
        <span className="mr-1 shrink-0 text-xs font-extrabold uppercase tracking-[.14em] text-[#706d67]">Khách hay hỏi</span>
        {QUICK_ASKS.map((text) => <button key={text} type="button" onClick={() => onAsk(text)} className={chipClass}>{text}</button>)}
      </div>
    </div>
  );
}

type HeroProps = {
  shopName: string;
  featured: ShopProduct[];
  onAsk: (text: string) => void;
  onAskAbout: (product: ShopProduct) => void;
};

export function ShopHero({ shopName, featured, onAsk, onAskAbout }: HeroProps) {
  return (
    <section id="dau-trang" className="mx-auto grid max-w-[1400px] gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[1.45fr_1fr] lg:px-10">
      <div className="relative flex min-h-[440px] items-end overflow-hidden bg-[#33312d] text-white lg:min-h-[580px]">
        <Image src="/images/hero-boutique.jpg" alt="" fill priority sizes="(max-width: 1024px) 100vw, 60vw" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#17171766] via-[#17171799] to-[#171717ee] lg:from-[#17171700] lg:via-[#17171733] lg:to-[#171717e6]" />
        <div className="ui-enter relative z-10 grid max-w-3xl gap-4 p-6 sm:p-10">
          <p className="text-balance text-[clamp(2.25rem,4.4vw,4.25rem)] font-black uppercase leading-[1.06] tracking-[-.035em]">Chọn đúng size,<br />mặc đúng gu<span className="text-[#e9573f]">.</span></p>
          <p className="max-w-md text-sm leading-7 text-[#e4e0d8] sm:text-base">Khám phá sản phẩm của {shopName}. Chưa chắc size hay màu, hỏi trợ lý AI ngay trên trang.</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <a href="#san-pham" className={`${solidButton} border-white bg-white text-[#171717] hover:border-[#e9573f] hover:bg-[#e9573f]`}>Xem sản phẩm</a>
            <a href="#tu-van-size" className={`${solidButton} border-white/70 text-white hover:border-white hover:bg-white hover:text-[#171717]`}>Tìm size của bạn</a>
          </div>
        </div>
      </div>

      <aside id="hero-chat" aria-label="Trợ lý AI" className="ui-enter ui-enter-delay flex min-w-0 flex-col border-[1.5px] border-[#171717] bg-[#f5f3ef]">
        <div className="flex items-center gap-3 bg-[#171717] px-5 py-4 text-white">
          <Image src="/images/shop-avatar.jpg" alt="" width={40} height={40} className="size-10 shrink-0 object-cover" />
          <div className="min-w-0">
            <p className="truncate font-bold">Trợ lý AI của {shopName}</p>
            <p className="flex items-center gap-1.5 text-xs text-[#d4d1ca]"><span className="size-[7px] rounded-full bg-[#4cc47a]" />Trả lời trong vài giây</p>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-4 p-5">
          <p className="max-w-[90%] rounded-2xl rounded-bl-sm border border-[#e3dfd8] bg-white px-4 py-3 text-sm leading-6">
            Chào bạn! Mình trả lời về <strong>size, màu, tồn kho và phối đồ</strong> của {shopName}. Câu nào khó, nhân viên shop sẽ vào trả lời tiếp.
          </p>
          {featured.length > 0 && (
            <div className="grid gap-2">
              <p className="text-xs font-semibold text-[#706d67]">Hỏi nhanh về sản phẩm</p>
              {featured.map((product) => (
                <button key={product.id} type="button" onClick={() => onAskAbout(product)} className="group flex items-center gap-3 border border-[#e3dfd8] bg-white p-2 text-left transition-colors hover:border-[#171717]">
                  <span className="relative h-16 w-[52px] shrink-0 overflow-hidden bg-[#eeebe5]">
                    <Image src={product.imageUrl || "/images/product-placeholder.jpg"} alt="" fill sizes="52px" className="object-cover" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{product.name}</span>
                    <span className="text-xs tabular-nums text-[#706d67]">{formatPrice(product.price)}</span>
                  </span>
                  <span className="shrink-0 px-2 text-[11px] font-extrabold uppercase tracking-[.1em] text-[#c2412b] group-hover:underline">Hỏi</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid gap-3 border-t border-[#e3dfd8] bg-white p-4 sm:p-5">
          <div className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
            {[["Tư vấn size", "Tư vấn size giúp mình"], ["Phối đồ đi làm", "Gợi ý phối đồ đi làm"], ["Đổi trả", "Đổi size thế nào?"]].map(([label, text]) => (
              <button key={label} type="button" onClick={() => onAsk(text)} className={chipClass}>{label}</button>
            ))}
          </div>
          <form onSubmit={(event) => { const text = readField(event, "q"); if (text) onAsk(text); }} className="flex gap-2">
            <input name="q" aria-label="Câu hỏi cho trợ lý AI" placeholder="Hỏi về size, màu, tồn kho..." autoComplete="off" maxLength={1000} className="min-h-12 min-w-0 flex-1 border-[1.5px] border-[#171717] bg-white px-3.5 text-base outline-none placeholder:text-[#706d67] focus:shadow-[0_0_0_3px_#c2412b40] sm:text-sm" />
            <button type="submit" className={`${solidButton} border-[#171717] bg-[#171717] text-white hover:border-[#c2412b] hover:bg-[#c2412b]`}>Hỏi ngay</button>
          </form>
        </div>
      </aside>
    </section>
  );
}

type TilesProps = { groups: GroupLink[]; onChoose: (name: string) => void; onAsk: (text: string) => void };

export function GroupTiles({ groups, onChoose, onAsk }: TilesProps) {
  const shown = groups.slice(0, 4);
  return (
    <section aria-labelledby="bo-suu-tap-title" className="mx-auto max-w-[1400px] px-4 pb-16 sm:px-6 sm:pb-20 lg:px-10">
      <h2 id="bo-suu-tap-title" className="mb-6 text-[clamp(1.9rem,3.6vw,3rem)] font-black uppercase leading-none tracking-[-.04em]">Theo danh mục<span className="text-[#e9573f]">.</span></h2>
      <div style={{ "--tiles": Math.max(4, shown.length + 1) } as CSSProperties} className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-[repeat(var(--tiles),minmax(0,1fr))]">
        {shown.map((group) => (
          <button key={group.name} type="button" onClick={() => onChoose(group.name)} className="group relative flex aspect-[3/4.2] items-end overflow-hidden bg-[#33312d] text-left text-white">
            <Image src={group.imageUrl || "/images/product-placeholder.jpg"} alt="" fill sizes="(max-width: 768px) 50vw, 20vw" className="object-cover transition-transform duration-500 group-hover:scale-105" />
            <span className="absolute inset-0 bg-gradient-to-b from-[#17171700] from-40% to-[#171717cc]" />
            <span className="relative z-10 grid gap-1 p-4 sm:p-5">
              <span className="text-lg font-black uppercase leading-tight tracking-[-.03em] sm:text-xl">{group.name}</span>
              <span className="text-[11px] font-extrabold uppercase tracking-[.14em] underline underline-offset-4">{group.count} sản phẩm</span>
            </span>
          </button>
        ))}
        <button type="button" onClick={() => onAsk("Mình chưa biết chọn gì, tư vấn giúp mình")} className="relative col-span-2 flex min-h-48 flex-col justify-between gap-6 bg-[#e9573f] p-4 text-left text-[#171717] transition-colors hover:bg-[#f06a53] sm:p-5 md:col-span-1 md:aspect-[3/4.2] md:min-h-0">
          <span className="text-[clamp(2.25rem,3.6vw,3.25rem)] font-black leading-[.92] tracking-[-.04em]">Chưa biết chọn?</span>
          <span className="grid gap-1">
            <span className="text-lg font-black uppercase leading-tight tracking-[-.03em] sm:text-xl">Hỏi trợ lý AI</span>
            <span className="text-[11px] font-extrabold uppercase tracking-[.14em] underline underline-offset-4">Bắt đầu chat</span>
          </span>
        </button>
      </div>
    </section>
  );
}

const inRange = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;

export function SizeBand({ chart, onAsk }: { chart: SizeChartRow[] | null; onAsk: (text: string) => void }) {
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const h = Number(height.replace(",", "."));
    const w = Number(weight.replace(",", "."));
    if (!inRange(h, 120, 210) || !inRange(w, 30, 150)) {
      setError("Nhập chiều cao từ 120 đến 210 cm và cân nặng từ 30 đến 150 kg.");
      return;
    }
    setError("");
    onAsk(`Mình cao ${h}cm, nặng ${w}kg, tư vấn size giúp mình`);
  }

  const field = "min-h-[52px] w-full border-[1.5px] border-[#5a5752] bg-transparent px-3.5 text-base tabular-nums text-white outline-none placeholder:text-[#8f8a82] focus:border-[#e9573f]";
  return (
    <section id="tu-van-size" className="scroll-mt-24 bg-[#171717] text-white">
      <div className="mx-auto grid max-w-[1400px] items-center gap-10 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-[1.1fr_1fr] lg:px-10">
        <div>
          <h2 className="text-balance text-[clamp(2rem,4.2vw,3.5rem)] font-black uppercase leading-[1.04] tracking-[-.04em]">Gửi số đo.<br />Nhận size trong 10 giây<span className="text-[#e9573f]">.</span></h2>
          <p className="mt-4 max-w-[46ch] text-sm leading-7 text-[#d4d1ca] sm:text-base">Trợ lý AI đối chiếu bảng size của từng mẫu với tồn kho hiện có. Câu khó thì nhân viên của shop vào trả lời tiếp.</p>
        </div>
        <form onSubmit={submit} noValidate className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="grid gap-1.5 text-[11px] font-extrabold uppercase tracking-[.14em] text-[#d4d1ca]">
            Chiều cao (cm)
            <input value={height} onChange={(event) => setHeight(event.target.value)} inputMode="decimal" placeholder="158" className={field} />
          </label>
          <label className="grid gap-1.5 text-[11px] font-extrabold uppercase tracking-[.14em] text-[#d4d1ca]">
            Cân nặng (kg)
            <input value={weight} onChange={(event) => setWeight(event.target.value)} inputMode="decimal" placeholder="50" className={field} />
          </label>
          <button type="submit" className={`${solidButton} col-span-2 min-h-[52px] border-white bg-white text-[#171717] hover:border-[#e9573f] hover:bg-[#e9573f] sm:col-span-1`}>Tìm size</button>
          {error && <p className="col-span-full text-sm text-[#f6b7a8]">{error}</p>}
          {chart && chart.length > 0 && (
            <div className="col-span-full mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm tabular-nums">
                <caption className="mb-2 text-left text-xs text-[#aaa69f]">Bảng size tham khảo. Mỗi mẫu có thể khác, trợ lý kiểm tra theo từng mẫu.</caption>
                <thead>
                  <tr className="text-[11px] uppercase tracking-[.12em] text-[#aaa69f]">
                    <th scope="col" className="border-b border-white/15 py-2 pr-3 text-left font-bold">Size</th>
                    <th scope="col" className="border-b border-white/15 py-2 pr-3 text-left font-bold">Chiều cao</th>
                    <th scope="col" className="border-b border-white/15 py-2 text-left font-bold">Cân nặng</th>
                  </tr>
                </thead>
                <tbody>
                  {chart.map((row) => (
                    <tr key={row.size}>
                      <td className="border-b border-white/15 py-2 pr-3 font-bold">{row.size}</td>
                      <td className="border-b border-white/15 py-2 pr-3">{row.heightMinCm}–{row.heightMaxCm} cm</td>
                      <td className="border-b border-white/15 py-2">{row.weightMinKg}–{row.weightMaxKg} kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </form>
      </div>
    </section>
  );
}

type FooterProps = {
  shopName: string;
  groups: GroupLink[];
  policyItems: Array<{ title: string; text: string }>;
  onChoose: (name: string) => void;
  onAsk: (text: string) => void;
};

export function ShopFooter({ shopName, groups, policyItems, onChoose, onAsk }: FooterProps) {
  const head = "mb-4 text-xs font-extrabold uppercase tracking-[.16em]";
  const link = "inline-flex min-h-8 items-center text-left text-sm text-[#45423d] hover:text-[#c2412b]";
  return (
    // pb-28 leaves room for the floating chat button and the phone bottom bar.
    <footer id="chinh-sach" className="scroll-mt-24 border-t border-[#e3dfd8] bg-[#f5f3ef] pb-28">
      <div className="mx-auto grid max-w-[1400px] gap-10 px-4 pt-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-[1.2fr_.8fr_.9fr_2fr] lg:px-10">
        <div>
          <p className="text-2xl font-black uppercase tracking-[-.04em]">{shopName}<span className="text-[#e9573f]">.</span></p>
          <p className="mt-3 max-w-[34ch] text-sm leading-6 text-[#45423d]">Hỏi gì cũng được: trợ lý AI trả lời ngay trên trang, nhân viên shop hỗ trợ khi cần.</p>
        </div>
        {groups.length > 0 && (
          <div>
            <h2 className={head}>Danh mục</h2>
            <ul className="grid gap-1">{groups.map((group) => <li key={group.name}><button type="button" onClick={() => onChoose(group.name)} className={link}>{group.name}</button></li>)}</ul>
          </div>
        )}
        <div>
          <h2 className={head}>Hỗ trợ</h2>
          <ul className="grid gap-1">
            <li><a href="#tu-van-size" className={link}>Tư vấn size</a></li>
            <li><button type="button" onClick={() => onAsk("Hướng dẫn mình cách đặt hàng")} className={link}>Hướng dẫn đặt hàng</button></li>
            <li><button type="button" onClick={() => onAsk("Shop có những hình thức thanh toán nào?")} className={link}>Thanh toán</button></li>
          </ul>
        </div>
        {policyItems.length > 0 && (
          <div className="grid gap-6 sm:col-span-2 lg:col-span-1 lg:grid-cols-2">
            {policyItems.map((item) => (
              <div key={item.title}>
                <h2 className={head}>Chính sách {item.title.toLocaleLowerCase("vi")}</h2>
                <p className="whitespace-pre-line text-sm leading-6 text-[#45423d]">{item.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mx-auto mt-12 flex max-w-[1400px] flex-wrap items-center justify-between gap-3 border-t border-[#e3dfd8] px-4 pt-5 text-xs text-[#706d67] sm:px-6 lg:px-10">
        <span>Được hỗ trợ bởi ShopMate</span>
        <a href="#dau-trang" className="inline-flex min-h-11 items-center font-extrabold uppercase tracking-[.12em] text-[#171717] hover:text-[#c2412b]">Lên đầu trang</a>
      </div>
    </footer>
  );
}
