# Kịch bản test tay chat engine (Mây Boutique)

Dữ liệu lấy từ DB cloud ngày 2026-11-11, shop `may-boutique` (60 sản phẩm). Nếu shop sửa sản phẩm thì kiểm lại giá và tồn kho trước khi test.

**Cách chạy**
- Trang chat: `/s/may-boutique` (local hoặc Vercel preview của nhánh `fix/chat-flow`).
- Mỗi kịch bản dùng **một khách mới** (cửa sổ ẩn danh mới hoặc xoá cookie), để lịch sử của kịch bản trước không ảnh hưởng.
- Web chat giới hạn **20 khách mới mỗi giờ**, nên đừng chạy lại một kịch bản quá nhiều lần.
- Sau mỗi kịch bản, xem trong admin inbox: trạng thái hội thoại (`ai` hay `needs_human`) và lý do handoff. Hoặc xem bảng `ai_turns` (cột `handoff_reason`, `tool_calls`, `postcheck`, `latency_ms`).
- Cột **Task** cho biết kịch bản kiểm lỗi nào trong plan. Kịch bản thuộc task chưa làm thì sẽ chỉ đạt sau khi task đó xong.

**Kiểm chung cho mọi câu trả lời**
- Không có từ tiếng Anh như "stock" hay "size chart" (F6, Task 5).
- Giá và số lượng phải đúng như các bảng bên dưới (R1, Task 4).
- Nút trả lời nhanh không được nêu món shop không bán (F2, Task 2).

---

## 1. Hỏi món shop không bán, hỏi hai lần → chuyển nhân viên
**Task:** T1 (F1, PB-05 AC3), T2 (F2)

| Lượt | Khách nói |
|---|---|
| 1 | `Shop có áo khoác da không ạ?` |
| 2 | `Loại áo khoác da màu đen ấy` |

**Mong đợi**
- Lượt 1: không có áo khoác da, AI hỏi lại một câu ngắn. Không được đoán sang áo khoác jean hay bomber rồi nói là "có".
- Lượt 2: chuyển nhân viên, lý do `misunderstood_twice`, câu trả lời đúng là: *"Dạ, mình vẫn chưa tìm thấy sản phẩm bạn hỏi trong shop. Mình đã chuyển câu hỏi của bạn cho nhân viên shop, nhân viên sẽ trả lời bạn sớm nhé!"*
- Không có nút trả lời nhanh kiểu "Áo khoác da nam" hay "Tìm lại áo da".

## 2. Tên gọi gần đúng vẫn tìm ra sản phẩm (không được tính là trượt)
**Task:** T1 (Review Focus 1)

| Lượt | Khách nói |
|---|---|
| 1 | `Có váy linen không shop?` |
| 2 | `Màu be còn không?` |

**Mong đợi**
- Tìm ra **Váy suông linen (SP01), 389.000đ**, có màu Be, Trắng, Xanh rêu, size S–XL.
- Lượt 2: màu Be còn **7 cái mỗi size** (S, M, L, XL).
- Không chuyển nhân viên.

## 3. Hỏi tồn kho và giá một biến thể cụ thể
**Task:** T4 (R1), T5 (F6)

| Lượt | Khách nói |
|---|---|
| 1 | `Váy suông linen màu xanh rêu size M còn hàng không, giá bao nhiêu?` |

**Mong đợi**
- Còn **2 cái**, giá **389.000đ** (hoặc "389k").
- Viết bằng tiếng Việt ("còn 2 cái"), không viết "stock 2".

## 4. Biến thể hết hàng → gợi ý màu còn hàng
**Task:** T4 (R1)

| Lượt | Khách nói |
|---|---|
| 1 | `Đầm maxi đi biển màu vàng nghệ size M còn không?` |

**Mong đợi**
- Màu Vàng nghệ **hết hàng ở mọi size** (S, M, L đều 0).
- Có thể gợi ý size M màu **Trắng (còn 13)** hoặc **Xanh ngọc (còn 8)**. Giá **499.000đ**.
- Không được nói còn hàng màu vàng nghệ.

## 5. Tư vấn size theo chiều cao và cân nặng
**Task:** T4 (Review Focus 3: số khách đưa ra không bị kiểm)

| Lượt | Khách nói |
|---|---|
| 1 | `Mình cao 1m58 nặng 50kg thì mặc đầm suông công sở size gì?` |
| 2 | `Size đó màu xám còn không?` |

**Mong đợi**
- Lượt 1: size **M** (bảng size: M = 156–160 cm, 48–52 kg). AI nhắc lại "1m58, 50kg" mà không bị guard chặn.
- Lượt 2: M màu Xám chỉ còn **1 cái**, còn M màu Đen thì còn **11**. Giá **459.000đ**.

## 6. Hỏi đổi trả → trả lời theo chính sách, không chuyển nhân viên
**Task:** T3 (F3, PB-09 AC1)

| Lượt | Khách nói |
|---|---|
| 1 | `Mua về mặc không vừa thì có đổi được không shop?` |

**Mong đợi**
- Trả lời theo đúng chính sách: đổi size hoặc đổi mẫu **trong 7 ngày** kể từ khi nhận hàng, còn tem mác, chưa giặt. Đổi theo ý khách thì **khách chịu phí ship hai chiều**. **Không hoàn tiền**, chỉ đổi sản phẩm. Hàng giảm giá không được đổi trả.
- **Không** chuyển nhân viên (trước đây bị chuyển với lý do `not_covered_by_data`).

