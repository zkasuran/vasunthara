import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vasunthara - Read the pool, rule the hook",
  description:
    "The deterministic read layer for automating Uniswap V4 hook strategies. Read live pool state, position state and hook-aware quotes by poolId across every chain V4 is deployed on.",
  keywords: [
    "Uniswap V4",
    "hooks",
    "DeFi automation",
    "poolId",
    "StateView",
    "limit orders",
    "LP rebalancing",
  ],
  openGraph: {
    title: "Vasunthara - Read the pool, rule the hook",
    description:
      "The deterministic read layer for automating Uniswap V4 hook strategies.",
    type: "website",
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
