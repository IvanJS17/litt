export function ConnectorSetupGuideLink({ href }: { href: string }) {
  return (
    <div className="mt-2">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-interactive underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        Open connector setup guide
      </a>
    </div>
  );
}
