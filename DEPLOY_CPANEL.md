# Deploy Quán Giải Trí v4.1 lên cPanel — MySQL/MariaDB, A → Z

> Domain đã trỏ về hosting. Bản này **không cần PostgreSQL**.

## A. Kiểm tra hosting trước khi upload

Trong ô tìm kiếm cPanel, tìm một trong các mục:

- `Setup Node.js App`
- `Application Manager`
- `Node.js Selector`

Nếu **không có bất kỳ mục nào**, dừng tại đây và hỏi hosting provider xem gói có chạy Node.js/Passenger được không. PHP + MySQL đơn thuần không chạy được backend Express/Socket.IO của Quán Giải Trí.

Nếu có Node.js, ưu tiên Node **20 hoặc 22**.

Cũng kiểm tra domain đã có SSL hợp lệ trong `SSL/TLS Status`. Production phải dùng HTTPS.

## B. Tạo MySQL/MariaDB database

Vào **Database Wizard** (ảnh cPanel của bạn đang có mục này).

1. Create Database: ví dụ `quangiaitri`.
2. Create Database User: ví dụ `qgtuser`.
3. Dùng password generator và lưu password ở password manager.
4. Add User to Database.
5. Chọn **ALL PRIVILEGES**.

cPanel thường thêm prefix. Ví dụ UI có thể hiển thị:

- Database: `ntqhost_quangiaitri`
- User: `ntqhost_qgtuser`

Phải dùng **tên đầy đủ** này trong environment variables.

Không cần `Remote Database Access` vì app và DB chạy cùng hosting. Không tạo table bằng phpMyAdmin; app tự bootstrap schema.

## C. Chuẩn bị Google OAuth

Trong Google Cloud / Google Auth Platform, tạo OAuth Client loại **Web application**.

Authorized redirect URI phải là chính xác:

```text
https://TEN-DOMAIN-CUA-BAN/auth/google/callback
```

Ví dụ nếu site là `https://game.congty.vn` thì callback phải là:

```text
https://game.congty.vn/auth/google/callback
```

Source vẫn xác minh backend:

- signed Google ID token
- audience/client ID
- nonce/state/PKCE
- `email_verified=true`
- `hd=ntq-solution.com.vn`
- email kết thúc bằng `@ntq-solution.com.vn`

## D. Upload source

Giải nén ZIP trên máy tính rồi upload thư mục app lên home account, ví dụ:

```text
/home/CPANEL_USER/quan-giai-tri/
```

Khuyến nghị **không đặt toàn bộ source/secrets trực tiếp trong `public_html`**.

Các file quan trọng ở root phải có:

```text
app.js
package.json
server/
public/
```

`app.js` là Passenger startup entrypoint.

## E. Tạo Node.js Application

Tên menu tùy hosting nhưng thông số tương đương:

- Node.js version: `20` hoặc `22`
- Application mode: `Production`
- Application root: `quan-giai-tri`
- Application URL: domain/subdomain của Quán Giải Trí
- Startup file: `app.js`

Nếu UI tự cấp PORT, dùng PORT đó. Nếu có ô environment variables, thêm các biến ở bước F.

## F. Environment Variables production

Không commit secret vào source. Đặt trong Application Manager/Node.js App:

```env
NODE_ENV=production
APP_ORIGIN=https://TEN-DOMAIN-CUA-BAN
APP_TIMEZONE=Asia/Ho_Chi_Minh

GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxx
GOOGLE_REDIRECT_URI=https://TEN-DOMAIN-CUA-BAN/auth/google/callback
GOOGLE_HOSTED_DOMAIN=ntq-solution.com.vn

SESSION_SECRET=RANDOM_SECRET_TOI_THIEU_32_KY_TU

DB_HOST=localhost
DB_PORT=3306
DB_NAME=CPANEL_PREFIX_quangiaitri
DB_USER=CPANEL_PREFIX_qgtuser
DB_PASSWORD=PASSWORD_DB_CUA_BAN
DB_POOL_SIZE=10

ADMIN_EMAILS=email.admin@ntq-solution.com.vn
TRUST_PROXY=1
```

Tạo `SESSION_SECRET` bằng Terminal cPanel nếu có:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Không gửi screenshot có `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` hay `DB_PASSWORD`.

## G. Cài dependencies

Nếu cPanel có nút **Run NPM Install**, dùng nút đó.

Nếu có Terminal:

```bash
cd ~/quan-giai-tri
npm install --omit=dev
```

Package DB duy nhất cần thêm cho bản này là `mysql2`; PostgreSQL packages đã bị loại bỏ.

## H. Restart app và bootstrap database

Restart Node application từ cPanel.

Khi startup lần đầu, app tự tạo các bảng InnoDB, gồm:

- users / office_groups
- user_sessions
- matches / match_events / ratings / challenges / match_queue
- solo_runs / game_scores
- reward_events
- achievement_defs / user_achievements
- chat_messages
- releases
- site_settings / game_configs
- rate_limit_buckets
- audit_log

Nếu gặp lỗi `ER_ACCESS_DENIED_ERROR`, kiểm tra DB_USER/DB_PASSWORD và việc user đã được add vào đúng database với ALL PRIVILEGES.

