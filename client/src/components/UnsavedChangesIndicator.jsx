export default function UnsavedChangesIndicator({ dirty }) {
  return dirty ? <span className="unsaved-changes-indicator" role="status">Unsaved changes</span> : null
}
