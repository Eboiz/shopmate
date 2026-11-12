import type { SVGProps } from "react";

type IconName = "grid" | "chat" | "box" | "hanger" | "spark" | "arrow" | "search" | "send" | "close" | "refresh" | "login" | "logout" | "menu" | "up" | "store" | "book";

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" {...common} {...props}>
      {name === "grid" && <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>}
      {name === "chat" && <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.7-3.2A7.5 7.5 0 1 1 20 11.5Z" />}
      {name === "box" && <><path d="m3 7 9-4 9 4v10l-9 4-9-4V7Z" /><path d="m3 7 9 4 9-4M12 11v10" /></>}
      {name === "hanger" && <path d="M12 7a2 2 0 1 0-2-2m2 2v2l8.3 5.4a1.5 1.5 0 0 1-.8 2.6h-15a1.5 1.5 0 0 1-.8-2.6L12 9" />}
      {name === "spark" && <><path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2ZM19 17l.7 1.3L21 19l-1.3.7L19 21l-.7-1.3L17 19l1.3-.7L19 17Z" /></>}
      {name === "arrow" && <><path d="M5 19 19 5M8 5h11v11" /></>}
      {name === "search" && <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>}
      {name === "send" && <><path d="m21 3-9 18-2.5-7.5L2 11l19-8Z" /><path d="M9.5 13.5 21 3" /></>}
      {name === "close" && <path d="M5 5 19 19M19 5 5 19" />}
      {name === "refresh" && <><path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7" /></>}
      {name === "login" && <><path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 8l-4 4 4 4M16 12H6" /></>}
      {name === "logout" && <><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 8l4 4-4 4M8 12h10" /></>}
      {name === "menu" && <path d="M4 6h16M4 12h16M4 18h16" />}
      {name === "up" && <path d="M12 19V5M6 11l6-6 6 6" />}
      {name === "book" && <path d="M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2V5Zm0 16a2 2 0 0 1 2-2h14v2H6M9 7h7" />}
      {name === "store" && <path d="M4 10v10h16V10M3 10l2-6h14l2 6M3 10h18M9 20v-6h6v6" />}
    </svg>
  );
}