Nếu gặp lỗi `ER_BAD_DB_ERROR`, `DB_NAME` sai hoặc chưa tạo database.

## I. Health check

Mở:

```text
https://TEN-DOMAIN-CUA-BAN/healthz
```

Kỳ vọng:

```json
{"ok":true,"service":"quan-giai-tri"}
```

Sau đó mở homepage. Nếu chưa login sẽ thấy màn hình Google Workspace.

## J. Test Google login

Đăng nhập bằng một email `@ntq-solution.com.vn`.

Test thêm một account Google ngoài domain: backend phải từ chối.

Email nằm trong `ADMIN_EMAILS` sẽ nhận quyền Admin sau lần đăng nhập thành công.

## K. Test Admin Console

Với admin:

1. Tạo các khối văn phòng.
2. Assign user vào khối.
3. Kiểm tra giờ mở cửa.
4. Kiểm tra XP/Point economy.
5. Kiểm tra chat cooldown.
6. Bật/tắt game và leaderboard.
7. Tạo một Release.
8. Kiểm tra Security/Audit log.

## L. Test chat chống spam

Gửi 1 tin nhắn rồi gửi lại ngay. Request thứ hai phải bị backend reject theo cooldown mặc định 5 giây.

Không chỉ nhìn countdown ở frontend; mở DevTools và gọi request/socket trực tiếp vẫn phải bị giới hạn.

## M. Test operating hours

Đặt schedule tạm thời thành một khung không bao gồm giờ hiện tại. User thường phải bị khóa start game/match action từ backend. Admin vẫn có quyền preview.

Sau test, đặt lại:

- 12:00–13:15
- 17:45–08:00 hôm sau
- timezone Asia/Ho_Chi_Minh

## N. Test PvP + WebSocket

Mở hai browser/profile khác nhau với hai account công ty:

1. Cả hai phải hiện online.
2. Gửi chat và thấy realtime.
3. Cùng queue một game PvP.
4. Phải ghép thành một match.
5. Nước đi sai lượt/ô đã dùng phải bị server reject.
6. Kết thúc trận phải có popup kết quả.
7. Public arena result phải xuất hiện.
8. Elo/XP/Point phải cập nhật từ backend.

Nếu HTTP hoạt động nhưng realtime không hoạt động, liên hệ hosting provider và hỏi rõ **WebSocket support/proxy cho Node.js Passenger/Socket.IO**. Đây là giới hạn hạ tầng, không phải vấn đề MySQL.

## O. Test leaderboard solo

1. Mở một game solo.
2. Server phải cấp run ID/nonce/seed.
3. Chơi đủ thời gian tối thiểu.
4. Finish một lần thành công.
5. Submit lại cùng run phải bị reject.
6. Score vượt score cap phải bị reject.
7. Leaderboard game phải cập nhật nếu game bật leaderboard.

## P. Kiểm tra DB bằng phpMyAdmin

Chỉ dùng phpMyAdmin để **quan sát/backup**, không sửa điểm trực tiếp trong production.

Bạn sẽ thấy các bảng do app tự tạo. Kiểm tra table engine là InnoDB nếu hosting UI có hiển thị.

Không public phpMyAdmin ra IP khác và không dùng Remote Database Access nếu không cần.

## Q. Custom background/image/sound

Upload asset bằng File Manager vào:

```text
public/custom/
```

Ví dụ:

```text
public/custom/bg-office.webp
public/custom/lounge.mp3
```

Trong Admin nhập:

```text
/custom/bg-office.webp
/custom/lounge.mp3
```

Web upload endpoint cố ý không có để giảm attack surface.

## R. Backup

Bật backup của hosting nếu có. Tối thiểu backup:

- MySQL database
- source code/version đang deploy
- `public/custom/`
- danh sách environment variable **không lưu plaintext ở nơi public**

Trước mỗi release lớn, export DB bằng cPanel Backup hoặc phpMyAdmin.

## S. Update source về sau

1. Backup DB + source.
2. Upload release mới vào thư mục staging hoặc backup folder.
3. `npm install --omit=dev` nếu package thay đổi.
4. Restart application.
5. Test `/healthz`, login, chat, PvP, solo.
6. Tạo Release entry trong Admin để member thấy thay đổi.

## T. Những thứ tuyệt đối không làm

- Không đặt `.env` trong thư mục web public nếu server có thể serve file đó.
- Không hard-code DB password/Google secret vào `public/*.js`.
- Không bật Remote Database Access cho `%` hoặc toàn Internet.
- Không dùng root MySQL account cho app.
- Không cho user thường quyền Admin bằng sửa DB thủ công ngoài quy trình audit.
- Không lấy score/winner/XP/Point do browser tự khai rồi ghi thẳng DB.

## U. Khi cần gửi lỗi để debug

Gửi:

- tên lỗi/stack trace nhưng che secret
- Node version
- MySQL hay MariaDB version nếu cPanel hiển thị
- ảnh phần Node.js Application
- trạng thái `/healthz`

Không gửi DB password, Google Client Secret, session secret hay cookie.
