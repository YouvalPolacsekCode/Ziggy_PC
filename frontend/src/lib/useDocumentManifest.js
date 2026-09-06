// Point the document at a different web-app manifest while a page is mounted.
//
// "Add to Home Screen" installs whatever manifest the CURRENT document links
// to, and opens at that manifest's start_url — not at the page the person was
// looking at. With only the app-wide manifest (start_url "/") linked, a home
// screen shortcut saved from the ops console opened the phone app. The wall
// hit the same thing first (Wall.jsx swaps to /wall.webmanifest for the same
// reason). This is that swap, reusable: set on mount, restore on unmount.

import { useEffect } from 'react'

export function useDocumentManifest(href) {
  useEffect(() => {
    if (!href || typeof document === 'undefined') return undefined
    const link = document.querySelector('link[rel="manifest"]')
    if (!link) return undefined
    const previous = link.getAttribute('href')
    link.setAttribute('href', href)
    return () => { if (previous) link.setAttribute('href', previous) }
  }, [href])
}
