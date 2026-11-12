import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { requireStaff } from "@/lib/auth";
import { getCatalog } from "@/lib/catalog";
import { compareSizes } from "@/lib/size-order";
import {
  addPairing,
  deletePairing,
  saveSizeChart,
  updatePolicy,
  updatePrice,
  updateStock,
} from "./actions";
import { PairingManager } from "./pairing-manager";
import { PolicyForm } from "./policy-form";
import { ProductEditor } from "./product-editor";
import { SizeChartCard } from "./size-chart-editor";

const TABS = [
  { id: "products", label: "Sản phẩm" },
  { id: "sizes", label: "Bảng size" },
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
  const { shopId, role } = await requireStaff();
  const { products, policies, pairings } = await getCatalog(shopId);
  const canEdit = role === "owner";

  return (
    <>
      <header className="mb-7">
        <p className="ui-eyebrow mb-2">Danh mục cửa hàng</p>
        <h1 className="ui-page-title">Sản phẩm</h1>
        <p className="mt-2 text-sm text-[#706d67]">Cập nhật giá, tồn kho, bảng size, chính sách và cách phối đồ.</p>
      </header>
      <nav aria-label="Loại dữ liệu" className="mb-6 flex gap-2 overflow-x-auto border-b border-[#e3dfd8] pb-2">
        {TABS.map(({ id, label }) => (
          <Link
            key={id}
            href={id === "products" ? "/admin/products" : `/admin/products?tab=${id}`}
            aria-current={tab === id ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center justify-center rounded-xl px-5 text-sm transition-colors ${
              tab === id ? "bg-[#171717] font-semibold text-white" : "text-[#706d67] hover:bg-[#efebe4]"
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

      {tab === "sizes" &&
        (products.length === 0 ? (
          <EmptyState title="Chưa có sản phẩm" description="Sản phẩm được nhập từ file dữ liệu của shop." />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm leading-6 text-[#706d67]">
              AI dùng bảng này để gợi ý size theo chiều cao và cân nặng của khách. Bấm vào một món để xem{canEdit ? " và sửa" : ""}.
            </p>
            {products.map((product) => (
              <SizeChartCard
                key={product.id}
                product={{
                  id: product.id,
                  code: product.code,
                  name: product.name,
                  sizes: [...new Set(product.variants.map((variant) => variant.size))].toSorted(compareSizes),
                  sizeChart: product.sizeChart,
                }}
                canEdit={canEdit}
                saveSizeChart={saveSizeChart}
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
