# Security — Quán Giải Trí v4.1 MySQL/MariaDB

## Cam kết thực tế

Không thể bảo đảm 100% “không hack được”. Mục tiêu của hệ thống là làm cho client không có quyền quyết định dữ liệu quan trọng, giảm bề mặt tấn công, chặn các kiểu cheat phổ biến và để lại audit trail cho hành vi nhạy cảm.

## Trust boundaries

### Backend là nguồn sự thật cho

- Google Workspace identity/session.
- Role admin/user và trạng thái suspended.
- Khối văn phòng.
- Giờ được phép chơi.
- Matchmaking/challenge/membership.
- PvP state, winner, rating, reward.
- XP, Point, Level, achievement.
- Solo run lifecycle và leaderboard record.
- Chat cooldown/message persistence.
- Release/admin configuration.

### Browser không được tin cho

- Identity/domain.
- Role/admin.
- PvP state/winner.
- XP/Point/rating.
- Giờ mở quán.
- Chat cooldown.
- Solo score tuyệt đối.

## Authentication

- Google OAuth authorization-code flow.
- PKCE S256, random state, random nonce, transaction timeout.
- Backend dùng Google library để verify signed ID token và audience.
- Bắt buộc `email_verified === true`.
- Bắt buộc signed claim `hd === ntq-solution.com.vn`.
- Email suffix được kiểm tra thêm nhưng không thay thế `hd`.
- `sub` của Google là khóa identity ổn định.
- Session regenerate sau login để chống fixation.
- Cookie production: `__Host-qgt.sid`, Secure, HttpOnly, SameSite=Lax, Path=/.

## CSRF / Origin

- State-changing REST API yêu cầu exact `Origin === APP_ORIGIN` và CSRF token session.
- Socket.IO allowRequest chỉ chấp nhận exact app origin.
- Không dùng wildcard CORS.

## PvP anti-cheat

- Client gửi action intent, không gửi state/winner.
- Match row `FOR UPDATE` trong transaction.
- Mỗi action mang `expectedVersion`; stale action bị từ chối.
- `clientActionId` chống replay/duplicate.
- Server engine tự validate turn/rule/winner.
- Hidden-information game chỉ trả player view đã lọc: RPS không lộ pick trước lock, Battleship không lộ fleet đối thủ.
- Reward PvP có unique source để không cộng hai lần.

## Solo leaderboard

### Hiện có

- server-issued run id/nonce/seed.
- deterministic seeded RNG phía game client.
- expiry.
- minimum run duration.
- client/server timing comparison.
- score cap theo game config.
- single-submit.
- rate limit.
- daily XP/Point cap.
- reward source idempotency.
- audit log; lượt solo bị validator từ chối cũng ghi `solo.reject` để admin rà soát.

### Không nên tuyên bố

Không nên gọi solo leaderboard là “unhackable”. Vì code/game state chạy trong browser, user có thể patch JS hoặc tự viết client gọi API. Nonce/timing/cap chỉ làm cheat khó hơn và dễ phát hiện hơn, không chứng minh toàn bộ gameplay đã diễn ra hợp lệ.

### Muốn tournament-grade cho solo

Cho từng game cần một trong hai hướng:

1. **Server simulation**: mọi input gửi server, server chạy engine và score.
2. **Replay verification**: client gửi action log/input log; server chạy deterministic engine bằng seed server cấp và tự tái tính score.

Khi triển khai giải đấu có giải thưởng, nên chỉ dùng PvP server-authoritative hoặc game solo đã có verifier riêng.

## Chat abuse controls

- Max length server-side.
- Trim/collapse whitespace server-side.
- Cooldown mặc định 5 giây dùng row lock trên user.
- Socket fixed-window limiter bổ sung.
- HTML escape khi render message.
- Có audit event cho chat send; admin có soft-delete chat và thao tác xóa cũng được audit.

## Operating hours

- Gameplay REST và Socket action kiểm tra lịch server-side.
- `/solo` static route cũng đặt sau auth + play-hour middleware.
- Overnight window như 17:45→08:00 được tính theo ngày hiện tại/ngày trước.
- Admin bypass chỉ để preview/quản trị.

## HTTP hardening

- Helmet CSP.
- `frame-ancestors 'none'`.
- `object-src 'none'`.
- referrer `no-referrer`.
- HSTS production.
- Permissions-Policy khóa camera/mic/geolocation/payment/USB.
- `/auth`, `/api`, `/solo` dùng `Cache-Control: no-store`.
- JSON/socket payload limit nhỏ.
- `perMessageDeflate: false` cho Socket.IO.
- `x-powered-by` tắt.
- production HTTP redirect HTTPS.

## Asset policy

Admin chỉ được set ảnh từ:

- `/assets/...`
- `/custom/...`
- `https://images.unsplash.com/...`

Âm thanh chỉ cho `/assets/...` hoặc `/custom/...`. Không cho arbitrary third-party audio URL để giảm CSP/exfiltration surface.

## MySQL/MariaDB hardening

- Tất cả bảng state/reward/session dùng InnoDB để row lock và transaction có hiệu lực.
- DB user của app chỉ cần quyền trên đúng database Quán Giải Trí; không dùng MySQL root.
- Không bật Remote Database Access nếu Node app chạy cùng hosting.
- Input value đi qua placeholder của `mysql2`; tên cột động trong Admin chỉ lấy từ allowlist nội bộ.
- Transaction nhạy cảm dùng `READ COMMITTED` + `FOR UPDATE`.
- Session được lưu server-side trong `user_sessions`; browser chỉ giữ session cookie opaque.

## Production checklist

- HTTPS hợp lệ trước khi bật production.
- `NODE_ENV=production` và `TRUST_PROXY=1` trên cPanel/Passenger.
- `SESSION_SECRET` random >= 32 chars, tốt nhất 48 bytes base64url.
- Google Client Secret không nằm trong public_html/repository public.
- Database password riêng, mạnh; DB không mở public nếu không cần.
- `ADMIN_EMAILS` tối thiểu số người cần thiết.
- Không commit `.env`.
- Direct dependency được pin exact version; sau `npm install` giữ `package-lock.json`, chạy `npm audit --omit=dev` và review Dependabot định kỳ.
- Chạy smoke test trước deploy.
- Backup MySQL/MariaDB định kỳ; giữ database private/local nếu app chạy cùng cPanel.
- Theo dõi tab **Security / Audit**, `audit_log`, error logs, rate-limit spikes.
- Trước khi rollout toàn công ty: staging + OWASP ZAP + manual pentest bởi người khác team.
