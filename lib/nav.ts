import type { MembershipRole } from "@/lib/types/db";

export interface NavItem {
  href: string;
  label: string;
  /** lucide-react icon name. */
  icon: string;
  /** If set, only these roles see the item. */
  roles?: MembershipRole[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Дашборд", icon: "LayoutDashboard" },
  { href: "/funnel", label: "Воронка", icon: "Filter" },
  { href: "/conversations", label: "Переписка", icon: "MessagesSquare" },
  { href: "/calls", label: "Звонки", icon: "PhoneCall" },
  { href: "/managers", label: "Менеджеры", icon: "UserSquare" },
  { href: "/reports", label: "Отчёты", icon: "FileBarChart" },
  { href: "/team", label: "Команда", icon: "Users", roles: ["OWNER", "ROP"] },
  { href: "/integrations", label: "Интеграции", icon: "Plug", roles: ["OWNER", "ROP"] },
];

export function visibleNavItems(role: MembershipRole): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));
}
