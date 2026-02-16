export function LayoutTab({ layoutInfo, animationInfo }) {
  return (
    <div className="tab-content active">
      <div className="section-title">BRLYT Layout Data</div>
      <pre className="info-panel info-pre">{layoutInfo}</pre>
      <div className="section-title icon-title">BRLAN Animation Data</div>
      <pre className="info-panel info-pre">{animationInfo}</pre>
    </div>
  );
}
