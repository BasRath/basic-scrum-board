import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scrum Shelter · Big plans. Tiny steps.",
  description: "Your calm before the storm. A shared scrum board for everyday tasks and end-of-days plans, one ticket at a time.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
