/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export so the landing page deploys as static files on Vercel
  // (or any static host) with no server runtime.
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
