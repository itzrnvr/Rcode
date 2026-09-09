import {
  PromptInput,
  type PromptInputMessage,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";

import { useApp } from "../../state/AppContext";
import { useProviders } from "../../state/useProviders";
import { MicIcon, PlusIcon } from "../common/Icons";
import { useCallback, useEffect, useState } from "react";

type AgentMode = "plan" | "full-access" | "restricted";

const MODES: Array<{ value: AgentMode; label: string }> = [
  { value: "full-access", label: "Full access" },
  { value: "plan", label: "Plan" },
  { value: "restricted", label: "Restricted" },
];

const EFFORTS = ["low", "medium", "high", "max"] as const;

interface AgentPromptInputProps {
  disabled?: boolean;
  onSend: (text: string, meta?: { mode?: string; reasoningEffort?: string }) => void;
  onStop?: () => void;
  streaming?: boolean;
}

export function AgentPromptInput({
  disabled = false,
  onSend,
  onStop,
  streaming = false,
}: AgentPromptInputProps) {
  const { settings, setSetting } = useApp();
  const { allModels } = useProviders();
  const [mode, setMode] = useState<AgentMode>("full-access");
  const [effort, setEffort] = useState<string>(settings.reasoningEffort || "max");

  useEffect(() => {
    if (allModels.length > 0 && !allModels.some(model => model.id === settings.model)) {
      const first = allModels[0];
      setSetting("model", first.id);
      setSetting("providerName", first.provider);
    }
  }, [allModels, setSetting, settings.model]);

  const handleSubmit = useCallback(
    ({ text }: PromptInputMessage) => {
      const trimmed = text.trim();
      if (!trimmed || disabled) return;
      onSend(trimmed, { mode, reasoningEffort: effort });
    },
    [disabled, effort, mode, onSend]
  );

  return (
    <PromptInput className="rcode-prompt-input" onSubmit={handleSubmit}>
      <PromptInputBody>
        <PromptInputTextarea
          disabled={disabled}
          name="message"
          placeholder="Do anything"
        />
      </PromptInputBody>
      <PromptInputFooter>
        <PromptInputTools>
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger>
              <PlusIcon size={16} />
            </PromptInputActionMenuTrigger>
            <PromptInputActionMenuContent>
              <PromptInputActionAddAttachments />
              <PromptInputActionAddScreenshot />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>

          <PromptInputSelect
            onValueChange={value => setMode(String(value) as AgentMode)}
            value={mode}
          >
            <PromptInputSelectTrigger>
              <PromptInputSelectValue />
            </PromptInputSelectTrigger>
            <PromptInputSelectContent>
              {MODES.map(option => (
                <PromptInputSelectItem key={option.value} value={option.value}>
                  {option.label}
                </PromptInputSelectItem>
              ))}
            </PromptInputSelectContent>
          </PromptInputSelect>

          <PromptInputSelect
            onValueChange={value => {
              const nextEffort = String(value);
              setEffort(nextEffort);
              setSetting("reasoningEffort", nextEffort);
            }}
            value={effort}
          >
            <PromptInputSelectTrigger>
              <PromptInputSelectValue />
            </PromptInputSelectTrigger>
            <PromptInputSelectContent>
              {EFFORTS.map(value => (
                <PromptInputSelectItem key={value} value={value}>
                  {value === "max" ? "Max" : value[0].toUpperCase() + value.slice(1)}
                </PromptInputSelectItem>
              ))}
            </PromptInputSelectContent>
          </PromptInputSelect>

          <PromptInputSelect
            onValueChange={value => {
              const model = allModels.find(item => item.id === String(value));
              if (model) {
                setSetting("model", model.id);
                setSetting("providerName", model.provider);
              }
            }}
            value={settings.model}
          >
            <PromptInputSelectTrigger>
              <PromptInputSelectValue />
            </PromptInputSelectTrigger>
            <PromptInputSelectContent>
              {allModels.map(model => (
                <PromptInputSelectItem key={model.id} value={model.id}>
                  {model.name}
                </PromptInputSelectItem>
              ))}
            </PromptInputSelectContent>
          </PromptInputSelect>

          <PromptInputButton tooltip="Voice input">
            <MicIcon size={16} />
          </PromptInputButton>
        </PromptInputTools>
        <PromptInputSubmit
          disabled={disabled && !streaming}
          onStop={onStop}
          status={streaming ? "streaming" : undefined}
        />
      </PromptInputFooter>
    </PromptInput>
  );
}
