import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sales X-Ray — рентген отдела продаж",
  description:
    "Аналитика и рост продаж для отделов продаж: воронка, переписка, звонки и ежедневные отчёты в одном месте.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <head>
        {/* Fonts are loaded at runtime (no build-time fetch). If unavailable,
            the Tailwind fallback stacks keep the UI fully usable. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Manrope:wght@400..800&family=JetBrains+Mono:wght@400..700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
