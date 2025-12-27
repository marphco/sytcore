import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("UI crash:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, color: "white" }}>
          <h2>Something went wrong.</h2>
          <p>The app crashed unexpectedly. Refresh to continue.</p>
        </div>
      );
    }

    return this.props.children;
  }
}
