import { Moon, Sun } from "lucide-react"
import { useTheme } from "./ThemeProvider"
import { cn } from "../lib/utils"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  const toggleTheme = () => {
    console.log("🎨 Theme actual:", theme)
    // Si está en system o light, cambiar a dark
    // Si está en dark, cambiar a light
    const newTheme = theme === "dark" ? "light" : "dark"
    console.log("🎨 Cambiando a:", newTheme)
    setTheme(newTheme)
  }

  return (
    <button
      onClick={toggleTheme}
      className={cn(
        "flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium transition-all",
        "bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:from-indigo-600 hover:to-purple-600",
        "hover:scale-105 active:scale-95 relative"
      )}
      aria-label="Cambiar tema"
      title="Cambiar modo claro/oscuro"
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute left-3 h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="ml-1">Tema</span>
    </button>
  )
}
