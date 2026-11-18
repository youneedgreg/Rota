import type { Metadata } from "next";
import { LanguageSwitch } from "@/lib/lang";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rota",
  description:
    "A tontine with no treasurer. Every payment leaves a receipt nobody can fake.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <LanguageSwitch />
        {children}
      </body>
    </html>
  );
}
