import { CallToAction } from "./components/CallToAction.tsx";
import { Evidence } from "./components/Evidence.tsx";
import { Footer } from "./components/Footer.tsx";
import { Hero } from "./components/Hero.tsx";
import { Marquee } from "./components/Marquee.tsx";
import { Nav } from "./components/Nav.tsx";
import { Services } from "./components/Services.tsx";

export function App() {
  return (
    <>
      <Nav />
      <Hero />
      <Marquee />
      <Evidence />
      <Services />
      <CallToAction />
      <Footer />
    </>
  );
}
