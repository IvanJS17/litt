/**
 * The "or" rule between password sign-in and the other ways in. The word is
 * passed in because this component also renders in the Word add-in, which has
 * its own translator: each app brings its own text.
 */
export function AuthDividerUI({ label }: { label: string }) {
    return (
        <div className="flex items-center gap-3 py-1" aria-hidden="true">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs text-gray-500">{label}</span>
            <div className="h-px flex-1 bg-gray-200" />
        </div>
    );
}
