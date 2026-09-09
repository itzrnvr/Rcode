import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorShortcut,
} from "@/components/ai-elements/model-selector";
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
import {
  ChevronDownIcon,
  CpuIcon,
  MicIcon,
  PlusIcon,
} from "../common/Icons";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  const [modelOpen, setModelOpen] = useState(false);
  const [mode, setMode] = useState<AgentMode>("full-access");
  const [effort, setEffort] = useState(settings.reasoningEffort || "max");

  const currentModel = allModels.find(model => model.id === settings.model);

  useEffect(() => {
    if (allModels.length > 0 && !currentModel) {
      setSetting("model", allModels[0].id);
      setSetting("providerName", allModels[0].provider);
    }
  }, [allModels, currentModel, setSetting]);

  const modelGroups = useMemo(() => {
    const byProvider = new Map<string, typeof allModels>();

    for (const model of allModels) {
      const group = byProvider.get(model.providerLabel) ?? [];
      group.push(model);
      byProvider.set(model.providerLabel, group);
    }

    return Array.from(byProvider.entries()).map(([label, models]) => ({
      label,
      models,
    }));
  }, [allModels]);

  const chooseModel = useCallback(
    (model: (typeof allModels)[number]) => {
      setSetting("model", model.id);
      setSetting("providerName", model.provider);
    },
    [setSetting]
  );

  const handleSubmit = useCallback(
    ({ text }: PromptInputMessage) => {
      const trimmed = text.trim();
      if (!trimmed || disabled) return;
      onSend(trimmed, { mode, reasoningEffort: effort });
    },
    [disabled, effort, mode, onSend]
  );

  return (
    <>
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
              <PromptInputSelectTrigger
                aria-label="Agent mode"
                className="rcode-composer-select"
              >
                <PromptInputSelectValue />
              </PromptInputSelectTrigger>
              <PromptInputSelectContent align="start">
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
              <PromptInputSelectTrigger
                aria-label="Reasoning effort"
                className="rcode-composer-select"
              >
                <PromptInputSelectValue />
              </PromptInputSelectTrigger>
              <PromptInputSelectContent align="start">
                {EFFORTS.map(value => (
                  <PromptInputSelectItem key={value} value={value}>
                    {value === "max" ? "Max" : value[0].toUpperCase() + value.slice(1)}
                  </PromptInputSelectItem>
                ))}
              </PromptInputSelectContent>
            </PromptInputSelect>

            <PromptInputButton
              aria-expanded={modelOpen}
              aria-haspopup="dialog"
              className="rcode-composer-model-trigger"
              onClick={() => setModelOpen(true)}
              tooltip="Choose model"
            >
              <CpuIcon size={14} />
              <span className="rcode-model-trigger-text">
                <span className="rcode-model-trigger-name">
                  {currentModel?.name ?? "Select model"}
                </span>
                <span className="rcode-model-trigger-provider">
                  {currentModel?.providerLabel ?? "Provider"}
                </span>
              </span>
              <ChevronDownIcon size={12} />
            </PromptInputButton>

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

      <ModelSelector onOpenChange={setModelOpen} open={modelOpen}>
        <ModelSelectorContent className="rcode-model-selector" title="Choose model">
          <ModelSelectorInput placeholder="Search models…" />
          <ModelSelectorList>
            <ModelSelectorEmpty>No models match your search.</ModelSelectorEmpty>
            {modelGroups.map(group => (
              <ModelSelectorGroup heading={group.label} key={group.label}>
                {group.models.map(model => {
                  const selected = currentModel?.id === model.id;

                  return (
                    <ModelSelectorItem
                      data-checked={selected ? "true" : undefined}
                      key={`${model.provider}:${model.id}`}
                      onSelect={() => {
                        chooseModel(model);
                        setModelOpen(false);
                      }}
                      value={`${model.provider}:${model.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {model.name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {model.description}
                        </div>
                      </div>
                      <ModelSelectorShortcut>{model.providerLabel}</ModelSelectorShortcut>
                    </ModelSelectorItem>
                  );
                })}
              </ModelSelectorGroup>
            ))}
          </ModelSelectorList>
        </ModelSelectorContent>
      </ModelSelector>
    </>
  );
}
