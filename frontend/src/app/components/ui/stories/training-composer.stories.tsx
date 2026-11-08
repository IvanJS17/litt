import { useEffect, useState } from "react";
import {
    TrainingAttemptFieldUI,
    TrainingConfidenceUI,
    TrainingNoteUI,
    LIQUID_GLASS_FLAT_CLASS,
} from "@mike/ui";
import type { TrainingConfidenceLevel } from "@mike/contracts";
import { loadMessages, type Messages } from "@litt/i18n";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { useTrainingText } from "@/app/hooks/useTrainingText";

const meta = { title: "Training / Composer and note (es-MX)" };
export default meta;

const APPROACH =
    "Creo que procede la rescisión por incumplimiento de la cláusula quinta, porque el pago venció y no se cobró.";

function Composer({ showError }: { showError?: boolean }) {
    const text = useTrainingText();
    const [attempt, setAttempt] = useState(APPROACH);
    const [level, setLevel] = useState<TrainingConfidenceLevel | null>(null);
    return (
        <div className={`flex w-full max-w-[640px] flex-col gap-3 rounded-2xl p-4 ${LIQUID_GLASS_FLAT_CLASS}`}>
            <TrainingAttemptFieldUI
                id="story-attempt"
                value={attempt}
                onChange={setAttempt}
                text={text.attempt}
            />
            <TrainingConfidenceUI
                id="story-confidence"
                value={level}
                onChange={setLevel}
                text={text.confidence}
                showError={showError}
            />
        </div>
    );
}

function Note() {
    const text = useTrainingText();
    return (
        <TrainingNoteUI
            className="w-full max-w-[640px]"
            text={text.note}
            note={{
                chat_id: "chat-1",
                attempt: APPROACH,
                contrast:
                    "Coincide: la rescisión procede.\nNo coincide: la respuesta exige aviso previo.\nFaltó: el plazo de cura.",
                contrast_status: "ready",
                confidence: 3,
                effective_verdict: "parcial",
                right_for_wrong_reason: true,
                foundation: "weak",
                foundation_question:
                    "Tu conclusión coincide, pero basaste la rescisión en el impago; ¿en qué cláusula o hecho del contrato se apoya?",
            }}
        />
    );
}

const InEsMx = ({ children }: { children: React.ReactNode }) => {
    const [messages, setMessages] = useState<Messages | null>(null);
    useEffect(() => {
        void loadMessages("es-MX").then(setMessages);
    }, []);
    if (!messages) return null;
    return (
        <IntlClientProvider locale="es-MX" messages={messages}>
            {children}
        </IntlClientProvider>
    );
};

/** The approach field with the thermometer, none chosen yet. */
export const ComposerWithThermometer = () => (
    <InEsMx>
        <Composer />
    </InEsMx>
);

/** After a send was refused for a missing mark. */
export const ComposerMarkMissing = () => (
    <InEsMx>
        <Composer showError />
    </InEsMx>
);

/** The note with the verdict and the basis question. */
export const NoteWithVerdictAndQuestion = () => (
    <InEsMx>
        <Note />
    </InEsMx>
);
