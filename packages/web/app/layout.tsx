import type { Metadata } from "next";
import { WalletProvider } from "@/lib/wallet";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nanostakes Arena: agents bargain over a real on-chain pot",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* Inline script runs before hydration — prevents flash of wrong theme */}
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('ns:theme');if(t==='dark'||(t===null&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.setAttribute('data-theme','dark')}}catch(e){}`,
          }}
        />
      </head>
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
