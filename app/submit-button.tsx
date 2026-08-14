'use client'

import type { ComponentProps } from 'react'
import { useFormStatus } from 'react-dom'

/**
 * Submit button for a `<form action={serverAction}>`. Disabled while the
 * action is in flight, so a double tap cannot fire the action twice.
 *
 * Must be rendered as a separate component INSIDE the `<form>`: `useFormStatus`
 * reads the parent `<form>`, and calling it from the component that draws the
 * `<form>` itself always returns `pending: false`.
 *
 * `{...props}` first, `disabled={pending}` after: the pending guard can never
 * be overridden by accident from a call site.
 */
export function SubmitButton(props: ComponentProps<'button'>) {
  const { pending } = useFormStatus()
  return <button {...props} type="submit" disabled={pending} />
}
