import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-screen place-items-center bg-bg p-6 text-center">
        <div className="max-w-sm">
          <div className="text-4xl" aria-hidden>📦</div>
          <h1 className="mt-3 text-2xl font-bold">Something broke on this screen</h1>
          <p className="mt-2 text-ink-2">Your move data is safe. Reload to try again.</p>
          <button onClick={() => window.location.reload()} className="mt-5 h-10 rounded-ctl bg-orange px-4 font-medium text-[#1F1E1B]">Reload</button>
        </div>
      </div>
    );
  }
}
