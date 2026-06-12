import React from "react";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Unhandled app error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <main className="error-boundary" role="alert">
          <h1>WeWAD hit an unexpected error</h1>
          <p>The current view crashed. Reload the app and try the action again.</p>
          <button type="button" onClick={this.handleReload}>Reload</button>
        </main>
      );
    }

    return this.props.children;
  }
}
