import type { Translate } from "@/i18n/Translate";
import type {
    SettingsShellGroup,
    SettingsShellTab,
} from "@/app/components/settings/SettingsShell";
import {
    settingsGroupsFor,
    settingsTabHref,
    visibleSettingsTabs,
    type SettingsAudienceContext,
    type SettingsHome,
} from "@/app/lib/settingsMap";

/**
 * What a settings frame draws for one home, read from the settings map: the
 * tabs the person is offered, each with its name, help text and address, and
 * the groups that hold them. A group with nothing to offer is left out.
 */
export function settingsShellModel(
    t: Translate,
    home: SettingsHome,
    context: SettingsAudienceContext,
    orgId?: string,
): { tabs: SettingsShellTab[]; groups: SettingsShellGroup[] } {
    const defs = visibleSettingsTabs(home, context);
    return {
        tabs: defs.map((def) => ({
            id: def.id,
            label: t(def.titleKey),
            help: t(def.helpKey),
            href: settingsTabHref(def, orgId),
        })),
        groups: settingsGroupsFor(home)
            .map((group) => ({
                id: group.id,
                label: t(group.titleKey),
                tabIds: defs.filter((def) => def.group === group.id).map((def) => def.id),
            }))
            .filter((group) => group.tabIds.length > 0),
    };
}
