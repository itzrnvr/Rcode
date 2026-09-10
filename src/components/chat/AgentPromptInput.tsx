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
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { useApp } from "../../state/AppContext";
import { useProviders } from "../../state/useProviders";
import {
  ChevronDownIcon,
  CompassIcon,
  GlobeIcon,
  LockIcon,
  MicIcon,
  PlusIcon,
} from "../common/Icons";
import { useCallback, useEffect, useMemo, useState } from "react";

type AgentMode = "plan" | "full-access" | "restricted";

const MODES: Array<{ value: AgentMode; label: string; Icon: React.FC<{ size?: number; className?: string }> }> = [
  { value: "full-access", label: "Full access", Icon: GlobeIcon },
  { value: "plan", label: "Plan", Icon: CompassIcon },
  { value: "restricted", label: "Restricted", Icon: LockIcon },
];

const EFFORTS = ["low", "medium", "high", "max"] as const;

export function AgentPromptInput({
  disabled = false,
  onSend,
  onStop,
  streaming = false,
}: {
  disabled?: boolean;
  onSend: (text: string, meta?: { mode?: string; reasoningEffort?: string }) => void;
  onStop?: () => void;
  streaming?: boolean;
}) {
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
      setModelOpen(false);
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

        <PromptInputFooter className="rcode-prompt-footer">
          <PromptInputTools className="rcode-prompt-tools">
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger>
                <PlusIcon size={16} />
              </PromptInputActionMenuTrigger>
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments />
                <PromptInputActionAddScreenshot />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>

            <div className="rcode-mode-select">
              <PromptInputSelect
                onValueChange={value => setMode(String(value) as AgentMode)}
                value={mode}
              >
                <PromptInputSelectTrigger
                  aria-label="Agent access mode"
                  className="rcode-composer-select"
                >
                  {(() => {
                    const ModeIcon = MODES.find(m => m.value === mode)?.Icon ?? GlobeIcon;
                    return <ModeIcon size={14} />;
                  })()}
                </PromptInputSelectTrigger>
                <PromptInputSelectContent align="start" className="rcode-mode-popup">
                  {MODES.map(option => (
                    <PromptInputSelectItem key={option.value} value={option.value}>
                      {option.label}
                    </PromptInputSelectItem>
                  ))}
                </PromptInputSelectContent>
              </PromptInputSelect>
            </div>
          </PromptInputTools>

          <PromptInputTools className="rcode-prompt-tools rcode-prompt-tools-right">
            <Popover open={modelOpen} onOpenChange={setModelOpen}>
              <PopoverTrigger
                render={
                  <PromptInputButton
                    className="rcode-composer-model-trigger"
                    tooltip="Choose model"
                  />
                }
              >
                <span className="rcode-model-trigger-name">
                  {currentModel?.name ?? "Select model"}
                </span>
                <ChevronDownIcon
                  size={12}
                  className="rcode-model-trigger-chevron"
                />
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="rcode-model-selector"
                side="bottom"
                sideOffset={8}
              >
                <Command className="border-none bg-transparent">
                  <CommandInput autoFocus placeholder="Search models…" />
                  <div className="rcode-effort-row">
                    {EFFORTS.map(value => (
                      <button
                        type="button"
                        key={value}
                        className={`rcode-effort-pill ${effort === value ? "active" : ""}`}
                        title={`Reasoning effort: ${value}`}
                        onClick={() => {
                          setEffort(value);
                          setSetting("reasoningEffort", value);
                        }}
                      >
                        {value === "max" ? "Max" : value[0].toUpperCase() + value.slice(1)}
                      </button>
                    ))}
                  </div>
                  <CommandList>
                    <CommandEmpty>No models match your search.</CommandEmpty>
                    {modelGroups.map(group => (
                      <CommandGroup heading={group.label} key={group.label}>
                        {group.models.map(model => {
                          const selected =
                            currentModel?.id === model.id &&
                            currentModel?.provider === model.provider;

                          return (
                            <CommandItem
                              data-checked={selected ? "true" : undefined}
                              key={`${model.provider}:${model.id}`}
                              onSelect={() => chooseModel(model)}
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
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            <PromptInputButton tooltip="Voice input">
              <MicIcon size={16} />
            </PromptInputButton>

            <PromptInputSubmit
              className="rcode-prompt-submit"
              disabled={disabled && !streaming}
              onStop={onStop}
              status={streaming ? "streaming" : undefined}
            />
          </PromptInputTools>
        </PromptInputFooter>
      </PromptInput>

    </>
  );
}
