const contactEmail = "isp.studi@gmail.com";

const sections = [
  {
    title: "Overview",
    body: [
      "Studi helps UW-Madison students find study partners, coordinate study sessions, and browse campus study locations. We collect only the information needed to provide those features. Studi does not sell personal information and does not use third-party advertising or cross-app tracking.",
    ],
  },
  {
    title: "Information We Collect",
    items: [
      "Account information, including email address, display name, and sign-in provider details.",
      "Profile information you choose to add, including your display name and classes.",
      "Study activity you create in the app, including sessions, session participation, messages, reports, blocks, and study location ratings.",
      "Technical data needed to operate the app, such as authentication state, timestamps, and Firebase service logs.",
    ],
  },
  {
    title: "How We Use Information",
    items: [
      "Create and secure your account.",
      "Show study sessions relevant to your classes.",
      "Show sessions, messages, location ratings, and profile details to the people who need them for app features.",
      "Investigate reports, prevent abuse, debug issues, and keep the service reliable.",
    ],
  },
  {
    title: "Sharing and Service Providers",
    body: [
      "Studi uses Firebase services from Google for authentication and cloud data storage. Data is shared with service providers only as needed to operate Studi. We do not share personal information with advertising networks or data brokers.",
    ],
  },
  {
    title: "Retention and Deletion",
    body: [
      "Account and profile data is retained while your account is active. If you delete your account from Profile, Studi removes your account data from the app database and deletes the Firebase Authentication account. Some limited records may be retained if required for security, abuse prevention, or legal reasons.",
    ],
  },
  {
    title: "Your Choices",
    items: [
      "You can edit your display name and classes from Profile.",
      "You can delete your account from Profile > Account actions > Delete Account.",
      "You can contact us to request access, correction, deletion, or consent withdrawal help.",
    ],
  },
  {
    title: "Children and Sensitive Data",
    body: [
      "Studi is intended for college students and is not directed to children under 13. Studi does not request HealthKit data, precise location tracking, payment card information, or government identifiers.",
    ],
  },
  {
    title: "Contact",
    body: [`For privacy questions or data requests, contact ${contactEmail}.`],
  },
];

export default function PrivacyPage() {
  return (
    <article className="content-page">
      <div className="page-heading">
        <p className="eyebrow">Privacy Policy</p>
        <h1>Studi Privacy Policy</h1>
        <p className="lead">Last Updated: June 28, 2026</p>
      </div>

      <div className="section-stack">
        {sections.map((section) => (
          <section className="info-section" key={section.title}>
            <h2>{section.title}</h2>
            {section.body?.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.items ? (
              <ul>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </article>
  );
}
