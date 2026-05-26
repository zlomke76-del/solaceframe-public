const sceneStates = [
  {
    id: "scene-001",
    title: "Market evacuation",
    summary: "Elena exits the lower market while the eastern bridge fails behind her.",
    consequences: ["left-arm-injury", "eastern-transit-bridge-damaged"],
    admissibility: "admissible"
  },
  {
    id: "scene-002",
    title: "Source file withheld",
    summary: "Ren chooses not to disclose the origin of the courier case.",
    consequences: ["trust-fracture-with-ren", "withheld-information"],
    admissibility: "conditional"
  }
];

const driftSignals = [
  {
    type: "identity",
    severity: "low",
    message: "Elena facial structure remains within accepted continuity bounds."
  },
  {
    type: "timeline",
    severity: "medium",
    message: "Scene 003 must preserve left-arm injury from bridge collapse."
  }
];

const branches = [
  {
    id: "branch-prime",
    name: "Prime Continuity",
    integrity: 94,
    status: "active"
  },
  {
    id: "branch-evacuation-fails",
    name: "Evacuation Failure Variant",
    integrity: 82,
    status: "requires review"
  },
  {
    id: "branch-ren-discloses",
    name: "Ren Disclosure Variant",
    integrity: 89,
    status: "active"
  }
];

const metrics = [
  { label: "Continuity score", value: "84%" },
  { label: "Active scenes", value: "2" },
  { label: "Timeline events", value: "2" },
  { label: "Reality branches", value: "3" }
];

const navItems = [
  "Scene State",
  "Characters",
  "Worlds",
  "Timeline",
  "Branches",
  "Drift",
  "Memory",
  "Provenance"
];

export default function Page() {
  return (
    <main className="sf-shell">
      <aside className="sf-sidebar">
        <div className="sf-eyebrow">Moral Clarity AI</div>
        <div className="sf-logo">SolaceFrame</div>
        <p className="sf-muted">
          Governed synthetic media with persistent causal continuity.
        </p>

        <nav className="sf-nav">
          {navItems.map((item, index) => (
            <div className="sf-nav-item" key={item}>
              <span className="sf-nav-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>{item}</span>
            </div>
          ))}
        </nav>
      </aside>

      <section className="sf-main">
        <div className="sf-topbar">
          <div>
            <div className="sf-eyebrow">SolaceFrame V5 · Living Continuity Engine</div>
            <h1 className="sf-title">
              Persistent synthetic worlds where consequences survive the next render.
            </h1>
          </div>

          <div className="sf-status-pill">
            <span className="sf-pulse" />
            <span>State evolution active</span>
          </div>
        </div>

        <div className="sf-grid">
          <section className="sf-card sf-card-pad">
            <div className="sf-eyebrow">Scene State Engine</div>
            <h2 className="sf-card-title">Causal persistence is now part of the generation context.</h2>
            <p className="sf-muted">
              V5 tracks scene consequences, unresolved tensions, branch state,
              and next-generation constraints before future renders are prepared.
            </p>

            <div className="sf-metrics">
              {metrics.map((metric) => (
                <div className="sf-metric" key={metric.label}>
                  <div className="sf-metric-value">{metric.value}</div>
                  <div className="sf-metric-label">{metric.label}</div>
                </div>
              ))}
            </div>

            <div className="sf-scene-stack">
              {sceneStates.map((scene) => (
                <div className="sf-scene-row" key={scene.id}>
                  <strong>{scene.title}</strong>
                  <div>
                    <div>{scene.summary}</div>
                    <div className="sf-consequence">
                      Consequences: {scene.consequences.join(", ")}
                    </div>
                  </div>
                  <span className="sf-tag">{scene.admissibility}</span>
                </div>
              ))}
            </div>
          </section>

          <aside className="sf-side-stack">
            <section className="sf-card sf-card-pad">
              <div className="sf-eyebrow">Continuity Drift</div>
              <h2 className="sf-card-title">watch</h2>

              <div className="sf-bar">
                <div className="sf-bar-fill" style={{ width: "84%" }} />
              </div>

              <div className="sf-branch-list">
                {driftSignals.map((signal) => (
                  <div className="sf-branch" key={signal.message}>
                    <div className="sf-branch-top">
                      <strong>{signal.type}</strong>
                      <span className="sf-muted">{signal.severity}</span>
                    </div>
                    <div className="sf-muted">{signal.message}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="sf-card sf-card-pad">
              <div className="sf-eyebrow">Reality Branches</div>

              <div className="sf-branch-list">
                {branches.map((branch) => (
                  <div className="sf-branch" key={branch.id}>
                    <div className="sf-branch-top">
                      <strong>{branch.name}</strong>
                      <span className="sf-muted">{branch.integrity}%</span>
                    </div>
                    <div className="sf-muted">{branch.status}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="sf-card sf-card-pad">
              <div className="sf-eyebrow">Compressed Memory</div>
              <div className="sf-memory-box">
                Two scenes are active in Prime Continuity. The world state must
                preserve prior physical damage, character injury, degraded trust,
                and persistent object lineage.
                <br />
                <br />
                <strong>Next constraints:</strong>
                <br />
                Elena must retain her left-arm injury. Eastern bridge damage
                must remain visible or be narratively repaired. Ren and Elena
                cannot reset to neutral trust. The yellow courier case remains
                a persistent object.
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
