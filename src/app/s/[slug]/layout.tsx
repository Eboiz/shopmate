export default function ShopLayout({ children }: LayoutProps<"/s/[slug]">) {
  return <div className="flex w-full flex-1 flex-col">{children}</div>;
}
