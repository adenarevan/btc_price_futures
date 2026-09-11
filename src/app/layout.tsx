import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "SinyalLab Futures — Paper Research",
  description:
    "Riset paper futures BTC, ETH, SOL, BNB, dan XRP dengan simulasi collateral, funding, dan risiko.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
