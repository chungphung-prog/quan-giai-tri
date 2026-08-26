# Changelog

## v4.1.7 — Card Games Visual Upgrade
- Nâng cấp giao diện nhóm game bài/board-card trong Solo Hub với bàn chơi neon, thẻ bài kiểu casino và feedback trực quan hơn.
- Blackjack được dựng lại thành bàn chơi deluxe với lá bài mặt trước/mặt sau, chip trang trí, badge kết quả và nút chia lại nhanh.
- Memory Match nâng cấp sang hiệu ứng lật thẻ 3D, mặt sau thương hiệu QGT, trạng thái ghép cặp rõ ràng và thống kê tiến độ.
- Poker Dice có bàn xúc xắc mới, hiệu ứng giữ xúc xắc, bảng thưởng nổi và hiển thị bộ hiện tại theo thời gian thực.
- Solitaire Lite chuyển sang thẻ bài thật dạng compact, dải mục tiêu K → A và trạng thái chọn/đổi trực quan hơn.
- Thêm helper render lá bài dùng chung và CSS responsive mới cho các game bài trên mobile/desktop.

## v4.1.6 — Audio compatibility + notification queue
- Fix `audio.setLevels is not a function` even when an older cached `audio-director.js` is still present.
- Add cache-busting query versions for dashboard/solo JS and CSS.
- Dashboard toasts are serialized instead of stacking.
- Achievement popups are queued and never overwrite a match result/modal already on screen.
- Solo notifications are serialized; removed redundant “đang xác thực” toast.
- Solo reward notification now consolidates leaderboard confirmation, XP, Point, and level-up into one message.

# v4.1.5 — Audio boost & volume controls

- Tăng đáng kể gain nhạc nền, combat soundtrack và SFX.
- Thêm DynamicsCompressor/limiter để âm lượng lớn hơn nhưng hạn chế clipping.
- Admin có thanh chỉnh Âm lượng nhạc và Âm lượng hiệu ứng (5–100%).
- Mức mặc định mới: Music 72%, SFX 90%; áp dụng cho dashboard, PvP và toàn bộ game solo.
- Custom MP3 trong `/custom/` cũng tuân theo mức âm lượng mới.

## v4.1.4 — PvP Sync Reliability
- Sửa lỗi Caro/PvP phải F5 sau mỗi nước đi: ACK của `match:action` trả luôn authoritative match state cho chính người đánh.
- Thêm match sync fallback qua REST mỗi 900ms khi đang ở bàn để tự bắt state mới của đối thủ nếu Socket.IO/Passenger bỏ lỡ broadcast.
- Chặn double-click/race khi một action đang chờ ACK; UI Caro khóa ô đã đánh và khóa bàn khi chưa tới lượt.
- Khi stale version, client tự hydrate state mới thay vì buộc reload trang.
- Matchmaking có DB-backed fallback `/api/matchmaking/me`, giúp người đang chờ vẫn nhận được match khi Socket.IO event bị miss giữa các Passenger worker.
- Socket.IO vẫn là fast path; REST/MySQL chỉ làm recovery path, server vẫn là nguồn sự thật duy nhất.

# Changelog

## v4.1.3 — Audio & Release Editor
- Admin có thể sửa và xóa Release note đã public; mọi thay đổi được audit và broadcast realtime.
- Thêm Audio Director dùng WebAudio: nhạc synth mặc định cho Dashboard, nhạc combat trong PvP/solo và SFX thắng/thua/nước đi.
- Admin có thể override nhạc Dashboard và nhạc game bằng file local `/custom/*.mp3` mà không mở upload endpoint.
- Nhạc game tăng cường độ theo speed ramp ở các game tốc độ.
- Sửa nút `← Kho game` trong solo bị CSP chặn do inline `onclick`; chuyển sang event binding an toàn.
- Khi rời/restart game, timer/event loop và run client được cleanup để tránh game chạy ngầm.

## v4.1.0 — MySQL/MariaDB cPanel Edition

- Chuyển toàn bộ persistence từ PostgreSQL sang MySQL/MariaDB InnoDB.
- Bỏ `pg` và `connect-pg-simple`; dùng `mysql2`.
- Session store, rate-limit, matchmaking queue, XP/Point, leaderboard, chat và audit đều chạy trên MySQL.
- Giữ transaction/row-lock cho PvP và reward bằng `READ COMMITTED` + `FOR UPDATE`.
- Cập nhật `.env`, Docker Compose và hướng dẫn cPanel cho Database Wizard/MySQL.
- Bind solo finish route với game key của run để tránh submit run sang endpoint game khác.


## v4.0.0 — Quán Giải Trí

- Đổi thương hiệu từ Game Văn Phòng thành **Quán Giải Trí**.
- Làm lại dashboard dark-neon, responsive, animation, arcade artwork.
- Global realtime chat, cooldown mặc định 5 giây server-side.
- Hiển thị online members/presence.
- PvP matchmaking, challenge, opponent stage, result popup.
- Public arena result cho toàn site.
- Release timeline/member-visible changelog.
- XP, Point, Level 1–100, reward cap và achievement medal.
- Admin Console quản lý branding, asset path, ambient sound, giờ mở, game config, economy/chat, user/khối, suspend, manual XP/Point adjustment, Release.
- Mặc định AI Nightmare; speed game tăng dần theo `speedStart → speedMax`.
- 63 game trong catalog; game non-PvP dùng online run + per-game leaderboard.
- Solo run dùng server-issued seed; client RNG chuyển sang deterministic seeded RNG.
- PvP tiếp tục server-authoritative.
- Google Workspace login khóa `@ntq-solution.com.vn` bằng signed `hd` claim.
- Bỏ Redis dependency để dễ deploy cPanel single-instance; rate-limit/session/queue dùng database backend; từ v4.1 chuyển sang MySQL/MariaDB.
- Thêm cPanel/Passenger root `app.js`.
- Thêm A→Z cPanel deployment guide.

- Bổ sung Admin Security / Audit, log solo reject và soft-delete chat có audit.
