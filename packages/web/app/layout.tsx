import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nanostakes Arena: agents bargain with real stakes",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
