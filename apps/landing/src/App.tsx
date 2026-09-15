import { Audiences } from "./components/Audiences.tsx";
import { CallToAction } from "./components/CallToAction.tsx";
import { Evidence } from "./components/Evidence.tsx";
import { Features } from "./components/Features.tsx";
import { Footer } from "./components/Footer.tsx";
import { Hero } from "./components/Hero.tsx";
import { HowItWorks } from "./components/HowItWorks.tsx";
import { Nav } from "./components/Nav.tsx";

export function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Audiences />
        <HowItWorks />
        <Evidence />
        <Features />
        <CallToAction />
      </main>
      <Footer />
    </>
  );
}
