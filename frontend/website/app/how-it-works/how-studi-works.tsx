"use client";

import { useEffect, useRef, useState } from "react";

const steps = [
  {
    label: "Today",
    title: ["Start with", "your classes."],
    copy: ["Add your courses once.", "See matches that fit your day."],
  },
  {
    label: "Sessions",
    title: ["Find the right", "study session."],
    copy: ["Search by class, place, or person.", "Join when it works for you."],
  },
  {
    label: "Map",
    title: ["Pick the right", "study spot."],
    copy: ["Browse campus spots.", "Find a place that works now."],
  },
  {
    label: "Messages",
    title: ["Keep the", "conversation going."],
    copy: ["Message your study group.", "Stay in sync."],
  },
  {
    label: "You",
    title: ["Everything", "in one place."],
    copy: ["Classes, spots, and sessions.", "Ready when you are."],
  },
];

function SimulatorScreen({ activeStep }: { activeStep: number }) {
  return (
    <div className="sim-phone" data-active={activeStep} aria-label="Interactive Studi app preview">
      <div className="sim-phone-edge" aria-hidden="true" />
      <div className="sim-phone-screen">
        <div className="sim-statusbar" aria-hidden="true">
          <span>9:41</span>
          <span className="sim-island" />
          <span>●◔▰</span>
        </div>

        <section className="sim-screen sim-screen--today" aria-hidden={activeStep !== 0}>
          <div className="sim-today-header">
            <span>Friday, Jul 10</span>
            <strong>Good afternoon, Studi</strong>
            <b>SS</b>
          </div>
          <div className="sim-today-empty">
            <i aria-hidden="true"><span /><span /><span /></i>
            <strong>Make it yours</strong>
            <p>Add your classes to see sessions that match.</p>
            <b>Add classes</b>
          </div>
        </section>

        <section className="sim-screen sim-screen--sessions" aria-hidden={activeStep !== 1}>
          <div className="sim-screen-heading sim-screen-heading--app">
            <strong>Sessions</strong>
            <p>3 upcoming sessions <b>Refresh</b></p>
          </div>
          <div className="sim-search-field"><b aria-hidden="true">⌕</b>Search course, title, place, or person</div>
          <div className="sim-session-filters">
            <span>Today</span>
            <i>•&nbsp; COMP</i>
            <i className="sim-filter-math">•&nbsp; MATH</i>
          </div>
          <div className="sim-session-list">
            <div className="sim-session-card">
              <span className="sim-course-chip sim-course-chip--neutral"><i />COMP SCI 400</span>
              <strong>COMP SCI 400 Study Session</strong>
              <p>Wed, Jul 15 · 12:00 PM–2:00 PM · Morgridge Hall</p>
              <div><span>●&nbsp; 2 going</span><em>SS</em><small>Hosted by Studi</small><b>✓ Going</b></div>
            </div>
            <div className="sim-session-card">
              <span className="sim-course-chip sim-course-chip--neutral"><i />COMP SCI 400</span>
              <strong>AVL Trees</strong>
              <p>Mon, Jul 27 · 4:00 PM–5:30 PM · Union South</p>
              <div><span>●&nbsp; 1 going</span><em>SS</em><small>Hosted by Studi</small><b>Join</b></div>
            </div>
            <div className="sim-session-card sim-session-card--last">
              <span className="sim-course-chip sim-course-chip--math"><i />MATH 320</span>
              <strong>Review for the second midterm</strong>
              <p>Wed, Jul 29 · 4:00 PM–5:30 PM · Memorial Union</p>
              <div><span>●&nbsp; 1 going</span><em>SS</em><small>Hosted by Studi</small><b>Join</b></div>
            </div>
          </div>
        </section>

        <section className="sim-screen sim-screen--spots" aria-hidden={activeStep !== 2}>
          <div className="sim-screen-heading sim-screen-heading--app">
            <strong>Study spots</strong>
            <p>22 spots around campus</p>
          </div>
          <div className="sim-search-field"><b aria-hidden="true">⌕</b>Search sessions or study spots</div>
          <div className="sim-filter-rail">
            <span className="is-selected">All spots</span>
            <span>Live now</span>
            <span>Next hour</span>
          </div>
          <div className="sim-campus-map" aria-label="Campus map with study spot pins">
            <span className="sim-map-lake sim-map-lake--top" />
            <span className="sim-map-lake sim-map-lake--bottom" />
            <span className="sim-map-road sim-map-road--one" />
            <span className="sim-map-road sim-map-road--two" />
            <span className="sim-map-label sim-map-label--one">Picnic Point</span>
            <span className="sim-map-label sim-map-label--two">University of<br />Wisconsin</span>
            <span className="sim-map-label sim-map-label--three">Camp Randall</span>
            <i className="sim-map-pin sim-map-pin--one" />
            <i className="sim-map-pin sim-map-pin--two" />
            <i className="sim-map-pin sim-map-pin--three" />
            <i className="sim-map-pin sim-map-pin--four" />
            <i className="sim-map-pin sim-map-pin--five" />
            <b className="sim-map-provider">UW layers ↗</b>
          </div>
          <div className="sim-spot-sheet">
            <span>Study spots</span>
            <p>Select from the list for details and ratings.</p>
            <strong>Business Learning Commons <i>Details</i></strong>
          </div>
        </section>

        <section className="sim-screen sim-screen--messages" aria-hidden={activeStep !== 3}>
          <div className="sim-messages-heading">Messages</div>
          <div className="sim-search-field"><b aria-hidden="true">⌕</b>Search messages</div>
          <div className="sim-message-row">
            <span>SS</span>
            <div><strong>Studi Student</strong><p>See you there!</p></div>
            <time>1:11 PM</time>
          </div>
        </section>

        <section className="sim-screen sim-screen--profile" aria-hidden={activeStep !== 4}>
          <div className="sim-profile-head">
            <span>SS <i>✓</i></span>
            <strong>Studi Student <b>●</b></strong>
            <small>Verified @wisc.edu</small>
            <em>Done</em>
          </div>
          <div className="sim-profile-stats">
            <span><b>1</b>Joined</span>
            <span><b>0</b>Hosted</span>
            <span><b>2</b>Classes</span>
            <span><b>0</b>Matches</span>
          </div>
          <div className="sim-profile-section">
            <span>Current classes <b>Done</b></span>
            <div className="sim-profile-class"><i>•&nbsp; ECON 100</i><strong>Economic approaches</strong><b>0 active</b></div>
            <div className="sim-profile-class"><i>•&nbsp; ECON 101</i><strong>Principles of microeconomics</strong><b>0 active</b></div>
          </div>
          <div className="sim-profile-section">
            <div className="sim-profile-editor">
              <strong>Your classes</strong>
              <p>You&apos;ll see sessions for 2 classes.</p>
              <span>Search UW courses</span>
              <i>•&nbsp; ECON 100&nbsp;&nbsp;&nbsp; Economic approaches&nbsp;&nbsp; ×</i>
              <i>•&nbsp; ECON 101&nbsp;&nbsp;&nbsp; Principles of microeconomics&nbsp;&nbsp; ×</i>
            </div>
          </div>
        </section>

        <div className="sim-tabbar" aria-hidden="true">
          <span className={activeStep === 0 ? "sim-tab-active" : ""}>⌂<i>Today</i></span>
          <span className={activeStep === 1 ? "sim-tab-active" : ""}>▦<i>Sessions</i></span>
          <span className={activeStep === 2 ? "sim-tab-active" : ""}>⌖<i>Map</i></span>
          <span className={activeStep === 3 ? "sim-tab-active" : ""}>●<i>Messages</i></span>
          <span className={activeStep === 4 ? "sim-tab-active" : ""}>●<i>You</i></span>
        </div>
        <span className="sim-home-indicator" aria-hidden="true" />
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

      <section className="how-story" aria-label="How Studi works across five app tabs">
        <div className="how-phone-column" id="app-preview">
          <div className="how-phone-wrap">
            <div className="sim-glow sim-glow--one" aria-hidden="true" />
            <div className="sim-glow sim-glow--two" aria-hidden="true" />
            <div className="how-mobile-scroll-hint" aria-hidden="true">
              <span>Scroll to explore</span>
              <strong>0{activeStep + 1} / 05</strong>
              <i />
            </div>
            <SimulatorScreen activeStep={activeStep} />
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
            <div className="how-mobile-step" key={steps[activeStep].label} aria-live="polite">
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
            <em>Less planning.</em>
            <span>Show up</span>
            <strong>together.</strong>
          </h2>
          <span className="how-closing-note">Launching Fall 2026 at UW–Madison</span>
        </div>
      </section>
    </article>
  );
}
