export function LogTab({ logEntries }) {
  return (
    <div className="tab-content active">
      <div className="section-title">Parse Log</div>
      <div className="log">
        {logEntries.map((entry, index) => (
          <div className={entry.level} key={`${entry.level}-${index}`}>
            [{entry.level.toUpperCase()}] {entry.message}
          </div>
        ))}
      </div>
    </div>
  );
}
