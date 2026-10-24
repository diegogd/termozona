// Android back button: closes the top-most sheet or step before leaving the app.

type Handler = () => void
const stack: Handler[] = []

export function pushBack(handler: Handler): () => void {
  stack.push(handler)
  return () => {
    const i = stack.lastIndexOf(handler)
    if (i >= 0) stack.splice(i, 1)
  }
}

/** Runs the top handler. Returns false when there is nothing left to close. */
export function handleBack(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  top()
  return true
}
