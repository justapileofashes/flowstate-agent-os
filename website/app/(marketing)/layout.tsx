import './site.css';
import Script from 'next/script';

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      {/* Design interaction layer — loaded verbatim from the Claude Design bundle. */}
      <Script src="/site-bg.js" strategy="afterInteractive" />
      <Script src="/site-mascots.js" strategy="afterInteractive" />
      <Script src="/site-hardware.js" strategy="afterInteractive" />
      <Script src="/site.js" strategy="afterInteractive" />
    </>
  );
}
