import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { useDocumentManifest } from '../useDocumentManifest'

function Page({ href }) {
  useDocumentManifest(href)
  return null
}

const linkEl = () => document.querySelector('link[rel="manifest"]')

beforeEach(() => {
  const link = document.createElement('link')
  link.setAttribute('rel', 'manifest')
  link.setAttribute('href', '/manifest.webmanifest')
  document.head.appendChild(link)
})

afterEach(() => {
  cleanup()
  linkEl()?.remove()
})

describe('useDocumentManifest', () => {
  it('swaps the manifest while mounted and restores it on unmount', () => {
    const { unmount } = render(<Page href="/ops.webmanifest" />)
    expect(linkEl().getAttribute('href')).toBe('/ops.webmanifest')
    unmount()
    expect(linkEl().getAttribute('href')).toBe('/manifest.webmanifest')
  })

  it('is a no-op without an href', () => {
    render(<Page href={null} />)
    expect(linkEl().getAttribute('href')).toBe('/manifest.webmanifest')
  })
})
