const contactEmail = "isp.studi@gmail.com";

const faqs = [
  {
    question: "Account/login issues",
    answer:
      "Make sure you are using the same email and sign-in method you used to create your Studi account. If you are still stuck, email support with the email address tied to your account.",
  },
  {
    question: "Email verification",
    answer:
      "Check your inbox and spam folder for the verification email. If it does not arrive, return to the app and request another verification email.",
  },
  {
    question: "Reporting a user",
    answer:
      "Use the report or block actions in the app when another user misuses Studi or makes you feel unsafe. You can also email support with details so we can review it.",
  },
  {
    question: "Account deletion",
    answer:
      "Open Profile, go to Account actions, and choose Delete Account. This removes your Studi account data and Firebase Authentication account.",
  },
  {
    question: "Bugs/crashes",
    answer:
      "Email support with what happened, the screen you were on, and your device type. Screenshots are helpful when you have them.",
  },
];

export default function SupportPage() {
  return (
    <article className="content-page support-page">
      <div className="page-heading">
        <p className="eyebrow">Support</p>
        <h1>
          How can we <em>help?</em>
        </h1>
        <p className="lead">Tell us what happened and we will get back to you.</p>
        <a className="support-email-card" href={`mailto:${contactEmail}`}>
          <span>
            <small>Email Studi support</small>
            {contactEmail}
          </span>
          <span className="mail-arrow" aria-hidden="true">
            ↗
          </span>
        </a>
      </div>

      <section className="faq-section">
        <div className="faq-heading">
          <p className="eyebrow">Quick answers</p>
          <h2>
            You might find it <em>right here.</em>
          </h2>
        </div>
        <div className="faq-list">
          {faqs.map((faq, index) => (
            <article className="faq-item" key={faq.question} data-reveal>
              <div className="faq-number">{String(index + 1).padStart(2, "0")}</div>
              <div>
                <h3>{faq.question}</h3>
                <p>{faq.answer}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </article>
  );
}
