import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const uiFont = localFont({
  src: [
    { path: "./fonts/BeVietnamPro-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/BeVietnamPro-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/BeVietnamPro-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/BeVietnamPro-Bold.ttf", weight: "700", style: "normal" },
    { path: "./fonts/BeVietnamPro-ExtraBold.ttf", weight: "800", style: "normal" },
    { path: "./fonts/BeVietnamPro-Black.ttf", weight: "900", style: "normal" },
  ],
  variable: "--font-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ShopMate",
  description: "Trợ lý bán hàng AI cho shop thời trang nhỏ",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="vi"
      className={`${uiFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
