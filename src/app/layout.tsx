import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

// Display: condensed, heavy, set big and tight (Monument-style headlines).
const shoulders = Big_Shoulders({ variable: "--font-shoulders", subsets: ["latin"], weight: "variable", axes: ["opsz"] });
// Editorial serif for statements and pull quotes.
const serif = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });
const instrument = Instrument_Sans({ variable: "--font-instrument", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], weight: ["500", "700"] });

export const metadata: Metadata = {
  title: { default: "IntelQA CBT", template: "%s · IntelQA" },
  description: "Sit the exam before the exam. Past questions, a real CBT timer, and every answer explained.",
  applicationName: "IntelQA CBT",
  appleWebApp: { capable: true, title: "IntelQA", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F3ECDF" },
    { media: "(prefers-color-scheme: dark)", color: "#120B2E" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** Applies the saved theme before first paint so there's no flash. */
const themeScript = `try{var t=localStorage.getItem("iq-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${shoulders.variable} ${serif.variable} ${instrument.variable} ${jetbrains.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
