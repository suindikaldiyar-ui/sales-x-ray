import {
  LayoutDashboard,
  Filter,
  MessagesSquare,
  PhoneCall,
  FileBarChart,
  Users,
  UserSquare,
  Plug,
  Settings,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Filter,
  MessagesSquare,
  PhoneCall,
  FileBarChart,
  Users,
  UserSquare,
  Plug,
  Settings,
};

export function NavIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = ICONS[name] ?? LayoutDashboard;
  return <Icon className={className} />;
}
