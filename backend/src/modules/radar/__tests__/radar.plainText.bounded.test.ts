import { describe, expect, it } from "vitest";
import { expectLinearCost } from "../../../__tests__/helpers/linearCost";
import { MODEL_TEXT_MAX_CHARS } from "../../../lib/modelJsonFence";
import { parseProposal } from "../radar.proposals.shared";
import { plainReason } from "../radar.suggest.shared";

const proposal = (law: string) => ({ law, article: "1", obligation: "o", anchor_name: "a", quote: "q" });

describe("the plain text of a model's explanation", () => {
    it("drops tags in linear time, also when a tag never closes", () => {
        expectLinearCost((n) => plainReason("<".repeat(n)), { small: 2_000, large: 64_000 });
        expectLinearCost((n) => parseProposal(proposal("<".repeat(n))), { small: 2_000, large: 64_000 });
    });
    it("drops tags as before", () => {
        expect(plainReason("Plazo <b>de</b> tres\n días <")).toBe("Plazo de tres días <");
        expect(parseProposal(proposal("<i>Ley</i> Federal"))?.law).toBe("Ley Federal");
    });
    it("gives nothing for text over the shared bound", () => {
        expect(plainReason("x".repeat(MODEL_TEXT_MAX_CHARS + 1))).toBeNull();
        expect(parseProposal(proposal("x".repeat(MODEL_TEXT_MAX_CHARS + 1)))).toBeNull();
    });
});
