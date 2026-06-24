import '../globals.css';
import { SmoothScroll } from '@/components/SmoothScroll';
import { InteractiveBackground } from '@/components/InteractiveBackground';
import { ScrollProgressBar } from '@/components/ScrollProgressBar';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <InteractiveBackground />
      <ScrollProgressBar />
      <SmoothScroll>
        <Nav />
        <main>{children}</main>
        <Footer />
      </SmoothScroll>
    </>
  );
}
