import type { Metadata } from "next";
import "./globals.css";
import { QuestProvider } from "@/context/QuestContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { TeamSyncProvider } from "@/context/TeamSyncContext";
import { QuestAudioProvider } from "@/context/QuestAudioContext";
import questData from "@/data/quest.json";
import { QuestData as QuestDataType } from "@/types/quest";
import { DebugLogProvider } from '@/context/DebugLogContext';
import { DebugOverlay } from '@/components/DebugOverlay';
import { GlobalErrorHandlers } from '@/components/GlobalErrorHandlers';

const data = questData as unknown as QuestDataType;

export const metadata: Metadata = {
  title: data.quest?.name || "Quest",
  description: data.quest?.description || "A quest adventure",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Crimson+Text:ital,wght@0,400;0,600;1,400&family=IM+Fell+English:ital@0;1&family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Pinyon+Script&family=Spectral:ital,wght@0,400;0,600;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased">
        <TeamSyncProvider>
          <QuestProvider data={questData as unknown as QuestDataType}>
            <ThemeProvider>
              <QuestAudioProvider>
                <DebugLogProvider>
                  <GlobalErrorHandlers />
                  {children}
                  <DebugOverlay />
                </DebugLogProvider>
              </QuestAudioProvider>
            </ThemeProvider>
          </QuestProvider>
        </TeamSyncProvider>
      </body>
    </html>
  );
}
