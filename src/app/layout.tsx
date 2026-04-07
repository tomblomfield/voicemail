import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voicemail AI",
  description: "Hands-free email triage for your commute.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`antialiased`}>{children}</body>
    </html>
  );
}
