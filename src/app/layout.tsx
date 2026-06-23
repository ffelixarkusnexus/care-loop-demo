import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Care Loop — clinician triage",
  description:
    "A demo behavioral-health triage workflow: perceive, reason, draft, and a deterministic safety gate before a clinician signs off. Not clinical software.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
