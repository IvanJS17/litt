import { GoogleIconUI } from "../src/GoogleIconUI";
import {
    LITT_STATUS_MARK_HUES,
    LITT_STATUS_MARK_STATES,
    LittStatusMarkUI,
} from "../src/LittStatusMarkUI";

const meta = { title: "Shared UI / BrandIcons" };
export default meta;

const STATE_LABELS = {
    idle: "Idle",
    working: "Working",
    waiting: "Waiting",
    done: "Done",
    error: "Error",
} as const;

export const StatusMarkStates = () => (
    <div className="flex items-end gap-6 text-xs text-gray-500">
        {LITT_STATUS_MARK_STATES.map((state) => (
            <span key={state} className="flex flex-col items-center gap-2">
                <LittStatusMarkUI size={32} state={state} /> {STATE_LABELS[state]}
            </span>
        ))}
    </div>
);

export const StatusMarkSizes = () => (
    <div className="flex items-end gap-8 text-xs text-gray-500">
        {[14, 16, 22, 24, 32].map((size) => (
            <span key={size} className="flex flex-col items-center gap-2">
                <span className="flex gap-2">
                    <LittStatusMarkUI size={size} state="working" />
                    <LittStatusMarkUI size={size} state="waiting" />
                    <LittStatusMarkUI size={size} state="done" />
                    <LittStatusMarkUI size={size} state="error" />
                </span>
                {size}px
            </span>
        ))}
    </div>
);

export const StatusMarkHues = () => (
    <div className="flex items-end gap-6 text-xs text-gray-500">
        {LITT_STATUS_MARK_HUES.map((hue, i) => (
            <span key={hue} className="flex flex-col items-center gap-2">
                <LittStatusMarkUI size={32} hue={hue} state={i === 0 ? "working" : "idle"} /> {hue}
            </span>
        ))}
    </div>
);

export const Google = () => (
    <span className="flex items-center gap-2 text-sm text-gray-700">
        <GoogleIconUI className="h-8 w-8" />
        Google
    </span>
);
