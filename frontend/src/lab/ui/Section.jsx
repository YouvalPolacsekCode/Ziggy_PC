// Motion Lab — section intro: the principle, and what the investigation found
// in the real app that this section answers.
export function SectionIntro({ title, lede, found = [], children }) {
  return (
    <div className="ml-section__intro">
      <h2>{title}</h2>
      {lede && <p>{lede}</p>}
      {found.length > 0 && (
        <div className="ml-found">
          <strong>What the app does today</strong>
          <ul>{found.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </div>
      )}
      {children}
    </div>
  )
}
