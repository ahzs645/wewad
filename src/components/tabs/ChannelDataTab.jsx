import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeChannelData, channelForTitleId, CHANNELS } from "../../channels/index.js";
import { probeChannelData } from "../../channels/probe.js";
import { channelDefinition, CHANNEL_DEFINITION_NAMES } from "../../channels/manifest.js";
import { renderNewsChannel } from "../../channels/renderNewsChannel.js";
import { renderForecastChannel } from "../../channels/renderForecastChannel.js";
import { renderEverybodyVotesChannel } from "../../channels/renderEverybodyVotesChannel.js";

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const RENDERERS = {
  news: renderNewsChannel,
  forecast: renderForecastChannel,
  everybodyVotes: renderEverybodyVotesChannel,
};

// The Channel Data tab: a probing interface for the feeds a channel downloads at
// runtime (news.bin, forecast.bin). It decodes a file into the shared envelope,
// probes its binary structure, renders it with GSAP, and lets you download both
// the decoded JSON and the structure report.
export function ChannelDataTab({ wadTitleId }) {
  const [channel, setChannel] = useState("auto");
  const [fileName, setFileName] = useState("");
  const [decoded, setDecoded] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [view, setView] = useState("render");

  const mountRef = useRef(null);
  const controllerRef = useRef(null);
  const fileInputRef = useRef(null);

  const detectedChannel = useMemo(() => channelForTitleId(wadTitleId), [wadTitleId]);
  const resolveChannel = useCallback(
    () => (channel === "auto" ? detectedChannel ?? "news" : channel),
    [channel, detectedChannel],
  );

  const loadFile = useCallback(
    async (file) => {
      if (!file) return;
      setFileName(file.name);
      setError("");
      try {
        const buffer = new Uint8Array(await file.arrayBuffer());
        if (file.name.toLowerCase().endsWith(".json")) {
          // Already a decoded envelope — render only, no binary to probe.
          setDecoded(JSON.parse(new TextDecoder().decode(buffer)));
          setReport(null);
        } else {
          const ch = resolveChannel();
          setDecoded(decodeChannelData(buffer, { channel: ch }));
          setReport(probeChannelData(buffer, { channel: ch }));
        }
        setView("render");
      } catch (caught) {
        setError(caught?.message ?? String(caught));
        setDecoded(null);
        setReport(null);
      }
    },
    [resolveChannel],
  );

  // Mount/teardown the GSAP renderer when the decoded data or view changes.
  useEffect(() => {
    controllerRef.current?.destroy?.();
    controllerRef.current = null;
    if (view !== "render" || !decoded || !mountRef.current) {
      return undefined;
    }
    const renderer = RENDERERS[decoded.channel];
    if (renderer) {
      controllerRef.current = renderer(decoded, mountRef.current);
    }
    return () => {
      controllerRef.current?.destroy?.();
      controllerRef.current = null;
    };
  }, [decoded, view]);

  const download = useCallback(
    (obj, suffix) => downloadJSON(obj, `${(fileName || "channel").replace(/\.[^.]+$/, "")}.${suffix}.json`),
    [fileName],
  );

  return (
    <div className="tab-content active">
      <div className="section-title">Channel Data</div>
      <p className="empty-state" style={{ marginBottom: 16 }}>
        Probe and render a channel's downloaded feed (news.bin / forecast.bin), or load a decoded
        .json envelope. Distinct from the banner graphics in the WAD — see docs/CHANNEL_DATA_FORMAT.md.
      </p>

      <div className="channel-data-controls">
        <input
          ref={fileInputRef}
          type="file"
          accept=".bin,.json"
          style={{ display: "none" }}
          onChange={(event) => loadFile(event.target.files?.[0])}
        />
        <button type="button" className="cd-btn" onClick={() => fileInputRef.current?.click()}>
          Load .bin / .json
        </button>

        <label className="cd-field">
          Channel
          <select value={channel} onChange={(event) => setChannel(event.target.value)}>
            <option value="auto">
              Auto{detectedChannel ? ` (${CHANNELS[detectedChannel].label})` : ""}
            </option>
            <option value="news">News</option>
            <option value="forecast">Forecast</option>
            <option value="everybodyVotes">Everybody Votes</option>
          </select>
        </label>

        {fileName ? <span className="cd-filename">{fileName}</span> : null}

        <div className="cd-downloads">
          <button type="button" className="cd-btn ghost" disabled={!decoded} onClick={() => download(decoded, "envelope")}>
            ↓ envelope.json
          </button>
          <button type="button" className="cd-btn ghost" disabled={!report} onClick={() => download(report, "probe")}>
            ↓ probe.json
          </button>
        </div>
      </div>

      <div className="cd-definitions">
        <span className="cd-definitions-label">Channel definitions (structure + rendering):</span>
        {CHANNEL_DEFINITION_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            className="cd-btn ghost"
            onClick={() => downloadJSON(channelDefinition(name), `${name}.definition.json`)}
          >
            ↓ {name}.json
          </button>
        ))}
      </div>

      {error ? <div className="cd-error">Could not decode as {resolveChannel()}: {error}</div> : null}

      {decoded ? (
        <>
          <div className="cd-view-toggle">
            {["render", "structure", "json"].map((mode) => (
              <button
                key={mode}
                type="button"
                className={`tab ${view === mode ? "active" : ""}`}
                onClick={() => setView(mode)}
                disabled={mode === "structure" && !report}
              >
                {mode[0].toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>

          {view === "render" ? <div className="channel-render" ref={mountRef} /> : null}

          {view === "structure" && report ? <StructureReport report={report} /> : null}

          {view === "json" ? (
            <pre className="info-panel info-pre cd-json">{JSON.stringify(decoded, null, 2)}</pre>
          ) : null}
        </>
      ) : (
        <div className="empty-state">No channel data loaded.</div>
      )}
    </div>
  );
}

function StructureReport({ report }) {
  const { container, header, tables } = report;
  return (
    <div className="cd-structure">
      <div className="info-panel">
        <div>
          <span className="key">channel</span> <span className="val">{report.channel}</span> ·{" "}
          <span className="key">container</span> <span className="val">{container.size} B</span> ·{" "}
          <span className="key">crc32</span>{" "}
          <span className="val">{container.crc32.stored}</span>{" "}
          <span className={container.crc32.valid ? "cd-ok" : "cd-bad"}>
            {container.crc32.valid ? "valid" : `MISMATCH (${container.crc32.computed})`}
          </span>{" "}
          · <span className="key">blob</span>{" "}
          <span className="val">{container.blobBytes} B @ {container.blobOffset}</span>
        </div>
      </div>

      <div className="section-title">Header</div>
      <table className="cd-table">
        <thead>
          <tr><th>offset</th><th>type</th><th>field</th><th>value</th></tr>
        </thead>
        <tbody>
          {header.fields.map((field) => (
            <tr key={field.name}>
              <td>0x{field.offset.toString(16).toUpperCase()}</td>
              <td>{field.type}</td>
              <td>{field.name}</td>
              <td>{String(field.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="section-title">Tables</div>
      <div className="cd-tables">
        {tables.map((table) => (
          <div className={`cd-card ${table.count === 0 ? "empty" : ""}`} key={table.name}>
            <div className="cd-card-head">
              <span className="cd-card-name">{table.name}</span>
              <span className="cd-card-meta">
                {table.count} × {table.entrySize ?? "?"} B
                {table.totalBytes != null ? ` = ${table.totalBytes} B` : ""} @ {table.offset}
              </span>
            </div>
            {table.firstEntryHex ? <div className="cd-hex">{table.firstEntryHex}</div> : null}
            {table.entrySize == null ? <div className="cd-note">{table.decoded}</div> : null}
            {table.inferred?.entrySize ? (
              <div className="cd-inferred">
                <div className="cd-inferred-head">inferred entry: {table.inferred.entrySize} B</div>
                {table.inferred.slots.map((slot) => (
                  <div key={slot.offset} className="cd-inferred-slot">
                    <span>@{slot.offset}</span> <span className="cd-slot-type">{slot.type}</span>
                    {slot.value !== undefined ? ` =${slot.value}` : ` [${slot.sampleValues.join(", ")}]`}
                  </div>
                ))}
              </div>
            ) : null}
            {table.inferred?.note ? <div className="cd-note">{table.inferred.note}</div> : null}
            {table.samples?.length ? (
              <pre className="cd-sample">{JSON.stringify(table.samples[0], null, 1)}</pre>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
