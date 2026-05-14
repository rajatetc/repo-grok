import { useTheme } from "../hooks/useTheme";

interface Props {
  className?: string;
}

export default function ThemeToggle({ className }: Props) {
  const { theme, toggle } = useTheme();
  return (
    <button className={className} onClick={toggle} title="Toggle theme" aria-label="Toggle theme">
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
