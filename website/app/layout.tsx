import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';

// next/font powers the var(--font-*) tokens used by the legacy globals.css routes.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Flowstate — a quieter command room for your local agents',
  description:
    'Flowstate is a local-first desktop home for AI agents. 56 agents, your models, your machine — running quietly in the background.',
  metadataBase: new URL('https://flowstate.app'),
  openGraph: {
    title: 'Flowstate — a quieter command room for your local agents',
    description: 'No API keys, no cloud. Your agents, your hardware, your data.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${jetbrains.variable}`}>
      <head>
        {/* site.css references the literal "Inter" / "JetBrains Mono" families. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
