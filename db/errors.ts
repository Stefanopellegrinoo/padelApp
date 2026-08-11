/**
 * An error the player is meant to read. Anything that is not one of these is a
 * bug, and its details belong in the server log, not on the screen.
 */
export class EdgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EdgeError'
  }
}
