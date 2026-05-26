import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SolaceFrame",
  description: "Continuity-governed synthetic media infrastructure."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
