import { useMemo } from 'react'
import { lineColors } from './cities'
import { CityContext } from './cityContext'

/** Publishes the active city (and its mode-resolved line colors) to descendants. */
export default function CityProvider({ city, darkMode = false, children }) {
  const value = useMemo(
    () => ({ city, colors: lineColors(city, darkMode) }),
    [city, darkMode],
  )
  return <CityContext.Provider value={value}>{children}</CityContext.Provider>
}
