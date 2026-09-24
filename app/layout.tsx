import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import Nav from "@/components/Nav";
import "./styles/chrome.css";
import "./styles/sheets.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", weight: ["400", "500", "600", "700", "800"] });
const display = Playfair_Display({ subsets: ["latin"], variable: "--font-display", weight: ["700", "800"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://www.thedepthchartcfb.com"),
  title: { default: "The Depth Chart CFB", template: "%s — The Depth Chart CFB" },
  description: "College football analytics for all 138 FBS teams: opponent-adjusted power ratings, depth charts with estimated snap counts, and player pages.",
  openGraph: { siteName: "The Depth Chart CFB", type: "website" },
  icons: { icon: "/favicon.svg" },
};

// Theme: the saved choice (same `tdc_theme` key the rest of the site uses) is applied by an
// inline script before first paint, so there's no light/dark flash and no hydration mismatch.
const themeScript = `(function(){try{var t=localStorage.getItem("tdc_theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="light" className={`${sans.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Nav />
        {children}
        <footer>
          <div className="col">
            The Depth Chart CFB · Scores, schedules, rosters and play-by-play via ESPN · Player and advanced stats via CollegeFootballData.com
          </div>
        </footer>
      </body>
    </html>
  );
}
