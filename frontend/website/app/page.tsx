const contactEmail = "isp.studi@gmail.com";

export default function Home() {
  return (
    <section className="hero">
      <div className="hero-copy">
        <h1 className="hero-title">
          Study <em>smarter</em>
          <span className="title-secondary">with students</span>
          <span className="title-tertiary">in your classes.</span>
        </h1>
        <p className="lead">
          Studi helps college students <strong>discover study sessions</strong>, coordinate with
          classmates, and find reliable campus study spots.
        </p>
        <div className="actions">
          <span className="coming-soon">Launching Fall 2026 at UW–Madison</span>
          <a className="text-link" href={`mailto:${contactEmail}`}>
            {contactEmail}
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
      <div className="spotlight" aria-label="Studi preview">
        <div className="spotlight-orbit orbit-one" aria-hidden="true" />
        <div className="spotlight-orbit orbit-two" aria-hidden="true" />
        <div className="spotlight-card">
          <div className="card-topline">
            <p className="card-kicker">Tonight</p>
            <span className="live-status">
              <span className="status-dot" />
              3 spots left
            </span>
          </div>
          <div className="card-content">
            <p className="card-class">CS 400</p>
            <h2>Exam Prep</h2>
            <p>Memorial Library · 7:30 PM</p>
          </div>
          <div className="avatar-stack" aria-label="Three students are going">
            <span>AM</span>
            <span>JL</span>
            <span>+1</span>
          </div>
        </div>
        <div className="spotlight-row">
          <div className="location-mark" aria-hidden="true">
            <span />
          </div>
          <div className="spotlight-location">
            <p className="card-kicker">Nearby spot: College Library</p>
            <p>Quiet floor</p>
          </div>
          <span className="open-label">Open late</span>
        </div>
      </div>
    </section>
  );
}
