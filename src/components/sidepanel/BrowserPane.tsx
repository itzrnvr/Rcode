import { useMemo, useRef, useState } from "react";
import { GlobeIcon, RefreshIcon } from "../common/Icons";

function BrowserPane() {
  const reloadKeyRef = useRef(0);
  const [reloadKey, setReloadKey] = useState(0);
  const url = useMemo(() => {
    // The preview entry shares the top frame's Electron bridge, so the embedded
    return new URL("preview.html", window.location.href).href;
  }, []);

  const reload = () => {
    reloadKeyRef.current += 1;
    setReloadKey(reloadKeyRef.current);
  };

  return (
    <div className="browser-pane">
      <div className="browser-pane-bar">
        <GlobeIcon size={14} />
        <span className="browser-pane-url">{url}</span>
        <button
          className="browser-pane-reload"
          aria-label="Reload preview"
          onClick={reload}
          title="Reload preview"
          type="button"
        >
          <RefreshIcon size={13} />
        </button>
      </div>
      <div className="browser-pane-frame">
        <iframe
          key={reloadKey}
          src={url}
          title="Rcode dev preview"
        />
      </div>
    </div>
  );
}

export { BrowserPane };



