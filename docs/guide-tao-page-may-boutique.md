# Hướng dẫn: tạo Facebook Page "Mây Boutique" và nối vào Meta app của ShopMate

Mục tiêu: Mây Boutique (`may-boutique`) có kênh Messenger riêng, để demo hai shop cùng chạy trên một hệ thống. Khách nhắn Page Mây thì hội thoại vào inbox của Mây, không lẫn sang Hạnh Boutique.

Không cần tạo Meta app mới. Dùng lại đúng Meta app đang chạy cho Hạnh: một webhook (`/api/webhooks/messenger`) nhận tin của mọi Page đã nối vào app, rồi tra Page ID trong bảng `channel_accounts` để biết tin đó thuộc shop nào.

Ai làm phần nào:

- **Người tạo Page** (phần 1 đến 6): không cần biết code, nhưng phải có role **Admin** hoặc **Developer** trên Meta app. Nếu chưa có, nhờ người đang là admin của app thêm vào (App roles → Roles → Add people), rồi chấp nhận lời mời ở developers.facebook.com/requests.
- **Dev** (phần 7 đến 8): sửa seed, lưu token vào database, test.

> Ghi chú về giao diện Meta: tên menu dưới đây theo README của repo và theo dashboard Meta năm 2026 theo hiểu biết của người viết. Chỗ nào đánh dấu **(chưa chắc)** là tên nút có thể khác một chút, cứ tìm mục có ý nghĩa tương tự.

---

## 1. Tạo Facebook Page "Mây Boutique"

1. Vào facebook.com bằng tài khoản cá nhân của bạn → menu **Trang (Pages)** → **Tạo Trang mới (Create new Page)**.
2. Tên Trang: `Mây Boutique`. Hạng mục (Category): `Cửa hàng quần áo` (Clothing store). Mô tả và ảnh đại diện không bắt buộc.
3. Bấm **Tạo Trang**. Bạn là admin (toàn quyền) của Page này.

Nếu bạn **không** có role trên Meta app: vào Page → Cài đặt → **Quyền truy cập Trang (Page access)** → thêm người đang là admin của app làm người có **toàn quyền** (full control), rồi để người đó làm tiếp từ phần 2. Người bấm "Generate token" ở phần 3 phải vừa là admin Page vừa có role trên app.

## 2. Mở trang Messenger API Settings của app

1. Vào developers.facebook.com → **My Apps** → chọn app ShopMate (app đang dùng cho Page của Hạnh).
2. Mở **Messenger API Settings**. Với app tạo theo use case "Engage with customers on Messenger from Meta" (cách team đã tạo), đường dẫn là: menu trái **Use cases** → use case Messenger → **Customize** → **Messenger API Settings** **(chưa chắc tên từng bước, nhưng trang cần tìm có 2 mục "Configure webhooks" và "Generate access tokens")**.
3. App phải để nguyên **Development mode**. Không bấm chuyển sang Live, không gửi App Review.

## 3. Nối Page Mây vào app và tạo Page access token

1. Ở mục **Generate access tokens**, bấm **Connect** / **Add Page** **(chưa chắc tên nút)**. Facebook mở hộp thoại đăng nhập, hỏi chọn Page.
2. Tick **Mây Boutique**. **Đừng bỏ tick Page của Hạnh** nếu nó hiện trong danh sách, vì bỏ tick có thể làm app mất quyền với Page Hạnh và kênh Messenger của Hạnh ngừng chạy.
3. Đồng ý các quyền app xin (`pages_messaging`, `pages_manage_metadata`, `pages_show_list`...).
4. Quay lại Messenger API Settings: Page Mây đã nằm trong danh sách. Ghi lại:
   - **Page ID**: dãy số hiện cạnh tên Page ở đây. Không dùng số trong link profile của Page.
   - **Page access token**: bấm **Generate** cạnh Page Mây, copy token (chuỗi dài bắt đầu bằng `EAA...`). Token chỉ hiện một lần; mất thì Generate lại.

