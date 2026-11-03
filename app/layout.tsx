// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ConvexClientProvider from "./ConvexCleintProvider";
import ScenePreloader from "@/components/ScenePreloader";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MUBAS ODeL Indoor Wayfinding Admin",
  description: "Kiosk Management Dashboard System Engine Layout",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* start fetching the 3D building at the very first byte; ScenePreloader then parses it in the background */}
        <link rel="preload" href="/floor/ODeL_Building.glb" as="fetch" crossOrigin="anonymous" />
      </head>
      <body className={inter.className}>
        {/* Wrap your node injection layout structure clean here */}
        <ConvexClientProvider>
          {children}
          <ScenePreloader />
        </ConvexClientProvider>
      </body>
    </html>
  );
}