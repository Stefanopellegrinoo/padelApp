import { describe, it, expect } from 'vitest'
import { orderByPoints } from './order'

const snapshot = ['juan', 'stefano', 'marce', 'nico', 'pablo', 'leo']

describe('orderByPoints', () => {
  it('sorts by points, highest first', () => {
    const points = new Map([['juan', 10], ['stefano', 30], ['marce', 20]])
    expect(orderByPoints(['juan', 'stefano', 'marce'], points, snapshot)).toEqual([
      'stefano',
      'marce',
      'juan',
    ])
  })

  it('breaks ties with the snapshot order', () => {
    const points = new Map([['marce', 47], ['nico', 47]])
    expect(orderByPoints(['nico', 'marce'], points, snapshot)).toEqual(['marce', 'nico'])
  })

  it('treats a missing player as having zero points', () => {
    const points = new Map([['juan', 5]])
    expect(orderByPoints(['stefano', 'juan'], points, snapshot)).toEqual(['juan', 'stefano'])
  })

  it('puts players outside the snapshot last, keeping their input order', () => {
    const points = new Map([['guest', 0], ['leo', 0]])
    expect(orderByPoints(['guest', 'leo'], points, snapshot)).toEqual(['leo', 'guest'])
  })

  it('keeps two players outside the snapshot in the order they arrived', () => {
    const points = new Map<string, number>()
    expect(orderByPoints(['g1', 'g2'], points, snapshot)).toEqual(['g1', 'g2'])
  })

  it('does not mutate its input', () => {
    const input = ['nico', 'marce']
    const points = new Map([['marce', 47], ['nico', 47]])
    orderByPoints(input, points, snapshot)
    expect(input).toEqual(['nico', 'marce'])
  })

  it('is a total order: the same input always gives the same output', () => {
    const points = new Map([['marce', 47], ['nico', 47], ['juan', 47]])
    const input = ['juan', 'nico', 'marce']
    const first = orderByPoints(input, points, snapshot)
    const second = orderByPoints([...input].reverse(), points, snapshot)
    expect(first).toEqual(second)
  })
})
