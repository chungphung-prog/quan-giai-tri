(() => {
  'use strict';

  // v4.1.24 — Revert Vietnamese Copy Polish.
  // Giữ nguyên câu chữ gốc của ứng dụng; chỉ dọn các mô tả kỹ thuật khỏi UI người chơi.
  let pending = false;

  const replaceExactText = (el, from, to) => {
    if (!el) return;
    const text = (el.textContent || '').trim();
    if (text === from) el.textContent = to;
  };

  function cleanGameDescriptions() {
    const replacements = new Map([
      ['Đấu cờ vua mini trực tiếp; server xác thực từng nước đi.', 'Đấu cờ vua mini trực tiếp với đồng nghiệp.'],
      ['Đấu cờ tướng mini trực tiếp; server xác thực từng nước đi.', 'Đấu cờ tướng mini trực tiếp với đồng nghiệp.'],
      ['3×3 realtime, ghép trận nhanh và kết quả server xác thực.', '3×3 realtime, ghép trận nhanh.'],
      ['Reversi realtime, server kiểm tra lượt và nước đi hợp lệ.', 'Reversi realtime, lật quân đối thủ bằng cách kẹp hai đầu.'],
      ['Săn hạm đội đối thủ trên lưới 8×8; server che toàn bộ fleet bí mật.', 'Săn hạm đội đối thủ trên lưới 8×8.']
    ]);
    document.querySelectorAll('.arena-card p,.library-card p,.game-card p,.game-head p').forEach(el => {
      const next = replacements.get((el.textContent || '').trim());
      if (next) el.textContent = next;
    });
  }

  function cleanPlayerUi() {
    if (location.hash === '#admin') return;

    // Các badge/ghi chú triển khai nội bộ không có ích cho người chơi.
    document.querySelectorAll('.trust-strip,.server-tag,.security-note').forEach(el => el.remove());
    document.querySelectorAll('.library-flags b').forEach(el => el.remove());

    // Version state của trận là thông tin debug.
    document.querySelectorAll('.match-top span').forEach(el => {
      if (/^(State|Phiên)\s*#\d+/i.test((el.textContent || '').trim())) el.remove();
    });

    // Dashboard/Kho game: giữ văn phong gốc, chỉ bỏ phần giải thích backend.
    document.querySelectorAll('.page-title p,.hero-card p').forEach(el => {
      const t = (el.textContent || '').trim();
      if (t === 'Mọi game đều có hồ sơ online và bảng xếp hạng riêng. PvP được xác thực toàn bộ trên server.') {
        el.textContent = 'Chọn game bạn thích, chơi cùng đồng nghiệp hoặc thử sức trên bảng xếp hạng.';
      }
      if (t === 'Mỗi game một BXH riêng; PvP dùng rating, game khác dùng best score đã qua run guard.') {
        el.textContent = 'Mỗi game có một bảng xếp hạng riêng để so thành tích với mọi người.';
      }
      if (t === 'Mỗi lượt solo được server cấp run riêng và ghi vào bảng xếp hạng. XP/Point chính thức nằm trên server; cache trình duyệt không có quyền quyết định thành tích.') {
        el.textContent = 'Chọn game, tích XP và thử sức trên bảng xếp hạng.';
      }
    });

    // Profile: người chơi chỉ cần hiểu XP/Point để làm gì.
    const economy = document.querySelector('.economy-info .economy-cols');
    if (economy) {
      const blocks = [...economy.children];
      if (blocks[0]?.querySelector('p')) blocks[0].querySelector('p').textContent = 'XP dùng để lên level. Chơi game, hoàn thành trận và mở thành tựu để tích lũy XP.';
      if (blocks[1]?.querySelector('p')) blocks[1].querySelector('p').textContent = 'Point là điểm thưởng ghi nhận thành tích và có thể dùng cho các tính năng thưởng sau này.';
      if (blocks[2]) blocks[2].remove();
    }

    // Khu solo: bỏ Run/AI/cache/speed khỏi phần thông tin người chơi.
    const soloHead = document.querySelector('.game-head .eyebrow');
    if (soloHead && /ONLINE RUN|NIGHTMARE|IMPOSSIBLE|HARD/i.test(soloHead.textContent || '')) soloHead.remove();

    document.querySelectorAll('.side-panel .panel').forEach(panel => {
      const heading = panel.querySelector('h3');
      if (heading && heading.textContent.trim() === 'Thông tin lượt chơi') heading.textContent = 'Thông tin trò chơi';
      panel.querySelectorAll('.mini-stat').forEach(row => {
        const label = row.querySelector('span')?.textContent?.trim() || '';
        if (/^(AI mặc định|Tốc độ tối đa|Best cache máy này)$/i.test(label)) row.remove();
      });
    });

    document.querySelectorAll('.run-loader b').forEach(el => {
      if (/server|run|an toàn/i.test(el.textContent || '')) el.textContent = 'Đang chuẩn bị lượt chơi…';
    });

    const banner = document.querySelector('.online-banner');
    if (banner) {
      const b = banner.querySelector('b');
      const span = banner.querySelector('span:last-child');
      if (b) b.textContent = 'Online Score Arena';
      if (span) span.textContent = 'Chọn game, tích XP và thử sức trên bảng xếp hạng.';
    }

    // Không khoe cơ chế lưu trữ/cache ở footer/profile.
    const footer = document.querySelector('footer');
    if (footer) {
      const text = footer.querySelector('span');
      if (text) text.textContent = 'Quán Giải Trí • Chơi vui, tích XP, leo hạng cùng đồng nghiệp';
      const reset = footer.querySelector('#resetBtn');
      if (reset) reset.style.display = 'none';
    }
    document.querySelectorAll('.profile-online .muted').forEach(el => {
      if (/server|hệ thống|Google Workspace|XP\/Point/i.test(el.textContent || '')) el.textContent = 'Tên và ảnh đại diện được lấy từ tài khoản công ty.';
    });

    // Kết quả trận: chỉ báo kết quả/thưởng, không nói cách backend xử lý.
    document.querySelectorAll('.public-result small').forEach(el => {
      el.textContent = (el.textContent || '').replace(/\s*•\s*(kết quả )?(server|hệ thống).*$/i, '').trim();
    });
    document.querySelectorAll('.result-reward span').forEach(el => {
      if (/server|hệ thống/i.test(el.textContent || '')) el.textContent = 'XP/Point đã được cập nhật.';
    });

    // Login: chỉ giữ điều kiện đăng nhập cần thiết.
    document.querySelectorAll('.login-foot').forEach(el => {
      if (/backend|server|domain|xác thực/i.test(el.textContent || '')) el.textContent = 'Chỉ dành cho tài khoản công ty.';
    });

    cleanGameDescriptions();
  }

  function processAll() {
    pending = false;
    cleanPlayerUi();
  }

  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(processAll);
  }

  function start() {
    processAll();
    const observer = new MutationObserver(mutations => {
      if (mutations.some(m => m.type === 'characterData' || (m.type === 'childList' && m.addedNodes.length))) schedule();
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    window.addEventListener('hashchange', schedule, { passive: true });
    window.addEventListener('popstate', schedule, { passive: true });
    setTimeout(schedule, 250);
    setTimeout(schedule, 900);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
