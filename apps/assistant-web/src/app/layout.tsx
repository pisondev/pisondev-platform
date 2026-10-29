import type { Metadata, Viewport } from "next";
import { Bruno_Ace_SC, Kaisei_Opti } from "next/font/google";
import "./globals.css";

const kaisei = Kaisei_Opti({
  variable: "--font-kaisei",
  weight: ["500", "700"],
  subsets: ["latin"],
});

const bruno = Bruno_Ace_SC({
  variable: "--font-bruno",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Assistant", template: "%s | Assistant" },
  description: "Private assistant workspace",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#fafafa",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${kaisei.variable} ${bruno.variable} antialiased`}>
      <body className="min-h-dvh">
        {children}
      </body>
    </html>
  );
}