### Kiểm tra token có hết hạn không

Dán token vào **Access Token Debugger**: developers.facebook.com/tools/debug/accesstoken → **Debug**.

- Dòng **Expires** ghi **Never**: dùng được lâu dài.
- Có ngày hết hạn: báo dev. Dev đổi sang token không hết hạn theo cách sau (cần App secret, nên dev tự làm, không làm trong group chat):
  1. Lấy User access token (Graph API Explorer, có quyền `pages_messaging`, `pages_manage_metadata`, `pages_show_list`).
  2. Đổi sang long-lived user token: `GET https://graph.facebook.com/v24.0/oauth/access_token?grant_type=fb_exchange_token&client_id=<APP_ID>&client_secret=<APP_SECRET>&fb_exchange_token=<USER_TOKEN>`.
  3. Lấy Page token bằng long-lived token đó: `GET https://graph.facebook.com/v24.0/me/accounts?access_token=<LONG_LIVED_USER_TOKEN>`. Token của Page Mây trong kết quả không hết hạn. Debug lại để chắc chắn.

Team chưa dùng System User cho Messenger (README chỉ dùng System User cho WhatsApp), nên không cần làm cách đó.

Token sẽ mất hiệu lực nếu người tạo ra nó đổi mật khẩu Facebook, bị gỡ khỏi Page hoặc khỏi app. Khi đó Generate lại và gửi dev token mới.

## 4. Đăng ký webhook cho Page Mây

Callback URL và Verify token của app đã cấu hình sẵn từ khi làm Page Hạnh, **không sửa**. Chỉ cần đăng ký Page mới:

1. Ở mục **Configure webhooks** (cùng trang Messenger API Settings), tìm dòng Page **Mây Boutique**.
2. Bấm **Add subscriptions** cạnh Page đó, tick đúng 2 field giống Page Hạnh: **`messages`** và **`messaging_postbacks`** → **Confirm/Save**.
3. Kiểm tra cột subscription của Page Mây hiện 2 field trên. Nếu bước này bị bỏ qua, Meta sẽ không gửi tin của Page Mây về server (lỗi phổ biến nhất).

## 5. (Tùy chọn) Instagram Direct cho Mây

Bỏ qua nếu chỉ cần Messenger. Nếu muốn, làm theo mục "Instagram channel (PB-23)" trong `README.md`, với tài khoản Instagram riêng của Mây:

1. Tài khoản Instagram của Mây chuyển sang **professional account**, liên kết với Page Mây Boutique, bật **Allow access to messages** (Message controls → Connected tools).
2. App → Messenger → **Instagram settings**: connect Page Mây kèm tài khoản Instagram, copy **Instagram account ID** (dạng `17841...`). Nếu Page token ở phần 3 tạo **trước** bước này thì Generate lại để token có quyền Instagram.
3. Đăng ký field `messages` cho tài khoản Instagram đó.
4. Gửi dev thêm Instagram account ID (biến `MAY_BOUTIQUE_INSTAGRAM_ACCOUNT_ID`, xem phần 7).

## 6. Thêm người test (vì app chưa qua App Review)

App đang ở Development mode, nên **chỉ người có role trên app** (Admin, Developer, Tester) nhận được trả lời từ AI. Người lạ nhắn vào Page Mây sẽ không thấy gì.

1. App → **App roles** → **Roles** → **Add people** → chọn **Tester** → nhập tên/Facebook của thành viên team.
2. Người được mời vào developers.facebook.com/requests để **chấp nhận**. Chưa chấp nhận thì vẫn chưa nhắn được.
3. Ai đã là tester từ đợt làm Page Hạnh thì không cần thêm lại: role nằm ở app, dùng chung cho mọi Page.

## 7. Gửi gì cho dev và gửi bằng cách nào

Gửi dev 2 giá trị (thêm 1 nếu làm Instagram):

