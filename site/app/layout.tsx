import type { Metadata } from "next";
import "./globals.css";

const DESCRIPTION =
  "The Uniswap V4 execution layer for KeeperHub. Read live pool and position state by poolId, decide deterministically, then execute the swap through KeeperHub and verify the receipt on chain, in your browser.";

export const metadata: Metadata = {
  title: "Vasunthara - Read the pool, rule the hook",
  description: DESCRIPTION,
  keywords: [
    "Uniswap V4",
    "hooks",
    "poolId",
    "PoolManager",
    "StateView",
    "DeFi automation",
    "KeeperHub",
    "limit orders",
    "LP rebalancing",
  ],
  openGraph: {
    title: "Vasunthara - Read the pool, rule the hook",
    description: DESCRIPTION,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Vasunthara - Read the pool, rule the hook",
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
