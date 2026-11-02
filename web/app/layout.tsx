import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import Link from "next/link";
import { WalletProvider, WalletButton } from "@/components/wallet";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });
const newsreader = Newsreader({ variable: "--font-newsreader", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Kinfolio on NEAR",
  description:
    "A family trust for self-custodied BTC and ETH. A NEAR contract holds the keys through Chain Signatures; no company does.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} ${newsreader.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <WalletProvider>
          <header className="border-b border-border">
            <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
              <Link href="/" className="font-display text-xl tracking-tight">
                Kinfolio
              </Link>
              <div className="flex items-center gap-3">
                <span className="num hidden rounded-control border border-border px-2 py-0.5 text-xs text-muted sm:inline">
                  NEAR testnet
                </span>
                <WalletButton />
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
          <footer className="border-t border-border">
            <div className="mx-auto w-full max-w-5xl px-4 py-4 text-xs text-muted sm:px-6">
              Testnet software built for NEAR HACKATHON 2026. Not financial or legal advice.
            </div>
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