| Giá trị | Tên biến dev sẽ dùng (đề xuất) |
|---|---|
| Page ID của Mây Boutique | `MAY_BOUTIQUE_MESSENGER_PAGE_ID` |
| Page access token của Mây Boutique | `MAY_BOUTIQUE_MESSENGER_PAGE_ACCESS_TOKEN` |
| (tùy chọn) Instagram account ID | `MAY_BOUTIQUE_INSTAGRAM_ACCOUNT_ID` |

Quy tắc:

- **Không dán token vào group chat**, không chụp màn hình có token, không commit vào git. Ai có token là gửi tin được thay Page.
- Gửi token qua **tin nhắn riêng** cho đúng dev phụ trách (hoặc trình quản lý mật khẩu chung nếu team có). Page ID thì không bí mật, gửi đâu cũng được.
- Dev bỏ vào `.env.local` của máy mình. **Không** thêm các biến này lên Vercel: webhook đọc token từ database, không đọc từ biến môi trường. `META_APP_SECRET` và `META_VERIFY_TOKEN` trên Vercel giữ nguyên vì vẫn là app cũ.

Code đã đọc các biến này: seed chạy với `--data=may-boutique` đọc biến kênh có tiền tố `MAY_BOUTIQUE_`, còn Hạnh vẫn dùng tên cũ (`MESSENGER_PAGE_ID`...).

---

## 8. Việc của dev sau khi nhận token

### 8.1. Phần không cần sửa

- Webhook `src/app/api/webhooks/messenger/route.ts:61-79` đã phục vụ nhiều Page: lấy `entry.id` (Page ID, xem `src/lib/channels/messenger.ts:62-69`), tra `channel_accounts` theo `channel = 'messenger'` và `external_account_id`, rồi dùng `shop_id` và `access_token` của đúng dòng đó. Thêm một dòng cho Page Mây là đủ để định tuyến.
- Gửi tin (`src/lib/channels/send.ts:41`, `:101`) lấy token từ `channel_accounts` của hội thoại, nên trả lời và tin nhắn của staff Mây đi ra bằng token Page Mây.
- Bảng `channel_accounts` (`supabase/migrations/20261103120000_pb00_schema.sql:109-119`) có `unique (channel, external_account_id)`: một Page chỉ thuộc một shop. Không cần migration.
- Inbox staff đã lọc theo shop bằng RLS.

### 8.2. Code đã sẵn sàng

`scripts/seed.ts` đã cho mỗi shop có kênh riêng: với `--data=may-boutique`, seed đọc `MAY_BOUTIQUE_MESSENGER_PAGE_ID`, `MAY_BOUTIQUE_MESSENGER_PAGE_ACCESS_TOKEN`, `MAY_BOUTIQUE_INSTAGRAM_ACCOUNT_ID`... (tên biến của Hạnh thêm tiền tố `MAY_BOUTIQUE_`). Seed Mây không bao giờ đọc biến của Hạnh. Nếu lỡ dùng Page ID của Hạnh, seed dừng với lỗi "belongs to another shop". Kênh nào chưa đặt biến thì seed chỉ cảnh báo và bỏ qua. Các biến đã có sẵn (để trống) trong `.env.example`.

### 8.3. Lưu Page Mây vào database

Sau khi điền 2 biến vào `.env.local`:

```bash
# Supabase local
pnpm db:seed --data=may-boutique --only=channels
# Supabase chung của team (bản demo trên Vercel dùng project này)
pnpm db:seed --data=may-boutique --only=channels --target=shared --confirm=<ref>
```

Dùng `--only=channels`: lệnh này chỉ upsert dòng `channel_accounts`, không reset giá, tồn kho, ảnh hay tài khoản. Không chạy seed đầy đủ của Mây chỉ để thêm kênh. Shop `may-boutique` phải đã có trong database (seed đầy đủ từng chạy rồi), nếu không lệnh sẽ báo `shop may-boutique (run the full seed first)`.

