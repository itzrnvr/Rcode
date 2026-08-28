/*
 * PURPOSE: Settings modal using Radix Dialog for accessibility
 *
 * Radix Dialog provides:
 * - Focus trap (Tab cycles within modal)
 * - Escape key dismissal
 * - Click-outside dismissal
 * - Auto-focus on first focusable element
 * - Proper ARIA roles (role="dialog", aria-labelledby, aria-describedby)
 * - Scroll lock on body while open
 */

import { useSettings } from "../../state/useSettings";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../primitives/RadixWrappers";
import { ThemeSettings } from "./ThemeSettings";
import { InstructionsEditor } from "./InstructionsEditor";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { settings, updateSetting } = useSettings();

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        title="Settings"
        description="Configure API connection, theme, and custom instructions."
        style={{ maxWidth: 720, maxHeight: "90vh" }}
      >
        <div className="settings-sections">
          {/* --- API Configuration --- */}
          <section className="settings-section">
            <h3 className="settings-h3">API Configuration</h3>

            <div className="settings-row">
              <label htmlFor="apiBase">API Base URL</label>
              <input
                id="apiBase"
                type="text"
                defaultValue={settings.apiBase}
                onBlur={e => updateSetting("apiBase", e.target.value)}
                placeholder="http://127.0.0.1:3490/v1"
              />
            </div>

            <div className="settings-row">
              <label htmlFor="apiKey">API Key</label>
              <input
                id="apiKey"
                type="password"
                defaultValue={settings.apiKey}
                onBlur={e => updateSetting("apiKey", e.target.value)}
                placeholder="sk-..."
              />
            </div>

            <div className="settings-row">
              <label htmlFor="defaultModel">Default Model</label>
              <input
                id="defaultModel"
                type="text"
                defaultValue={settings.model}
                onBlur={e => updateSetting("model", e.target.value)}
                placeholder="glm-5.2"
              />
            </div>

            <div className="settings-row">
              <label htmlFor="providerName">Provider Name</label>
              <input
                id="providerName"
                type="text"
                defaultValue={settings.providerName}
                onBlur={e => updateSetting("providerName", e.target.value)}
                placeholder="local-proxy"
              />
            </div>
          </section>

          {/* --- Theme --- */}
          <section className="settings-section">
            <ThemeSettings />
          </section>

          {/* --- Instructions --- */}
          <section className="settings-section">
            <InstructionsEditor />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}