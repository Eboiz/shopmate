import type { ShopCatalog } from "@/lib/shop/types";

function variants(sizes: string[], byColor: Record<string, number[]>) {
  return Object.entries(byColor).flatMap(([color, stocks]) =>
    sizes.map((size, index) => ({ color, size, stock: stocks[index] })),
  );
}

// Local visual fixture based on the repository's seeded demo catalog.
export const previewCatalog: ShopCatalog = {
  shop: { name: "Mây Boutique" },
  products: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Váy suông linen",
      category: "Váy",
      description: "Váy suông dáng dài qua gối, vải linen mát, hợp đi làm và đi chơi.",
      price: 389000,
      imageUrl: "/demo-products/SP01.jpg",
      colors: ["Be", "Trắng", "Xanh rêu"],
      sizesInStock: ["S", "M", "L", "XL"],
      variants: variants(["S", "M", "L", "XL"], { Be: [7, 7, 7, 7], Trắng: [12, 12, 12, 12], "Xanh rêu": [2, 2, 2, 2] }),
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Đầm hoa nhí cổ vuông",
      category: "Đầm",
      description: "Đầm voan hoa nhí, cổ vuông, tay phồng nhẹ, có lớp lót.",
      price: 429000,
      imageUrl: "/demo-products/SP02.jpg",
      colors: ["Hồng phấn", "Xanh navy"],
      sizesInStock: ["S", "M", "L"],
      variants: variants(["S", "M", "L"], { "Hồng phấn": [14, 9, 4], "Xanh navy": [4, 14, 9] }),
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      name: "Đầm suông công sở",
      category: "Đầm",
      description: "Đầm suông vải tuytsi đứng form, dài ngang gối.",
      price: 459000,
      imageUrl: "/demo-products/SP03.jpg",
      colors: ["Đen", "Xám"],
      sizesInStock: ["XS", "S", "M", "L", "XL"],
      variants: variants(["XS", "S", "M", "L", "XL"], { Đen: [6, 1, 11, 6, 1], Xám: [11, 6, 1, 11, 6] }),
    },
    {
      id: "00000000-0000-4000-8000-000000000004",
      name: "Đầm maxi đi biển",
      category: "Đầm",
      description: "Đầm maxi hai dây, vải lụa mềm, chân xoè rộng.",
      price: 499000,
      imageUrl: "/demo-products/SP04.jpg",
      colors: ["Trắng", "Xanh ngọc"],
      sizesInStock: ["S", "M", "L"],
      variants: variants(["S", "M", "L"], { Trắng: [13, 13, 13], "Vàng nghệ": [0, 0, 0], "Xanh ngọc": [8, 8, 8] }),
    },
  ],
};
