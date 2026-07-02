const contactEmail = "isp.studi@gmail.com";

export default function Home() {
  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">Studi for students</p>
        <h1>Study smarter with students in your classes.</h1>
        <p className="lead">
          Studi helps college students discover study sessions, coordinate with classmates,
          and find reliable campus study spots.
        </p>
        <div className="actions">
          <span className="coming-soon">Launching Fall 2026 at UW–Madison</span>
          <a className="text-link" href={`mailto:${contactEmail}`}>
            {contactEmail}
          </a>
        </div>
      </div>
      <div className="spotlight" aria-label="Studi preview">
        <div className="spotlight-card">
          <span className="status-dot" />
          <p className="card-kicker">Tonight</p>
          <h2>CS 400 Exam Prep</h2>
          <p>Memorial Library, 7:30 PM</p>
        </div>
        <div className="spotlight-row">
          <div>
            <p className="card-kicker">Nearby spot: College Library</p>
          </div>
          <span>Open late</span>
        </div>
      </div>
    </section>
  );
}
