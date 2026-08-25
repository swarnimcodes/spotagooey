import { Select } from "@base-ui/react/select";
import "./ThemedSelect.css";

export interface SelectOption {
  value: string;
  label: string;
}

interface ThemedSelectProps {
  label: string;
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  compact?: boolean;
}

export function ThemedSelect({
  label,
  value,
  options,
  onValueChange,
  compact = false,
}: ThemedSelectProps) {
  return (
    <Select.Root
      items={options}
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue !== null) onValueChange(nextValue);
      }}
    >
      <div className={`themed-select${compact ? " compact" : ""}`}>
        <Select.Label className="themed-select-label">{label}</Select.Label>
        <Select.Trigger className="themed-select-trigger">
          <Select.Value className="themed-select-value" />
          <Select.Icon className="themed-select-icon" aria-hidden="true">
            <svg viewBox="0 0 12 8" width="12" height="8">
              <path d="m1.5 1.5 4.5 4 4.5-4" />
            </svg>
          </Select.Icon>
        </Select.Trigger>
      </div>

      <Select.Portal>
        <Select.Positioner
          className="themed-select-positioner"
          align="start"
          alignItemWithTrigger={false}
          sideOffset={6}
        >
          <Select.Popup className="themed-select-popup">
            <Select.ScrollUpArrow className="themed-select-scroll-arrow">▲</Select.ScrollUpArrow>
            <Select.List className="themed-select-list">
              {options.map((option) => (
                <Select.Item
                  className="themed-select-item"
                  key={option.value}
                  value={option.value}
                >
                  <Select.ItemText className="themed-select-item-text">
                    {option.label}
                  </Select.ItemText>
                  <Select.ItemIndicator className="themed-select-indicator">
                    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
                      <path d="m2.5 7.5 3 3 6-7" />
                    </svg>
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
            <Select.ScrollDownArrow className="themed-select-scroll-arrow">▼</Select.ScrollDownArrow>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
