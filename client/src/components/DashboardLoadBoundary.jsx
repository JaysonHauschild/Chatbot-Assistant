import { Component } from 'react'

export default class DashboardLoadBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return <main className="dashboard-shell">
        <section className="dashboard-load-state" role="alert">
          <h1>Dashboard could not load</h1>
          <p>Reload the dashboard to try again.</p>
          <button type="button" onClick={() => window.location.reload()}>Reload dashboard</button>
        </section>
      </main>
    }
    return this.props.children
  }
}
