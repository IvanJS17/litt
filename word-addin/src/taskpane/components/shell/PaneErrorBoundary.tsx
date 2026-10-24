import React from "react";

type Props = {
  fallback: (props: {
    error: unknown;
    resetError: () => void;
  }) => React.ReactNode;
  children: React.ReactNode;
};

type State = { error: Error | null };

/**
 * The pane's render-error boundary. A render crash must never leave a blank
 * task pane: a user in Word cannot open a console to see what happened, so
 * the failure is logged locally and the pane offers a way back that does not
 * involve restarting Word.
 */
export class PaneErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[taskpane] render error", error, info.componentStack);
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return this.props.fallback({
        error: this.state.error,
        resetError: this.resetError,
      });
    }
    return this.props.children;
  }
}
