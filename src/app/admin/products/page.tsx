import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { getCatalog, requireStaff } from "@/lib/catalog";
import {
  addPairing,
  deletePairing,
  updatePolicy,
  updatePrice,
  updateStock,
} from "./actions";
import { PairingManager } from "./pairing-manager";
import { PolicyForm } from "./policy-form";
import { ProductEditor } from "./product-editor";

const TABS = [
  { id: "products", label: "Sản phẩm" },
  { id: "policies", label: "Chính sách" },
  { id: "pairings", label: "Phối đồ" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function parseTab(value: string | string[] | undefined): TabId {
  return TABS.find((tab) => tab.id === value)?.id ?? "products";
}

// Rendered inside the Suspense boundary of the admin layout, which already
// checked the session; requireStaff reads the role and shop for this page.
export default async function ProductsPage({ searchParams }: PageProps<"/admin/products">) {
  const tab = parseTab((await searchParams).tab);
  const ctx = await requireStaff();
  const { products, policies, pairings } = await getCatalog(ctx);
  const canEdit = ctx.role === "owner";

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Sản phẩm</h1>
      <nav aria-label="Loại dữ liệu" className="mb-4 grid grid-cols-3 rounded-md border border-zinc-200">
        {TABS.map(({ id, label }) => (
          <Link
            key={id}
            href={id === "products" ? "/admin/products" : `/admin/products?tab=${id}`}
            aria-current={tab === id ? "page" : undefined}
            className={`flex min-h-11 items-center justify-center px-1 text-sm ${
              tab === id ? "bg-zinc-900 font-semibold text-white" : "text-zinc-600"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {!canEdit && (
        <p className="mb-4 text-sm text-zinc-500">
          Bạn đang xem với quyền nhân viên. Chỉ chủ shop được sửa.
        </p>
      )}

      {tab === "products" &&
        (products.length === 0 ? (
          <EmptyState title="Chưa có sản phẩm" description="Sản phẩm được nhập từ file dữ liệu của shop." />
        ) : (
          <div className="flex flex-col gap-4">
            {products.map((product) => (
              <ProductEditor
                key={product.id}
                product={product}
                canEdit={canEdit}
                updatePrice={updatePrice}
                updateStock={updateStock}
              />
            ))}
          </div>
        ))}

      {tab === "policies" && (
        <div className="flex flex-col gap-6">
          {policies.map((policy) => (
            <PolicyForm
              key={policy.kind}
              type={policy.kind}
              content={policy.content}
              canEdit={canEdit}
              updatePolicy={updatePolicy}
            />
          ))}
          <p className="text-sm text-zinc-500">
            Để trống nghĩa là shop không có chính sách này: AI sẽ chuyển câu hỏi cho nhân viên.
          </p>
        </div>
      )}

      {tab === "pairings" && (
        <PairingManager
          products={products.map(({ id, name }) => ({ id, name }))}
          pairings={pairings}
          canEdit={canEdit}
          addPairing={addPairing}
          deletePairing={deletePairing}
        />
      )}
    </>
  );
}