Kết quả mong đợi: `✓ messenger: Page <PAGE_ID_MÂY> → may-boutique`. Mỗi lần đổi token thì chạy lại lệnh này.

### 8.4. Test

1. Từ tài khoản Facebook của một **tester** đã chấp nhận lời mời, nhắn vào Page Mây Boutique, ví dụ "shop có áo sơ mi nam không?".
2. AI trả lời trong Messenger, dùng sản phẩm của **Mây**, không phải của Hạnh.
3. Đăng nhập `/login` bằng tài khoản staff của Mây (`MAY_BOUTIQUE_STAFF_EMAIL`) → `/admin/inbox`: thấy hội thoại kênh Messenger vừa nhắn.
4. Đăng nhập tài khoản staff của Hạnh (`DEMO_STAFF_EMAIL`) → `/admin/inbox`: **không** thấy hội thoại đó.
5. Nhắn thử Page Hạnh: vẫn trả lời bình thường (Page Hạnh không bị mất quyền ở phần 3).
6. Từ inbox Mây, bấm tiếp quản và gửi một câu: tin hiện trong Messenger của tester, gửi từ Page Mây.

---

## Checklist cuối

- [ ] Page "Mây Boutique" đã tạo, người generate token là admin Page và có role trên app.
- [ ] Page Mây đã connect vào app, Page Hạnh vẫn còn trong danh sách.
- [ ] Page Mây đã subscribe `messages` và `messaging_postbacks`.
- [ ] Token Mây debug ra **Expires: Never** (hoặc dev đã đổi sang token không hết hạn).
- [ ] Page ID và token đã gửi riêng cho dev, không có trong group chat hay git.
- [ ] Dev đã sửa `scripts/seed.ts` và chạy `--data=may-boutique --only=channels` lên đúng project (local hoặc shared).
- [ ] Người test đều là tester đã chấp nhận lời mời.
- [ ] Tin vào Page Mây hiện ở inbox Mây, không hiện ở inbox Hạnh. Page Hạnh vẫn chạy.

## Lỗi thường gặp

| Triệu chứng | Nguyên nhân hay gặp | Cách xử lý |
|---|---|---|
| Nhắn Page Mây, không có trả lời, log Vercel không có gì | Page Mây chưa subscribe webhook | Làm lại phần 4 |
| Log Vercel: `messenger: unknown page <id>, message ignored` | Chưa có dòng `channel_accounts` cho Page Mây, hoặc seed vào nhầm project (local thay vì shared), hoặc Page ID sai | Kiểm tra Page ID lấy ở Messenger API Settings, chạy lại 8.3 với `--target=shared` |
| Log Vercel: `messenger: rejected a delivery with a missing or wrong signature` | `META_APP_SECRET` trên Vercel không khớp app | Không liên quan Page mới; kiểm tra lại App secret (App settings → Basic) |
| Server nhận tin nhưng không gửi được trả lời, log có `messenger_send_failed: 400 ...` / `401 ...` kèm thông báo token không hợp lệ hoặc hết hạn | Token hết hạn hoặc bị vô hiệu (người tạo đổi mật khẩu, bị gỡ khỏi Page/app) | Generate token mới (phần 3), gửi dev, chạy lại 8.3 |
| Một người nhắn mà không có trả lời, tester khác thì có | Người đó không phải tester, hoặc chưa chấp nhận lời mời | Phần 6 |
| Page Hạnh ngừng trả lời sau khi làm bước này | Bỏ tick Page Hạnh lúc connect Page Mây | Connect lại, tick cả hai Page; nếu token Hạnh bị vô hiệu thì Generate lại và chạy `pnpm db:seed --only=channels` (không `--data`) cho Hạnh |
| Seed báo `messenger <id> belongs to another shop` | Đang dùng Page ID của Hạnh cho Mây | Kiểm tra lại biến `MAY_BOUTIQUE_MESSENGER_PAGE_ID` |
