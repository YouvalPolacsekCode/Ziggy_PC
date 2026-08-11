// Read a CSS media query from React.
//
// Needed only where a breakpoint decides WHICH element exists, not how it
// looks — CSS can hide a node but it can't move one, and rendering the same
// component twice to let CSS pick would mean two live copies of whatever state
// it owns. Anything purely visual belongs in wall.css instead.

import { useEffect, useState } from 'react'

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => (typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(query).matches
      : false),
  )

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    const onChange = (e) => setMatches(e.matches)
    setMatches(mql.matches)      // re-sync in case it changed before we attached
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

export default useMediaQuery
