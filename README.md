# Quán Giải Trí v4.1 — MySQL/MariaDB cPanel Edition

Bản này đã chuyển toàn bộ persistence từ PostgreSQL sang **MySQL/MariaDB + InnoDB**, phù hợp cPanel chỉ có `Manage My Databases`, `Database Wizard`, `phpMyAdmin`.

## Stack

- Node.js 20/22 + Express 5
- Socket.IO 4
- MySQL/MariaDB qua `mysql2`
- InnoDB transactions + `FOR UPDATE`
- Session store tự quản lý trong MySQL (`user_sessions`)
- Google Workspace OIDC, chỉ `@ntq-solution.com.vn`
- Frontend HTML/CSS/JS thuần

Không cần PostgreSQL. Không cần Redis ở mô hình một Node instance.

## Những gì giữ nguyên

- Dashboard Quán Giải Trí, chat chung, online presence.
- Matchmaking/challenge PvP, server-authoritative game state, Elo.
- 63 game + leaderboard từng game.
- Solo run guard, XP/Point/Level/Achievement.
- Release timeline, Admin Console, giờ mở cửa.
- Audit log và rate-limit server-side.

## Security DB

- Các bảng dùng InnoDB để transaction/row-lock hoạt động thật.
- UUID sinh bằng `crypto.randomUUID()` phía server, không phụ thuộc extension DB.
- Query values đi qua placeholder parameter của `mysql2`; không nối trực tiếp input user vào SQL.
- Các transaction nhạy cảm chạy `READ COMMITTED` + `FOR UPDATE`.
- Session, rate limit, reward idempotency, chat cooldown, match state và daily cap đều lưu/kiểm tra backend.
- DB không cần Remote Database Access nếu Node app và MySQL nằm cùng cPanel account/server.

## Cấu hình DB

```env
DB_HOST=localhost
DB_PORT=3306
DB_NAME=cpaneluser_quangiaitri
DB_USER=cpaneluser_qgtuser
DB_PASSWORD=YOUR_STRONG_PASSWORD
DB_POOL_SIZE=10
```

Tên DB/user thật trên cPanel thường có prefix account. Hãy copy đúng tên cPanel hiển thị sau khi tạo.

## Chạy

```bash
cp .env.example .env
npm install --omit=dev
npm start
```

App tự tạo bảng khi startup; không cần import SQL thủ công bằng phpMyAdmin.

## cPanel

Đọc `DEPLOY_CPANEL.md` theo thứ tự A → Z. Điều kiện quan trọng nhất ngoài MySQL là hosting phải có **Node.js Application / Application Manager / Setup Node.js App** và phải cho phép WebSocket nếu muốn realtime chat/matchmaking.

## Kiểm tra source

```bash
npm run check
npm test
npm run security:check
```

## Cấu trúc

- `app.js` — startup entrypoint cho cPanel/Passenger.
- `server/db.js` — MySQL pool, transaction wrapper, schema bootstrap.
- `server/session-store.js` — session store MySQL không cần package store riêng.
- `server/` — auth/API/realtime/game engines/security.
- `public/` — dashboard.
- `public/solo/` — kho game solo.
- `public/custom/` — background/sound/image tự upload.
- `.env.example` — mẫu biến môi trường MySQL.
- `DEPLOY_CPANEL.md` — hướng dẫn production.
- `SECURITY.md` — threat model.

## Audio v4.1.3

- Dashboard và game có nhạc synth/WebAudio tích hợp sẵn; không cần tải asset bên ngoài. Trình duyệt chỉ cho phát âm thanh sau tương tác đầu tiên của user, nên nhạc sẽ bắt đầu ở click/phím đầu tiên.
- Admin → **Giao diện & giờ mở** có 2 ô: **Nhạc Dashboard** và **Nhạc trong game**. Để trống dùng synth mặc định; hoặc upload file vào `public/custom/` và nhập đường dẫn `/custom/ten-file.mp3`.
- Nút loa lưu preference trên trình duyệt. PvP/solo tự chuyển sang nhạc combat; các game speed-ramp tăng intensity nhạc theo thời gian.
- Admin → **Release** hỗ trợ Tạo / Sửa / Xóa release note.
