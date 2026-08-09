"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

// screenshots are exported straight from the iPhone simulator, so every
// preview stays in sync with what the app actually looks like
const SHOT_WIDTH = 800;
const SHOT_HEIGHT = 1739;

const steps = [
  {
    label: "Home",
    title: ["Start with", "your classes."],
    copy: ["Add your courses once.", "See what's next at a glance."],
    src: "/screens/home.png",
    alt: "Studi home screen showing what's up next, your classes, and study buddies.",
  },
  {
    label: "New session",
    title: ["Host a session", "in a few taps."],
    copy: ["Pick the class, spot, and day.", "Post it and classmates join."],
    src: "/screens/new-session.png",
    alt: "New session screen with class chips, a study spot picker, and a date calendar.",
  },
  {
    label: "Spots",
    title: ["Pick the right", "study spot."],
    copy: ["Browse spots around campus.", "See ratings before you go."],
    src: "/screens/spots.png",
    alt: "Study spots map with pins across campus and a list of nearby spots.",
  },
  {
    label: "Messages",
    title: ["Keep the", "conversation going."],
    copy: ["Message classmates directly.", "Stay in sync before you meet."],
    src: "/screens/messages.png",
    alt: "A Studi conversation with a classmate.",
  },
  {
    label: "Profile",
    title: ["Everything", "in one place."],
    copy: ["Classes, buddies, and spots.", "Ready when you are."],
    src: "/screens/profile.png",
    alt: "Studi profile with a verified badge, current classes, and top study spots.",
  },
];

function SimulatorScreen({ activeStep }: { activeStep: number }) {
  return (
    <div className="sim-phone" data-active={activeStep} aria-label="Studi app preview">
      <div className="sim-phone-edge" aria-hidden="true" />
      <div className="sim-phone-screen">
        {steps.map((step, index) => (
          <Image
            alt={step.alt}
            aria-hidden={index !== activeStep}
            className={index === activeStep ? "sim-shot is-active" : "sim-shot"}
            height={SHOT_HEIGHT}
            key={step.label}
            priority={index === 0}
            sizes="(max-width: 760px) 300px, 320px"
            src={step.src}
            width={SHOT_WIDTH}
          />
        ))}
      </div>
    </div>
  );
}

export default function HowStudiWorks() {
  const [activeStep, setActiveStep] = useState(0);
  const stepRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visible) {
          const index = Number((visible.target as HTMLElement).dataset.stepIndex);
          setActiveStep(index);
        }
      },
      { rootMargin: "-35% 0px -35% 0px", threshold: [0.1, 0.35, 0.6] },
    );

    stepRefs.current.forEach((step) => step && observer.observe(step));
    return () => observer.disconnect();
  }, []);

  const selectStep = (index: number) => {
    setActiveStep(index);
    stepRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <article className="how-page">
      <section className="how-hero">
        <div className="how-hero-copy">
          <h1 className="how-hero-title" data-reveal>
            <span>Study plans</span>
            <em>that actually happen.</em>
          </h1>
          <p className="how-hero-description" data-reveal>
            Studi is a campus study network built around the classes you already take. It makes
            finding your people, a session, and a good spot feel effortless.
          </p>
        </div>
        <div className="how-hero-note" aria-hidden="true">
          <span>Scroll to explore</span>
          <i />
        </div>
      </section>

      <section className="how-story" aria-label="How Studi works across five app screens">
        <div className="how-phone-column" id="app-preview">
          <div className="how-phone-wrap">
            <div className="sim-glow sim-glow--one" aria-hidden="true" />
            <div className="sim-glow sim-glow--two" aria-hidden="true" />
            <div className="how-mobile-scroll-hint" aria-hidden="true">
              <strong>Scroll</strong>
              <span>to change screens</span>
              <i />
            </div>
            <div className="sim-phone-stage">
              <SimulatorScreen activeStep={activeStep} />
            </div>
            <div className="sim-progress" aria-label="Choose an app preview" role="tablist">
              {steps.map((step, index) => (
                <button
                  aria-controls={`how-step-${index}`}
                  aria-label={`Show the ${step.label} preview`}
                  aria-selected={index === activeStep}
                  className={index === activeStep ? "is-active" : ""}
                  key={step.label}
                  onClick={() => selectStep(index)}
                  role="tab"
                  type="button">
                  <span aria-hidden="true" className="sim-progress-dot" />
                  <span className="sim-progress-label">{step.label}</span>
                </button>
              ))}
            </div>
            <div className={`how-mobile-step how-mobile-step--${activeStep}`} key={steps[activeStep].label} aria-live="polite">
              <h2>
                {steps[activeStep].title.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </h2>
              <div className="how-step-rule" aria-hidden="true" />
              <p>
                {steps[activeStep].copy.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </p>
            </div>
          </div>
        </div>

        <div className="how-steps">
          {steps.map((step, index) => (
            <section
              className={index === activeStep ? "how-step is-active" : "how-step"}
              data-step-index={index}
              id={`how-step-${index}`}
              key={step.title.join(" ")}
              ref={(element) => {
                stepRefs.current[index] = element;
              }}
            >
              <h2>
                {step.title.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </h2>
              <div className="how-step-rule" aria-hidden="true" />
              <p className="how-step-copy">
                {step.copy.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </p>
            </section>
          ))}
        </div>
      </section>

      <section className="how-closing">
        <div className="how-closing-card" data-reveal>
          <h2>
            <em>Less guesswork.</em>
            <span>Show up</span>
            <strong>together.</strong>
          </h2>
          <span className="how-closing-note">Launching Fall 2026 at UW–Madison</span>
        </div>
      </section>
    </article>
  );
}
