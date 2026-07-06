#!/usr/bin/env bash
# Thiết lập cron job chạy vào ngày 15 và 30 hàng tháng lúc 9:00 sáng.
# Chạy script này một lần: bash setup_cron.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE="$(which node)"
LOG="$SCRIPT_DIR/mail_log.txt"

CRON_LINE="0 9 15,28,29,30 * * cd \"$SCRIPT_DIR\" && \"$NODE\" main.js >> \"$LOG\" 2>&1"

# Kiểm tra xem cron đã tồn tại chưa
if crontab -l 2>/dev/null | grep -qF "mail_working_timesheet"; then
    echo "Cron job đã tồn tại. Không thêm lại."
    crontab -l | grep "mail_working_timesheet"
    exit 0
fi

# Thêm vào crontab
(crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -

echo "Cron job đã được thiết lập:"
echo "  $CRON_LINE"
echo ""
echo "Xem cron hiện tại : crontab -l"
echo "Chỉnh sửa cron    : crontab -e"
echo "Log file          : $LOG"
echo ""
echo "Lưu ý: Tháng 2 được xử lý tự động (ngày 28 hoặc 29 tùy năm nhuận)."
echo "       Thử nghiệm ngay:  cd \"$SCRIPT_DIR\" && node main.js --dry-run"