## 7. Hỏi điều chính sách không nhắc tới → vẫn phải chuyển nhân viên
**Task:** T3 (Review Focus 2, PB-09 AC2)

| Lượt | Khách nói |
|---|---|
| 1 | `Shop có giao hàng vào Chủ nhật không?` |

**Mong đợi**
- Chính sách giao hàng không nói tới ngày giao, nên AI **phải chuyển nhân viên** với lý do `policy_not_covered`.
- Không được tự nói "có giao Chủ nhật" hay "không giao Chủ nhật".

## 8. Xin giảm giá kèm đặt hàng → từ chối lịch sự, không chuyển nhân viên
**Task:** T3 (F4, PB-09 AC3)

| Lượt | Khách nói |
|---|---|
| 1 | `Mình lấy 2 cái váy suông linen màu trắng size M, shop bớt 50k được không?` |

**Mong đợi**
- Từ chối lịch sự: shop không giảm thêm ngoài giá niêm yết. Mục khuyến mãi của shop đang **trống**, nên AI không được nêu ưu đãi nào.
- **Không** chuyển nhân viên. Không hứa bớt 50k.
- Có thể tiếp tục đặt hàng: 2 × 389.000đ = 778.000đ, đơn từ 500.000đ được **miễn phí giao hàng**. Màu Trắng size M còn 12.

## 9. Hỏi phí ship và tổng tiền
**Task:** T4 (R1: số trong chính sách và tổng của `quote_order` được tính là đúng)

| Lượt | Khách nói |
|---|---|
| 1 | `Mua 1 áo thun cổ tròn basic màu trắng size S, ship về Đà Nẵng hết bao nhiêu tiền?` |

**Mong đợi**
- Giá áo **149.000đ**. Ship tỉnh khác **30.000đ**, giao trong 3–5 ngày (đơn dưới 500.000đ nên không được miễn phí ship). Thanh toán COD.
- **Cần để ý:** nếu AI tự cộng ra "179.000đ" mà không gọi `quote_order`, thì sau Task 4 con số đó có thể bị guard bắt, vì nó không có trong kết quả tool nào. Ghi lại AI xử lý thế nào, đây là điểm cần quyết định thêm.

## 10. Khiếu nại → cảm ơn → hỏi lại sản phẩm (tự quay về AI)
**Task:** T6 (R2, PB-14 AC2, Review Focus 4)

| Lượt | Khách nói |
|---|---|
| 1 | `Hàng shop giao bị rách đường may, mình bực quá` |
| 2 | `Ok cảm ơn` |
| 3 | `Áo thun cổ tròn basic màu đen size M còn không?` |

**Mong đợi**
- Lượt 1: chuyển nhân viên, lý do `complaint`, hội thoại thành `needs_human`.
- Lượt 2: hội thoại **vẫn là `needs_human`** (trước khi sửa, nó tự quay về `ai`).
- Lượt 3: AI trả lời từ dữ liệu: còn **2 cái**, **149.000đ**. Sau lượt này hội thoại mới quay về `ai`.

## 11. Gửi hai tin liên tiếp → chỉ nhận một câu trả lời
**Task:** T8 (R3)

| Lượt | Khách nói |
|---|---|
| 1 | `Váy babydoll tay bồng còn màu gì?` rồi gửi ngay `size M nha` (trong vòng 1–2 giây) |

**Mong đợi**
- Chỉ nhận **một** câu trả lời, cho tin mới nhất và hiểu cả hai tin.
- Size M: màu Hồng phấn **còn 5**, màu **Trắng size M đã hết (0)**. Giá **359.000đ**.

## 12. Đặt hàng đủ bước và gợi ý phối đồ
**Task:** T4 (tổng tiền), T7 (độ trễ)

| Lượt | Khách nói |
|---|---|
| 1 | `Áo khoác cardigan len phối với gì đẹp shop?` |
| 2 | `Lấy 1 cardigan màu nâu size M nha` |
| 3 | `Tên Lan, số 0901234567, giao 12 Nguyễn Trãi quận 1 TP.HCM` |

**Mong đợi**
- Lượt 1: gợi ý phối đúng dữ liệu của shop, gồm **Váy suông linen** (khoác ngoài khi vào phòng lạnh) và **Đầm xoè tay cánh tiên** (khi trời se lạnh).
- Lượt 2: cardigan **349.000đ**, màu Nâu size M còn **12**. AI hỏi tên, số điện thoại và địa chỉ.
- Lượt 3: tóm tắt đơn đúng giá. Nội thành TP.HCM phí ship **20.000đ** vì đơn dưới 500.000đ. Đơn nháp được tạo **một lần**.
- Ghi lại `latency_ms` của từng lượt. Trước khi sửa: trung vị 13,5 s, tối đa 31,2 s.

---

## Bảng ghi kết quả

| # | Đạt / Trượt | Lý do handoff | Độ trễ (s) | Ghi chú |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |
| 7 | | | | |
| 8 | | | | |
| 9 | | | | |
| 10 | | | | |
| 11 | | | | |
| 12 | | | | |
