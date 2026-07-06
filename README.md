# mail_working_timesheet

Tự động lấy dữ liệu chấm công từ OPMS, phát hiện vi phạm, và gửi mail giải trình đến quản lý — chạy tự động qua cron hai lần mỗi tháng.

## Tính năng

- Đăng nhập OPMS qua Google SSO bằng Chrome CDP (không cần nhập mật khẩu thủ công)
- Lấy dữ liệu chấm công qua Odoo JSON-RPC API
- Phát hiện các vi phạm: đi muộn, thiếu check-in/check-out, thiếu giờ công
- Tự động soạn và gửi mail giải trình bằng tiếng Việt
- Xử lý đặc biệt tháng 2 (năm thường/nhuận)

## Cấu trúc kỳ báo cáo

| Ngày cron chạy | Kỳ báo cáo |
| --- | --- |
| Ngày 15 | 1 – 15 tháng đó |
| Ngày cuối tháng (28/29/30/31) | 16 – cuối tháng |

## Cài đặt

### 1. Cài dependencies

```bash
cd mail_working_timesheet
npm install
```

### 2. Tạo file config

```bash
cp config.json.example config.json
```

Mở `config.json` và điền thông tin thực tế:

```json
{
  "opms": {
    "login_url": "https://opms.insight.hblab.co.jp/web/login",
    "attendance_model": "ntq.attendance",
    "google_account": "email@company.com"
  },
  "work_schedule": {
    "latest_checkin": "08:30",
    "min_work_hours": 8.0,
    "lunch_break_hours": 1.5,
    "grace_period_minutes": 5
  },
  "gmail": {
    "sender_email": "email@company.com",
    "app_password": "xxxx xxxx xxxx xxxx"
  },
  "recipients": {
    "to": ["manager@company.com"],
    "cc": ["hr@company.com"]
  },
  "employee": {
    "name": "Họ Tên",
    "department": "Bộ phận",
    "manager_name": "Tên Trưởng phòng",
    "phone": "0900000000"
  }
}
```

> **Gmail App Password**: Vào [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) → tạo App Password cho "Mail".

### 3. Đăng nhập Chrome lần đầu

Tool dùng một Chrome profile riêng (thư mục `.chrome_profile/`) để giữ session OPMS độc lập với Chrome cá nhân.

Lần đầu chạy, cần đăng nhập thủ công một lần:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --user-data-dir="$(pwd)/.chrome_profile" \
  --no-first-run
```

Sau khi Chrome mở, truy cập OPMS và đăng nhập bằng Google. Đóng Chrome. Session sẽ được lưu và tự động dùng lại cho các lần chạy tiếp theo (thường kéo dài vài tháng).

### 4. Thiết lập cron

```bash
bash setup_cron.sh
```

Cron sẽ chạy `node main.js` lúc **9:00 sáng** vào ngày 15 và ngày cuối tháng.

## Cách dùng thủ công

```bash
# Kiểm tra (không gửi mail)
node main.js --dry-run

# Chạy thật
node main.js
```

Log được ghi vào `mail_log.txt`.

## Luồng hoạt động

```
Cron trigger (9:00 AM, ngày 15 / cuối tháng)
  ↓
Xác định kỳ báo cáo
  ↓
Mở Chrome .chrome_profile + kết nối qua CDP
  ↓
Đăng nhập OPMS qua Google SSO (tự động nếu session còn)
  ↓
Lấy dữ liệu chấm công qua Odoo JSON-RPC API
  ↓
Đăng xuất OPMS (giải phóng single-session)
  ↓
Phân tích vi phạm
  ↓ (nếu có vi phạm)
Gửi mail giải trình → manager + CC bộ phận HC
```

## Lưu ý

- OPMS chỉ cho phép **1 session** đăng nhập tại một thời điểm. Tool tự đăng xuất sau khi lấy dữ liệu xong.
- Nếu Google yêu cầu đăng nhập lại (session hết hạn), chạy lại bước 3 ở trên.
- Chrome của tool chạy song song với Chrome cá nhân, không ảnh hưởng lẫn nhau.
