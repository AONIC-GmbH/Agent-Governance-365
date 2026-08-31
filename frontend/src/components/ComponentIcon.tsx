import { ComponentType } from "@/data/types";
import { BarChart3, Zap, AppWindow, Bot } from "lucide-react";

export const componentTypeIconMap: Record<ComponentType, React.ElementType> = {
  "Power BI": BarChart3,
  "Power Automate": Zap,
  "Power App": AppWindow,
  "Copilot Agent": Bot,
};

const colorMap: Record<ComponentType, string> = {
  "Power BI": "bg-warning/10 text-warning",
  "Power Automate": "bg-info/10 text-info",
  "Power App": "bg-accent/10 text-accent",
  "Copilot Agent": "bg-primary/10 text-primary",
};

export const ComponentIcon = ({ type, size = "md" }: { type: ComponentType; size?: "sm" | "md" }) => {
  const Icon = componentTypeIconMap[type];
  const sizeClass = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const iconSize = size === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <div className={`${sizeClass} rounded-lg flex items-center justify-center ${colorMap[type]}`}>
      <Icon className={iconSize} />
    </div>
  );
};
