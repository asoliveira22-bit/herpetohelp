import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "HerpetoHelp — Distribuição da Herpetofauna",
  description:
    "Mapa interativo dos pontos georreferenciados de anfíbios e répteis da base SALVE/ICMBio, com recorte de ocorrências por áreas em KMZ.",
  icons: {
    icon: {
      url: "/herpetohelp-favicon.png",
      type: "image/png",
      sizes: "256x256",
    },
    shortcut: "/herpetohelp-favicon.png",
    apple: "/herpetohelp-favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">
        {children}
        <script
          type="module"
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon='{"token":"ea7a9e080b5649b192e73b25664f81c8"}'
        />
      </body>
    </html>
  );
}
