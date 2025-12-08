import { createContext, useContext, useEffect, useState } from "react"

type Theme = "dark" | "light" | "system"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "contact-center-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  )

  useEffect(() => {
    console.log("🌈 ThemeProvider useEffect - theme:", theme)
    const root = window.document.documentElement
    root.classList.remove("light", "dark")

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches ? "dark" : "light"
      console.log("🌈 Modo system detectado, usando:", systemTheme)
      root.classList.add(systemTheme)
      return
    }

    console.log("🌈 Aplicando clase al html:", theme)
    root.classList.add(theme)
    console.log("🌈 Classes actuales del html:", root.className)
  }, [theme])

  const value = {
    theme,
    setTheme: (newTheme: Theme) => {
      console.log("🌈 setTheme llamado con:", newTheme)
      localStorage.setItem(storageKey, newTheme)
      setTheme(newTheme)
      console.log("🌈 Estado actualizado a:", newTheme)
    },
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)
  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider")
  return context
}
