export default function ShopLayout({ children }: LayoutProps<"/s/[slug]">) {
  return <div className="mx-auto flex w-full max-w-md flex-1 flex-col">{children}</div>;
}
